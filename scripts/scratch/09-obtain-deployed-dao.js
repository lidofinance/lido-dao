const path = require('path')
const chalk = require('chalk')
const { hash: namehash } = require('eth-ens-namehash')
const { toChecksumAddress } = require('web3-utils')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log } = require('../helpers/log')
const { assertLastEvent } = require('../helpers/events')
const { readNetworkState, persistNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { assertInstalledApps } = require('./checks/apps')
const { APP_NAMES } = require('../constants')

const REQUIRED_NET_STATE = [
  'lidoApmEnsName',
  'lidoTemplate',
  `app:${APP_NAMES.LIDO}`,
  `app:${APP_NAMES.ORACLE}`,
  `app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`
]

const VALID_APP_NAMES = Object.entries(APP_NAMES).map((e) => e[1])

async function obtainDeployedAPM({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  log.wideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const daoTemplateAddress = state.lidoTemplate.address

  log.splitter()


  log(`Using LidoTemplate: ${chalk.yellow(daoTemplateAddress)}`)
  const template = await artifacts.require('LidoTemplate').at(daoTemplateAddress)
  if (state.daoTemplateDeployBlock) {
    log(`Using LidoTemplate deploy block: ${chalk.yellow(state.daoTemplateDeployBlock)}`)
  }
  const daoDeployedEvt = await assertLastEvent(template, 'TmplDAOAndTokenDeployed', null, state.daoTemplateDeployBlock)

  const lidoApmEnsName = state.lidoApmEnsName
  const appIdNameEntries = VALID_APP_NAMES.map((name) => [namehash(`${name}.${lidoApmEnsName}`), name])
  const appNameByAppId = Object.fromEntries(appIdNameEntries)

  const fromBlock = state.daoTemplateDeployBlock // 4532202
  const appInstalledEvents = (await template.getPastEvents('TmplAppInstalled', { fromBlock })).map((evt) => evt.args)
  for (const evt of appInstalledEvents) {
    const appName = appNameByAppId[evt.appId]
    const proxyAddress = toChecksumAddress(evt.appProxy)
    console.log(`${appName}: ${proxyAddress}`)
  }

  state.newDaoTx = daoDeployedEvt.transactionHash
  log(`Using newDao transaction: ${chalk.yellow(state.newDaoTx)}`)
  persistNetworkState(network.name, netId, state)

  log.splitter()

  log(`Using Kernel: ${chalk.yellow(daoDeployedEvt.args.dao)}`)
  const dao = await artifacts.require('Kernel').at(daoDeployedEvt.args.dao)

  log(`Using MiniMeToken: ${chalk.yellow(daoDeployedEvt.args.token)}`)
  const daoToken = await artifacts.require('MiniMeToken').at(daoDeployedEvt.args.token)

  log.splitter()

  state.daoAddress = dao.address
  state.daoTokenAddress = daoToken.address

  const dataByAppId = await assertInstalledApps(
    {
      template,
      dao,
      lidoApmEnsName: state.lidoApmEnsName,
      appProxyUpgradeableArtifactName: 'external:AppProxyUpgradeable_DAO'
    },
    state.daoTemplateDeployBlock
  )

  for (const [appName, appData] of Object.entries(dataByAppId)) {
    const key = `app:${appName}`
    state[key] = { ...state[key], ...appData }
  }

  log.splitter()
  persistNetworkState(network.name, netId, state)
}

module.exports = runOrWrapScript(obtainDeployedAPM, module)
