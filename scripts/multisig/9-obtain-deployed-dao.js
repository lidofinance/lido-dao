const path = require('path')
const chalk = require('chalk')
const { assert } = require('chai')
const { getEvents } = require('@aragon/contract-helpers-test')
const { hash: namehash } = require('eth-ens-namehash')
const { toChecksumAddress } = require('web3-utils')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { readJSON } = require('../helpers/fs')
const { log } = require('../helpers/log')
const { useOrGetDeployed, assertProxiedContractBytecode } = require('../helpers/deploy')
const { assertRole } = require('../helpers/aragon')
const { readNetworkState, persistNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES, APP_ARTIFACTS } = require('./constants')
const VALID_APP_NAMES = Object.entries(APP_NAMES).map((e) => e[1])

const REQUIRED_NET_STATE = [
  'newDaoTx',
  'lidoApmEnsName',
  `app:${APP_NAMES.LIDO}`,
  `app:${APP_NAMES.ORACLE}`,
  `app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`
]

const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'

async function obtainDeployedAPM({ web3, artifacts, networkStateFile = NETWORK_STATE_FILE }) {
  const netId = await web3.eth.net.getId()

  log.wideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(networkStateFile, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  log.splitter()

  const newDaoTxReceipt = await web3.eth.getTransactionReceipt(state.newDaoTx)
  if (!newDaoTxReceipt) {
    throw new Error(`transaction ${state.newDaoTx} not found`)
  }

  const { dao, daoToken } = await getDeployed({
    kernelAddress: state.lidoDAOAddress,
    tokenAddress: state.daoTokenAddress,
    newDaoTxReceipt
  })

  log.splitter()

  state.daoAddress = dao.address
  state.daoTokenAddress = daoToken.address

  const dataByAppId = await getInstalledApps({ newDaoTxReceipt, dao, state })

  for (const [appName, appData] of Object.entries(dataByAppId)) {
    const key = `app:${appName}`
    state[key] = { ...state[key], ...appData }
  }

  log.splitter()
  persistNetworkState(networkStateFile, netId, state)
}

async function getDeployed({ kernelAddress, tokenAddress, newDaoTxReceipt }) {
  if (!kernelAddress || !tokenAddress) {
    log(`Using transaction: ${chalk.yellow(newDaoTxReceipt.transactionHash)}`)

    const DAOFactory = artifacts.require('DAOFactory')
    const LidoTemplate = artifacts.require('LidoTemplate')

    const daoFactoryEvts = getEvents(newDaoTxReceipt, 'DeployDAO', { decodeForAbi: DAOFactory.abi })
    assert.equal(daoFactoryEvts.length, 1, 'the DAOFactory has generated one DeployDAO event')
    kernelAddress = daoFactoryEvts[0].args.dao

    const tmplEvts = getEvents(newDaoTxReceipt, 'DeployToken', { decodeForAbi: LidoTemplate.abi })
    assert.equal(tmplEvts.length, 1, 'the DAOFactory has generated one DeployToken event')
    tokenAddress = tmplEvts[0].args.token
  }

  log(`Using Kernel: ${chalk.yellow(kernelAddress)}`)
  const dao = await artifacts.require('Kernel').at(kernelAddress)

  log(`Using MiniMeToken: ${chalk.yellow(tokenAddress)}`)
  const daoToken = await artifacts.require('MiniMeToken').at(tokenAddress)

  return { dao, daoToken }
}

async function getInstalledApps({ newDaoTxReceipt, dao: kernel, state }) {
  const LidoTemplate = artifacts.require('LidoTemplate3')
  const newProxyFullEvts = getEvents(newDaoTxReceipt, 'InstalledApp', { decodeForAbi: LidoTemplate.abi })
  const newProxyEvts = newProxyFullEvts.map((evt) => evt.args)

  const originCheckDesc = `all InstalledApp events originate from the tmpl ${chalk.yellow(state.daoTemplateAddress)}`
  const evtOrigins = newProxyFullEvts.map((evt) => toChecksumAddress(evt.address))
  const expectedEvtOrigins = Array.from(evtOrigins, () => state.daoTemplateAddress)
  assert.sameOrderedMembers(evtOrigins, expectedEvtOrigins, originCheckDesc)
  log.success(originCheckDesc)

  const appIdNameEntries = VALID_APP_NAMES.map((name) => [namehash(`${name}.${state.lidoApmEnsName}`), name])

  const appNameByAppId = Object.fromEntries(appIdNameEntries)
  const expectedAppIds = appIdNameEntries.map((e) => e[0])

  const idsCheckDesc = `all (and only) expected apps are installed`
  assert.sameMembers(
    newProxyEvts.map((evt) => evt.appId),
    expectedAppIds,
    idsCheckDesc
  )
  log.success(idsCheckDesc)

  const proxyArtifact = await loadArtifact('external:AppProxyUpgradeable')
  const AragonApp = artifacts.require('AragonApp')
  const APP_BASES_NAMESPACE = await kernel.APP_BASES_NAMESPACE()

  const dataByAppName = {}

  for (const evt of newProxyEvts) {
    log.splitter()

    const appName = appNameByAppId[evt.appId]
    const proxyAddress = toChecksumAddress(evt.appProxy)

    const artifact = await loadArtifact(APP_ARTIFACTS[appName])
    const implAddress = await assertProxiedContractBytecode(proxyAddress, proxyArtifact, artifact, appName)

    const kernelBaseAddr = await kernel.getApp(APP_BASES_NAMESPACE, evt.appId)

    const baseCheckDesc = `${appName}: the installed app base is ${chalk.yellow(implAddress)}`
    assert.equal(toChecksumAddress(kernelBaseAddr), toChecksumAddress(implAddress), baseCheckDesc)
    log.success(baseCheckDesc)

    const instance = await AragonApp.at(proxyAddress)
    await assertInitializedAragonApp(instance, kernel, appName)

    dataByAppName[appName] = {
      name: appName,
      fullName: `${appName}.${state.lidoApmEnsName}`,
      id: evt.appId,
      proxyAddress
    }
  }

  return dataByAppName
}

async function loadArtifact(artifactName) {
  if (artifactName.startsWith('external:')) {
    const artifactPath = path.join(__dirname, 'external-artifacts', artifactName.substring(9) + '.json')
    return await readJSON(artifactPath)
  } else {
    return await artifacts.readArtifact(artifactName)
  }
}

async function assertInitializedAragonApp(instance, kernel, desc) {
  const initCheckDesc = `${desc}: is an initialized Aragon app`
  assert.equal(await instance.hasInitialized(), true, initCheckDesc)
  log.success(initCheckDesc)

  const kernelCheckDesc = `${desc} kernel: ${chalk.yellow(kernel.address)}`
  const appKernel = toChecksumAddress(await instance.kernel())
  assert.equal(appKernel, toChecksumAddress(kernel.address), kernelCheckDesc)
  log.success(kernelCheckDesc)
}

module.exports = runOrWrapScript(obtainDeployedAPM, module)
