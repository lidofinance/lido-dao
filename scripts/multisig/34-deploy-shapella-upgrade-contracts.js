const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveDeployTx } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')
const { deployWithoutProxy, deployBehindOssifiableProxy } = require('../helpers/deploy-shapella')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const { APP_NAMES } = require('./constants')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = [
  "depositContractAddress",
  "app:lido",
  "app:aragon-agent",
  "app:aragon-voting",
  "daoInitialSettings",
]

const e18 = 10 ** 18
function toE18(value) {
  return bn(value.toString()).mul(bn(e18.toString()))
}

function calcRateLimitParameters(maxRequestsPerDay) {
  const blockDurationSeconds = 12
  const secondsInDay = 24 * 60 * 60
  const blocksInDay = secondsInDay / blockDurationSeconds

  const maxRequestsPerDayE18 = toE18(maxRequestsPerDay)
  return [toE18(maxRequestsPerDay), maxRequestsPerDayE18.div(bn(blocksInDay))]
}

async function deployNewContracts({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()
  logWideSplitter()
  log(`Network ID:`, yl(netId))
  let state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const lido = state["app:lido"].proxyAddress
  const agent = state["app:aragon-agent"].proxyAddress
  const voting = state["app:aragon-voting"].proxyAddress
  const beaconSpec = state["daoInitialSettings"]["beaconSpec"]
  logWideSplitter()
  const proxyContractsOwner = voting

  //
  // === WstETH ===
  //
  const wstETH = await deployWithoutProxy("wstETH", "WstETH", [lido])
  logWideSplitter()

  //
  // === LidoExecutionLayerRewardsVault ===
  //
  const elRewardsVaultAddress = await deployWithoutProxy(
    "executionLayerRewardsVault", "LidoExecutionLayerRewardsVault", [lido, agent]
  )
  logWideSplitter()

  //
  // === WithdrawalVault ===
  //
  const withdrawalVaultAddress = await deployWithoutProxy("withdrawalVault", "WithdrawalVault", [lido, agent])
  logWideSplitter()

  //
  // === ValidatorExitBus ===
  //
  const validatorExitBusAddress = await deployBehindOssifiableProxy("validatorExitBus", "ValidatorExitBus", proxyContractsOwner, DEPLOYER, [])

  const [maxRequestsPerDayE18, numRequestsLimitIncreasePerBlockE18] = calcRateLimitParameters(2000)
  const busInitializationArgs = [
    voting,
    maxRequestsPerDayE18,
    numRequestsLimitIncreasePerBlockE18,
    beaconSpec.epochsPerFrame,
    beaconSpec.slotsPerEpoch,
    beaconSpec.secondsPerSlot,
    beaconSpec.genesisTime,
  ]
  console.log(busInitializationArgs.map((x) => (x.toString())))
  const validatorExitBus = await artifacts.require('ValidatorExitBus').at(validatorExitBusAddress)
  await validatorExitBus.initialize(
    ...busInitializationArgs,
    { from: DEPLOYER }
  )
  logWideSplitter()  // ValidatorExitBus

  //
  // === StakingRouter ===
  //
  const depositContract = state.depositContractAddress
  const stakingRouterAddress =
    await deployBehindOssifiableProxy("stakingRouter", "StakingRouter", proxyContractsOwner, DEPLOYER, [depositContract])

  const withdrawalCredentials = `0x010000000000000000000000${withdrawalVaultAddress.slice(2)}`
  console.log({withdrawalCredentials})
  const stakingRouterInitArgs = [
    voting,
    lido,
    withdrawalCredentials,
  ]
  console.log({ stakingRouterInitArgs })
  const stakingRouter = await artifacts.require('StakingRouter').at(stakingRouterAddress)
  await stakingRouter.initialize(
    ...stakingRouterInitArgs,
    { from: DEPLOYER },
  )
  logWideSplitter()

  //
  // === WithdrawalQueue ===
  //
  state = readNetworkState(network.name, netId)
  const withdrawalQueueAddress =
    await deployBehindOssifiableProxy("withdrawalQueue", "WithdrawalQueue", proxyContractsOwner, DEPLOYER, [lido, wstETH])
    const withdrawalQueueInitArgs = [
      voting,
      lido,
      voting,
      voting,
    ]
  console.log({ withdrawalQueueInitArgs })
  const withdrawalQueue = await artifacts.require('WithdrawalQueue').at(withdrawalQueueAddress)
  await withdrawalQueue.initialize(
    ...withdrawalQueueInitArgs,
    { from: DEPLOYER },
  )
  logWideSplitter()

  //
  // === BeaconChainDepositor ===
  //
  const beaconChainDepositorAddress = await deployWithoutProxy(
    "beaconChainDepositor", "BeaconChainDepositor", [depositContract])
  logWideSplitter()

  //
  // === DepositSecurityModule ===
  //
  const maxDepositsPerBlock = 150  // as in mainnet
  const minDepositBlockDistance = 25  // as in mainnet
  const pauseIntentValidityPeriodBlocks = 6646  // as in mainnet
  const depositSecurityModuleConstructorArgs = [
    lido,
    depositContract,
    stakingRouterAddress,
    maxDepositsPerBlock,
    minDepositBlockDistance,
    pauseIntentValidityPeriodBlocks,
  ]
  const depositSecurityModuleAddress =
    await deployWithoutProxy("depositSecurityModule", "DepositSecurityModule", depositSecurityModuleConstructorArgs)
  console.log({ depositSecurityModuleConstructorArgs })
}

module.exports = runOrWrapScript(deployNewContracts, module)
