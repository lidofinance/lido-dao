const chalk = require('chalk')
const { assert } = require('chai')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter } = require('../helpers/log')
const { assertLastEvent } = require('../helpers/events')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')
const { makeTx, TotalGasCounter } = require('../helpers/deploy')

const { APP_NAMES } = require('../constants')

const NULL_CONTENT_URI = "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"


const REQUIRED_NET_STATE = [
  'deployer',
  'lidoTemplate',
  `app:${APP_NAMES.LIDO}`,
  `app:${APP_NAMES.ORACLE}`,
  `app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`,
  `app:${APP_NAMES.ARAGON_AGENT}`,
  `app:${APP_NAMES.ARAGON_FINANCE}`,
  `app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`,
  `app:${APP_NAMES.ARAGON_VOTING}`,
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
  if (state.lidoTemplate.deployBlock) {
    log(`Using LidoTemplate deploy block: ${chalk.yellow(state.lidoTemplate.deployBlock)}`)
  }

  await assertLastEvent(template, 'TmplAPMDeployed', null, state.lidoTemplate.deployBlock)
  logSplitter()

  const lidoAppState = state[`app:${APP_NAMES.LIDO}`]
  const oracleAppState = state[`app:${APP_NAMES.ORACLE}`]
  const nodeOperatorsAppState = state[`app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`]

  const createReposArguments = [
    [1, 0, 0],
    // Lido app
    lidoAppState.implementation.address,
    NULL_CONTENT_URI,
    // NodeOperatorsRegistry app
    nodeOperatorsAppState.implementation.address,
    NULL_CONTENT_URI,
    // LegacyOracle app
    oracleAppState.implementation.address,
    NULL_CONTENT_URI,
  ]
  const from = state.deployer

  console.log({arguments, from})

  const lidoAppsReceipt = await makeTx(template, 'createRepos', createReposArguments, { from })
  console.log(`=== Aragon Lido Apps Repos (Lido, AccountingOracle, NodeOperatorsRegistry deployed: ${lidoAppsReceipt.tx} ===`)

  const createStdAragonReposArguments = [
    state['app:aragon-agent'].implementation.address,
    state['app:aragon-finance'].implementation.address,
    state['app:aragon-token-manager'].implementation.address,
    state['app:aragon-voting'].implementation.address,
  ]

  const aragonStdAppsReceipt = await makeTx(template, 'createStdAragonRepos', createStdAragonReposArguments, { from })
  console.log(`=== Aragon Std Apps Repos (Agent, Finance, TokenManager, Voting deployed: ${aragonStdAppsReceipt.tx} ===`)
  state.lidoTemplateCreateStdAppReposTx = aragonStdAppsReceipt.tx

  logSplitter()
  persistNetworkState(network.name, netId, state)

  await TotalGasCounter.incrementTotalGasUsedInStateFile()
}

module.exports = runOrWrapScript(createAppRepos, module)
