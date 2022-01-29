const chalk = require('chalk')
const { assert } = require('chai')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log } = require('../helpers/log')
const { readNetworkState, persistNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { saveCallTxData } = require('../helpers/tx-data')
const { assertLastEvent } = require('../helpers/events')
const { percentToBP } = require('../helpers/index')

const { APP_NAMES } = require('./constants')
const { assertVesting } = require('./checks/dao-token')

const REQUIRED_NET_STATE = [
  'daoAddress',
  'daoTokenAddress',
  'daoAragonId',
  'daoInitialSettings',
  'vestingParams',
  `app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`
]

async function finalizeDAO({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  log.splitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  log.splitter()
  log(`Using AragonID name: ${chalk.yellow(state.daoAragonId)}`)

  log(`Using LidoTemplate: ${chalk.yellow(state.daoTemplateAddress)}`)
  const template = await artifacts.require('LidoTemplate').at(state.daoTemplateAddress)
  if (state.daoTemplateDeployBlock) {
    log(`Using LidoTemplate deploy block: ${chalk.yellow(state.daoTemplateDeployBlock)}`)
  }
  await assertLastEvent(template, 'TmplTokensIssued', null, state.daoTemplateDeployBlock)
  log.splitter()

  const tokenManagerAddress = state[`app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`].proxyAddress
  log(`Using TokenManager:`, chalk.yellow(tokenManagerAddress))
  const tokenManager = await artifacts.require('TokenManager').at(tokenManagerAddress)

  log(`Using MiniMeToken`, chalk.yellow(state.daoTokenAddress))
  const daoToken = await artifacts.require('MiniMeToken').at(state.daoTokenAddress)

  const { fee } = state.daoInitialSettings
  log(`Using fee initial settings:`)
  log(`  total fee:`, chalk.yellow(`${fee.totalPercent}%`))
  log(`  treasury fee:`, chalk.yellow(`${fee.treasuryPercent}%`))
  log(`  insurance fee:`, chalk.yellow(`${fee.insurancePercent}%`))
  log(`  node operators fee:`, chalk.yellow(`${fee.nodeOperatorsPercent}%`))

  await assertVesting({
    tokenManager,
    token: daoToken,
    vestingParams: {
      ...state.vestingParams,
      unvestedTokensAmount: '0' // since we're minting them during the finalizeDAO call below
    }
  })

  log.splitter()

  await saveCallTxData(`finalizeDAO`, template, 'finalizeDAO', `tx-07-finalize-dao.json`, {
    arguments: [
      state.daoAragonId,
      percentToBP(fee.totalPercent),
      percentToBP(fee.treasuryPercent),
      percentToBP(fee.insurancePercent),
      percentToBP(fee.nodeOperatorsPercent),
      state.vestingParams.unvestedTokensAmount
    ],
    from: state.multisigAddress
  })
}

module.exports = runOrWrapScript(finalizeDAO, module)
