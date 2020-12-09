const chalk = require('chalk')
const { assert } = require('chai')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const {
  readNetworkState,
  assertRequiredNetworkState,
  persistNetworkState
} = require('../helpers/persisted-network-state')

// this is needed for the next `require` to work, some kind of typescript path magic
require('@aragon/buidler-aragon/dist/bootstrap-paths')
const apmUtils = require('@aragon/buidler-aragon/dist/src/utils/apm/utils')

const REQUIRED_NET_STATE = [
  'multisigAddress',
  'daoTemplateAddress',
  'lido_app_lido',
  'lido_app_lidooracle',
  'lido_app_node-operators-registry'
]

const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'

async function createAppRepos({
  web3,
  artifacts,
  networkStateFile = NETWORK_STATE_FILE
}) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(networkStateFile, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  logSplitter()
  log(`Using DAO template: ${chalk.yellow(state.daoTemplateAddress)}`)
  logSplitter()

  const template = await artifacts.require('LidoTemplate3').at(state.daoTemplateAddress)

  const lidoAppState = state['lido_app_lido']
  const nodeOperatorsAppState = state['lido_app_node-operators-registry']
  const oracleAppState = state['lido_app_lidooracle']

  assignContentURI(lidoAppState)
  assignContentURI(nodeOperatorsAppState)
  assignContentURI(oracleAppState)

  await saveCallTxData(`createRepos`, template, 'createRepos', `tx-06-create-app-repos.json`, {
    arguments: [
      [1, 0, 0],
      // Lido app
      lidoAppState.baseAddress,
      lidoAppState.contentURI,
      // NodeOperatorsRegistry app
      nodeOperatorsAppState.baseAddress,
      nodeOperatorsAppState.contentURI,
      // LidoOracle app
      oracleAppState.baseAddress,
      oracleAppState.contentURI
    ],
    from: state.multisigAddress
  })

  logSplitter()
  persistNetworkState(networkStateFile, netId, state)
}

function assignContentURI(appState) {
  appState.contentURI = apmUtils.toContentUri('ipfs', appState.ipfsCid)
}

module.exports = runOrWrapScript(createAppRepos, module)
