const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { deployWithoutProxy, deployBehindOssifiableProxy, updateProxyImplementation } = require('../helpers/deploy')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const { APP_NAMES } = require('../constants')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = [
  `app:${APP_NAMES.LIDO}`,
  `app:${APP_NAMES.ORACLE}`,
  "app:aragon-agent",
  "app:aragon-voting",
  "daoInitialSettings",
  "oracleReportSanityChecker",
  "burner",
  "hashConsensusForAccounting",
  "hashConsensusForValidatorsExitBus",
  "withdrawalQueueERC721",
]

async function deployNewContracts({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()
  logWideSplitter()
  log(`Network ID:`, yl(netId))
  let state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const lidoAddress = state["app:lido"].proxyAddress
  const legacyOracleAddress = state["app:oracle"].proxyAddress
  const agentAddress = state["app:aragon-agent"].proxyAddress
  const votingAddress = state["app:aragon-voting"].proxyAddress
  const treasuryAddress = agentAddress
  const beaconSpec = state["daoInitialSettings"]["beaconSpec"]
  const depositSecurityModuleParams = state["depositSecurityModule"].parameters
  const burnerParams = state["burner"].parameters
  const hashConsensusForAccountingParams = state["hashConsensusForAccounting"].parameters
  const hashConsensusForExitBusParams = state["hashConsensusForValidatorsExitBus"].parameters
  const withdrawalQueueERC721Params = state["withdrawalQueueERC721"].parameters

  if (!DEPLOYER) {
    throw new Error('Deployer is not specified')
  }

  // TODO
  // const proxyContractsOwner = votingAddress
  const proxyContractsOwner = DEPLOYER
  const admin = DEPLOYER
  const deployer = DEPLOYER

  const sanityChecks = state["oracleReportSanityChecker"].parameters
  logWideSplitter()

  if (!state.depositContractAddress && !state.daoInitialSettings.beaconSpec.depositContractAddress && isPublicNet) {
    throw new Error(`please specify deposit contract address in state file ${networkStateFile}`)
  }
  const depositContract = state.depositContractAddress || state.daoInitialSettings.beaconSpec.depositContractAddress

  // TODO: set proxyContractsOwner from state file? or from env?


  //
  // === OracleDaemonConfig ===
  //
  const oracleDaemonConfigArgs = [
    admin,
    [admin],
  ]
  const oracleDaemonConfigAddress = await deployWithoutProxy(
    'oracleDaemonConfig', 'OracleDaemonConfig', deployer, oracleDaemonConfigArgs)
  logWideSplitter()

  //
  // === LidoLocator: dummy invalid implementation ===
  //
  const locatorAddress = await deployBehindOssifiableProxy('lidoLocator', 'DummyEmptyContract', proxyContractsOwner, deployer)
  logWideSplitter()

  //
  // === OracleReportSanityChecker ===
  //
  const oracleReportSanityCheckerArgs = [
    locatorAddress,
    admin,
    [
      sanityChecks.churnValidatorsPerDayLimit,
      sanityChecks.oneOffCLBalanceDecreaseBPLimit,
      sanityChecks.annualBalanceIncreaseBPLimit,
      sanityChecks.simulatedShareRateDeviationBPLimit,
      sanityChecks.maxValidatorExitRequestsPerReport,
      sanityChecks.maxAccountingExtraDataListItemsCount,
      sanityChecks.maxNodeOperatorsPerExtraDataItemCount,
      sanityChecks.requestTimestampMargin,
      sanityChecks.maxPositiveTokenRebase,
    ],
    [
      [admin],
      [], [], [], [], [], [], [], [], []
    ]
  ]
  const oracleReportSanityCheckerAddress = await deployWithoutProxy(
    "oracleReportSanityChecker", "OracleReportSanityChecker", deployer, oracleReportSanityCheckerArgs)
  logWideSplitter()

  //
  // === EIP712StETH ===
  //
  await deployWithoutProxy("eip712StETH", "EIP712StETH", deployer, [lidoAddress])
  logWideSplitter()

  //
  // === WstETH ===
  //
  const wstETHAddress = await deployWithoutProxy("wstETH", "WstETH", deployer, [lidoAddress])
  logWideSplitter()

  //
  // === WithdrawalQueueERC721 ===
  //
  const withdrawalQueueERC721Args = [
    wstETHAddress,
    withdrawalQueueERC721Params.name,
    withdrawalQueueERC721Params.symbol,
  ]
  const withdrawalQueueERC721Address = await deployBehindOssifiableProxy(
    "withdrawalQueueERC721", "WithdrawalQueueERC721", proxyContractsOwner, deployer, withdrawalQueueERC721Args)
  logWideSplitter()


  //
  // === WithdrawalVault ===
  //
  const withdrawalVaultAddress = await deployBehindOssifiableProxy("withdrawalVault", "WithdrawalVault", proxyContractsOwner, deployer, [lidoAddress, treasuryAddress])
  logWideSplitter()

  //
  // === LidoExecutionLayerRewardsVault ===
  //
  const elRewardsVaultAddress = await deployWithoutProxy(
    "executionLayerRewardsVault", "LidoExecutionLayerRewardsVault", deployer, [lidoAddress, treasuryAddress]
  )
  logWideSplitter()

  //
  // === BeaconChainDepositor ===
  //
  await deployWithoutProxy("beaconChainDepositor", "BeaconChainDepositor", deployer, [depositContract])
  logWideSplitter()

  //
  // === StakingRouter ===
  //
  const stakingRouterAddress =
    await deployBehindOssifiableProxy("stakingRouter", "StakingRouter", proxyContractsOwner, deployer, [depositContract])

  //
  // === DepositSecurityModule ===
  //
  const {maxDepositsPerBlock, minDepositBlockDistance, pauseIntentValidityPeriodBlocks} = depositSecurityModuleParams
  const depositSecurityModuleArgs = [
    lidoAddress,
    depositContract,
    stakingRouterAddress,
    maxDepositsPerBlock,
    minDepositBlockDistance,
    pauseIntentValidityPeriodBlocks,
  ]
  const depositSecurityModuleAddress = await deployWithoutProxy(
    "depositSecurityModule", "DepositSecurityModule", deployer, depositSecurityModuleArgs)
  logWideSplitter()

  //
  // === AccountingOracle ===
  //
  const accountingOracleArgs = [
    locatorAddress,
    lidoAddress,
    legacyOracleAddress,
    beaconSpec.secondsPerSlot,
    beaconSpec.genesisTime,
  ]
  const accountingOracleAddress = await deployBehindOssifiableProxy(
    "accountingOracle", "AccountingOracle", proxyContractsOwner, deployer, accountingOracleArgs)
  logWideSplitter()

  //
  // === HashConsensus for AccountingOracle ===
  //
  const hashConsensusForAccountingArgs = [
    beaconSpec.slotsPerEpoch,
    beaconSpec.secondsPerSlot,
    beaconSpec.genesisTime,
    hashConsensusForAccountingParams.epochsPerFrame,
    hashConsensusForAccountingParams.fastLaneLengthSlots,
    admin, // admin
    accountingOracleAddress,  // reportProcessor
  ]
  await deployWithoutProxy("hashConsensusForAccounting", "HashConsensus", deployer, hashConsensusForAccountingArgs)
  logWideSplitter()

  //
  // === ValidatorsExitBusOracle ===
  //
  const validatorsExitBusOracleArgs = [
    beaconSpec.secondsPerSlot,
    beaconSpec.genesisTime,
    locatorAddress,
  ]
  const validatorsExitBusOracleAddress = await deployBehindOssifiableProxy(
    "validatorsExitBusOracle", "ValidatorsExitBusOracle", proxyContractsOwner, deployer, validatorsExitBusOracleArgs)
  logWideSplitter()

  //
  // === HashConsensus for ValidatorsExitBusOracle ===
  //
  const hashConsensusForExitBusArgs = [
    beaconSpec.slotsPerEpoch,
    beaconSpec.secondsPerSlot,
    beaconSpec.genesisTime,
    hashConsensusForExitBusParams.epochsPerFrame,
    hashConsensusForExitBusParams.fastLaneLengthSlots,
    admin, // admin
    validatorsExitBusOracleAddress,  // reportProcessor
  ]
  await deployWithoutProxy("hashConsensusForValidatorsExitBus", "HashConsensus", deployer, hashConsensusForExitBusArgs)
  logWideSplitter()


  //
  // === Burner ===
  //
  const burnerArgs = [
    admin,
    treasuryAddress,
    lidoAddress,
    burnerParams.totalCoverSharesBurnt,
    burnerParams.totalNonCoverSharesBurnt,
  ]
  const burnerAddress = await deployWithoutProxy("burner", "Burner", deployer, burnerArgs)
  logWideSplitter()

  //
  // === LidoLocator: update to valid implementation ===
  //
  const postTokenRebaseReceiver = legacyOracleAddress
  const locatorConfig = [
    accountingOracleAddress,
    depositSecurityModuleAddress,
    elRewardsVaultAddress,
    legacyOracleAddress,
    lidoAddress,
    oracleReportSanityCheckerAddress,
    postTokenRebaseReceiver,
    burnerAddress,
    stakingRouterAddress,
    treasuryAddress,
    validatorsExitBusOracleAddress,
    withdrawalQueueERC721Address,
    withdrawalVaultAddress,
    oracleDaemonConfigAddress,
  ]
  await updateProxyImplementation("lidoLocator", "LidoLocator", locatorAddress, proxyContractsOwner, [locatorConfig])
}

module.exports = runOrWrapScript(deployNewContracts, module)
