const chalk = require('chalk')
const { assert } = require('chai')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter } = require('../helpers/log')
const { assertLastEvent } = require('../helpers/events')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('../constants')

const DULL_CONTENT_URI = "0x697066733a516d516b4a4d7476753474794a76577250584a666a4c667954576e393539696179794e6a703759714e7a58377053"

const NO_ARAGON_UI = process.env.NO_ARAGON_UI

const REQUIRED_NET_STATE = [
  'multisigAddress',
  'lidoTemplate',
  `app:${APP_NAMES.LIDO}`,
  `app:${APP_NAMES.ORACLE}`,
  `app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`,
  `app:aragon-agent`,
  `app:aragon-finance`,
  `app:aragon-token-manager`,
  `app:aragon-voting`,
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


  const createReposArguments = [
    [1, 0, 0],
    // Lido app
    lidoAppState.implementation,
    NO_ARAGON_UI ? DULL_CONTENT_URI : lidoAppState.contentURI,
    // NodeOperatorsRegistry app
    nodeOperatorsAppState.implementation,
    NO_ARAGON_UI ? DULL_CONTENT_URI : nodeOperatorsAppState.contentURI,
    // LegacyOracle app
    oracleAppState.implementation,
    NO_ARAGON_UI ? DULL_CONTENT_URI : oracleAppState.contentURI,
  ]
  const from = state.multisigAddress

  console.log({arguments, from})

  const lidoAppsReceipt = await template.createRepos(...createReposArguments, { from })
  console.log(`=== Aragon Lido Apps Repos (Lido, AccountingOracle, NodeOperatorsRegistry deployed: ${lidoAppsReceipt.tx} ===`)


  const createStdAragonReposArguments = [
    state['app:aragon-agent']["implementation"]["address"],
    state['app:aragon-finance']["implementation"]["address"],
    state['app:aragon-token-manager']["implementation"]["address"],
    state['app:aragon-voting']["implementation"]["address"],
  ]

  const aragonStdAppsReceipt = await template.createStdAragonRepos(...createStdAragonReposArguments, { from })
  console.log(`=== Aragon Std Apps Repos (Agent, Finance, TokenManager, Voting deployed: ${aragonStdAppsReceipt.tx} ===`)

  logSplitter()
  persistNetworkState(network.name, netId, state)
}

module.exports = runOrWrapScript(createAppRepos, module)
