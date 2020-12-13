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

const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'

async function finalizeDAO({ web3, artifacts, networkStateFile = NETWORK_STATE_FILE }) {
  const netId = await web3.eth.net.getId()

  log.splitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(networkStateFile, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  log.splitter()
  log(`Using AragonID name: ${chalk.yellow(state.daoAragonId)}`)

  log(`Using LidoTemplate: ${chalk.yellow(state.daoTemplateAddress)}`)
  const template = await artifacts.require('LidoTemplate').at(state.daoTemplateAddress)
  await assertLastEvent(template, 'TmplTokensIssued')
  log.splitter()

  const { fee } = state.daoInitialSettings
  log(`Using fee initial settings:`)
  log(`  total fee:`, chalk.yellow(`${fee.totalPercent}%`))
  log(`  treasury fee:`, chalk.yellow(`${fee.treasuryPercent}%`))
  log(`  insurance fee:`, chalk.yellow(`${fee.insurancePercent}%`))
  log(`  node operators fee:`, chalk.yellow(`${fee.nodeOperatorsPercent}%`))

  await assertVesting({
    tokenManagerAddress: state[`app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`].proxyAddress,
    tokenAddress: state.daoTokenAddress,
    vestingParams: state.vestingParams
  })

  log.splitter()

  await saveCallTxData(`finalizeDAO`, template, 'finalizeDAO', `tx-06-finalize-dao.json`, {
    arguments: [
      state.daoAragonId,
      percentToBP(fee.totalPercent),
      percentToBP(fee.treasuryPercent),
      percentToBP(fee.insurancePercent),
      percentToBP(fee.nodeOperatorsPercent)
    ],
    from: state.multisigAddress
  })
}

module.exports = runOrWrapScript(finalizeDAO, module)
