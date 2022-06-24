const chalk = require('chalk')
const namehash = require('eth-ens-namehash').hash

const runOrWrapScript = require('./helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, logHeader, logTx } = require('./helpers/log')
const { deploy, withArgs } = require('./helpers/deploy')
const { readNetworkState, persistNetworkState, updateNetworkState } = require('./helpers/persisted-network-state')

const { deployAPM, resolveLatestVersion } = require('./components/apm')
const { getENSNodeOwner } = require('./components/ens')

const LIDO_ENS_LABEL = process.env.LIDO_ENS_LABEL || 'lidopm'
const DAO_TEMPLATE_ENS_LABEL = process.env.DAO_TEMPLATE_ENS_LABEL || 'template'
const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'

const REQUIRED_NET_STATE = [
  'owner',
  'multisigAddress',
  'ensAddress',
  'apmRegistryFactoryAddress',
  'daoFactoryAddress',
  'miniMeTokenFactoryAddress'
]

async function deployApmAndTemplate({
  web3,
  artifacts,
  networkStateFile = NETWORK_STATE_FILE,
  defaultLidoEnsLabelName = LIDO_ENS_LABEL,
  defaultDaoTemplateEnsLabel = DAO_TEMPLATE_ENS_LABEL
}) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)

  const missingState = REQUIRED_NET_STATE.filter((key) => !state[key])
  if (missingState.length) {
    const missingDesc = missingState.join(', ')
    throw new Error(`missing following fields from network state file, make sure you've run previous deployment steps: ${missingDesc}`)
  }

  log(`Owner: ${chalk.yellow(state.owner)}`)

  const ens = await artifacts.require('ENS').at(state.ensAddress)
  log(`Using ENS: ${chalk.yellow(ens.address)}`)

  if (!state.lidoEnsLabelName) {
    state.lidoEnsLabelName = defaultLidoEnsLabelName
    log(`Using default Lido ENS label: ${chalk.yellow(state.lidoEnsLabelName)}`)
  }

  if (!state.daoTemplateEnsLabel) {
    state.daoTemplateEnsLabel = defaultDaoTemplateEnsLabel
    log(`Using default DAO template ENS label: ${chalk.yellow(state.daoTemplateEnsLabel)}`)
  }

  logHeader(`Lido APM`)
  const apmRegistryFactory = await artifacts.require('APMRegistryFactory').at(state.apmRegistryFactoryAddress)
  const apmResults = await deployAPM({
    web3,
    artifacts,
    ens,
    apmRegistryFactory,
    owner: state.owner,
    labelName: state.lidoEnsLabelName,
    apmRegistryAddress: state.lidoApmAddress
  })
  updateNetworkState(state, {
    lidoApmRegistry: apmResults.apmRegistry,
    lidoEnsNodeName: apmResults.ensNodeName,
    lidoEnsNode: apmResults.ensNode
  })
  persistNetworkState(network.name, netId, state)

  logHeader(`DAO template`)
  const daoTemplateResults = await deployDaoTemplate({
    artifacts,
    ens,
    owner: state.owner,
    lidoEnsNodeName: state.lidoEnsNodeName,
    lidoApmAddress: state.lidoApmAddress,
    daoFactoryAddress: state.daoFactoryAddress,
    miniMeTokenFactoryAddress: state.miniMeTokenFactoryAddress,
    daoTemplateEnsLabel: state.daoTemplateEnsLabel,
    daoTemplateAddress: state.daoTemplateAddress
  })
  updateNetworkState(state, daoTemplateResults)
  persistNetworkState(network.name, netId, state)
}

async function deployDaoTemplate({
  artifacts,
  owner,
  ens,
  lidoApmAddress,
  daoFactoryAddress,
  miniMeTokenFactoryAddress,
  lidoEnsNodeName,
  daoTemplateEnsLabel,
  daoTemplateAddress
}) {
  if (daoTemplateAddress) {
    log(`Using DAO template: ${chalk.yellow(daoTemplateAddress)}`)
    const daoTemplate = await artifacts.require('LidoTemplate').at(daoTemplateAddress)
    return { daoTemplate }
  }

  const daoTemplateNodeName = `${daoTemplateEnsLabel}.${lidoEnsNodeName}`
  const daoTemplateNode = namehash(daoTemplateNodeName)
  log(`DAO template name: ${chalk.yellow(daoTemplateNodeName)} (${daoTemplateNode})`)

  const latestDaoTemplateVersion = await resolveLatestVersion(daoTemplateNode, ens, artifacts)
  if (latestDaoTemplateVersion) {
    log(`Using DAO template resolved from ENS: ${chalk.yellow(latestDaoTemplateVersion.contractAddress)}`)
    const daoTemplate = await artifacts.require('LidoTemplate').at(latestDaoTemplateVersion.contractAddress)
    return { daoTemplate, daoTemplateNodeName, daoTemplateNode }
  }

  log(`Using Lido APM registry: ${chalk.yellow(lidoApmAddress)}`)
  const lidoApmRegistry = await artifacts.require('APMRegistry').at(lidoApmAddress)

  const aragonIdAddress = await getENSNodeOwner(ens, namehash('aragonid.eth'))
  if (aragonIdAddress) {
    log(`Using AragonID: ${chalk.yellow(aragonIdAddress)}`)
  } else {
    throw new Error(`failed to resolve AragonID (aragonid.eth)`)
  }

  const daoTemplate = await deploy(
    'LidoTemplate',
    artifacts,
    withArgs(owner, daoFactoryAddress, ens.address, miniMeTokenFactoryAddress, aragonIdAddress, { from: owner, gas: 6000000 })
  )
  logSplitter()

  await logTx(
    `Registering package for DAO template as '${daoTemplateNodeName}'...`,
    lidoApmRegistry.newRepoWithVersion(daoTemplateEnsLabel, owner, [1, 0, 0], daoTemplate.address, '0x0', { from: owner })
  )

  return { daoTemplate, daoTemplateNodeName, daoTemplateNode }
}

module.exports = runOrWrapScript(deployApmAndTemplate, module)
