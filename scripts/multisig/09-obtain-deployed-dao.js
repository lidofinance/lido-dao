const path = require('path')
const chalk = require('chalk')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log } = require('../helpers/log')
const { assertLastEvent } = require('../helpers/events')
const { readNetworkState, persistNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { assertInstalledApps } = require('./checks/apps')
const { APP_NAMES } = require('./constants')

const REQUIRED_NET_STATE = [
  'lidoApmEnsName',
  'daoTemplateAddress',
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

  log(`Using LidoTemplate: ${chalk.yellow(state.daoTemplateAddress)}`)
  const template = await artifacts.require('LidoTemplate').at(state.daoTemplateAddress)

  const daoDeployedEvt = await assertLastEvent(template, 'TmplDAOAndTokenDeployed')
  state.newDaoTx = daoDeployedEvt.transactionHash
  log(`Using newDao transaction: ${chalk.yellow(state.newDaoTx)}`)
  persistNetworkState(networkStateFile, netId, state)

  log.splitter()

  log(`Using Kernel: ${chalk.yellow(daoDeployedEvt.args.dao)}`)
  const dao = await artifacts.require('Kernel').at(daoDeployedEvt.args.dao)

  log(`Using MiniMeToken: ${chalk.yellow(daoDeployedEvt.args.token)}`)
  const daoToken = await artifacts.require('MiniMeToken').at(daoDeployedEvt.args.token)

  log.splitter()

  state.daoAddress = dao.address
  state.daoTokenAddress = daoToken.address

  const dataByAppId = await assertInstalledApps({
    template,
    dao,
    lidoApmEnsName: state.lidoApmEnsName,
    appProxyUpgradeableArtifactName: 'external:AppProxyUpgradeable_DAO'
  })

  for (const [appName, appData] of Object.entries(dataByAppId)) {
    const key = `app:${appName}`
    state[key] = { ...state[key], ...appData }
  }

  log.splitter()
  persistNetworkState(networkStateFile, netId, state)
}

module.exports = runOrWrapScript(obtainDeployedAPM, module)
