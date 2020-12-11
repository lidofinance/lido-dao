const chalk = require('chalk')
const { assert } = require('chai')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

// this is needed for the next `require` to work, some kind of typescript path magic
require('@aragon/buidler-aragon/dist/bootstrap-paths')
const apmUtils = require('@aragon/buidler-aragon/dist/src/utils/apm/utils')

const { APP_NAMES } = require('./constants')

const REQUIRED_NET_STATE = [
  'multisigAddress',
  'daoTemplateAddress',
  `app:${APP_NAMES.LIDO}`,
  `app:${APP_NAMES.ORACLE}`,
  `app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`
]

const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'

async function createAppRepos({ web3, artifacts, networkStateFile = NETWORK_STATE_FILE }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(networkStateFile, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  logSplitter()
  log(`Using DAO template: ${chalk.yellow(state.daoTemplateAddress)}`)
  logSplitter()

  const template = await artifacts.require('LidoTemplate3').at(state.daoTemplateAddress)

  const lidoAppState = state[`app:${APP_NAMES.LIDO}`]
  const oracleAppState = state[`app:${APP_NAMES.ORACLE}`]
  const nodeOperatorsAppState = state[`app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`]

  assignContentURI(lidoAppState)
  assignContentURI(oracleAppState)
  assignContentURI(nodeOperatorsAppState)

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
