const chalk = require('chalk')
const { assert } = require('chai')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { assertLastEvent } = require('../helpers/events')
const { makeTx, TotalGasCounter } = require('../helpers/deploy')

const { APP_NAMES } = require('../constants')
const { assertVesting } = require('./checks/dao-token')

const REQUIRED_NET_STATE = [
  'ldo',
  'lidoTemplate',
  'daoAragonId',
  'daoInitialSettings',
  'vestingParams',
  `app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`,
  'stakingRouter',
  'deployer',
]

async function finalizeDAO({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  log.splitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const daoTemplateAddress = state.lidoTemplate.address

  log.splitter()
  log(`Using AragonID name: ${chalk.yellow(state.daoAragonId)}`)

  log(`Using LidoTemplate: ${chalk.yellow(daoTemplateAddress)}`)
  const template = await artifacts.require('LidoTemplate').at(daoTemplateAddress)
  if (state.lidoTemplate.deployBlock) {
    log(`Using LidoTemplate deploy block: ${chalk.yellow(state.lidoTemplate.deployBlock)}`)
  }
  await assertLastEvent(template, 'TmplTokensIssued', null, state.lidoTemplate.deployBlock)
  log.splitter()

  const tokenManagerAddress = state[`app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`].proxy.address
  log(`Using TokenManager:`, chalk.yellow(tokenManagerAddress))
  const tokenManager = await artifacts.require('TokenManager').at(tokenManagerAddress)

  log(`Using MiniMeToken`, chalk.yellow(state.ldo.address))
  const daoToken = await artifacts.require('MiniMeToken').at(state.ldo.address)

  const { fee } = state.daoInitialSettings
  log(`Using fee initial settings:`)
  log(`  total fee:`, chalk.yellow(`${fee.totalPercent}%`))
  log(`  treasury fee:`, chalk.yellow(`${fee.treasuryPercent}%`))
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

  await makeTx(template, 'finalizeDAO', [
    state.daoAragonId,
    state.vestingParams.unvestedTokensAmount,
    state.stakingRouter.proxy.address
  ], { from: state.deployer })

  await TotalGasCounter.incrementTotalGasUsedInStateFile()
}

module.exports = runOrWrapScript(finalizeDAO, module)
