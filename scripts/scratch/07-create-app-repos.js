const chalk = require('chalk')
const { assert } = require('chai')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const { assertLastEvent } = require('../helpers/events')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('../constants')

const REQUIRED_NET_STATE = [
  'multisigAddress',
  'lidoTemplate',
  `app:${APP_NAMES.LIDO}`,
  `app:${APP_NAMES.ORACLE}`,
  `app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`
]

async function createAppRepos({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const daoTemplateAddress = state.lidoTemplate.address

  logSplitter()
  log(`Using LidoTemplate: ${chalk.yellow(daoTemplateAddress)}`)
  const template = await artifacts.require('LidoTemplate').at(daoTemplateAddress)
  if (state.daoTemplateDeployBlock) {
    log(`Using LidoTemplate deploy block: ${chalk.yellow(state.daoTemplateDeployBlock)}`)
  }

  await assertLastEvent(template, 'TmplAPMDeployed', null, state.daoTemplateDeployBlock)
  logSplitter()

  const lidoAppState = state[`app:${APP_NAMES.LIDO}`]
  const oracleAppState = state[`app:${APP_NAMES.ORACLE}`]
  const nodeOperatorsAppState = state[`app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`]

  await saveCallTxData(`createRepos`, template, 'createRepos', `tx-07-create-app-repos.json`, {
    arguments: [
      [1, 0, 0],
      // Lido app
      lidoAppState.implementation,
      lidoAppState.contentURI,
      // NodeOperatorsRegistry app
      nodeOperatorsAppState.implementation,
      nodeOperatorsAppState.contentURI,
      // LegacyOracle app
      oracleAppState.implementation,
      oracleAppState.contentURI,
    ],
    from: state.multisigAddress
  })

  logSplitter()
  persistNetworkState(network.name, netId, state)
}

module.exports = runOrWrapScript(createAppRepos, module)
