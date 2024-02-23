const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logWideSplitter, yl, gr } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')
const { deployWithoutProxy, deployBehindOssifiableProxy, updateProxyImplementation, deployImplementation, deployContract, getContractPath, TotalGasCounter } = require('../helpers/deploy')

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
  "hashConsensusForAccountingOracle",
  "hashConsensusForValidatorsExitBusOracle",
  "withdrawalQueueERC721",
]

async function deployNewContracts({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()
  logWideSplitter()
  log(`Network ID:`, yl(netId))
  let state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const lidoAddress = state["app:lido"].proxy.address
  const legacyOracleAddress = state["app:oracle"].proxy.address
  const votingAddress = state["app:aragon-voting"].proxy.address
  const agentAddress = state["app:aragon-agent"].proxy.address
  const treasuryAddress = agentAddress
  const chainSpec = state["chainSpec"]
  const depositSecurityModuleParams = state["depositSecurityModule"].deployParameters
  const burnerParams = state["burner"].deployParameters
  const hashConsensusForAccountingParams = state["hashConsensusForAccountingOracle"].deployParameters
  const hashConsensusForExitBusParams = state["hashConsensusForValidatorsExitBusOracle"].deployParameters
  const withdrawalQueueERC721Params = state["withdrawalQueueERC721"].deployParameters

  if (!DEPLOYER) {
    throw new Error('Deployer is not specified')
  }

  const proxyContractsOwner = DEPLOYER
  const admin = DEPLOYER
  const deployer = DEPLOYER

  const sanityChecks = state["oracleReportSanityChecker"].deployParameters
  logWideSplitter()

  if (!chainSpec.depositContract) {
    throw new Error(`please specify deposit contract address in state file at /chainSpec/depositContract`)
  }
  const depositContract = state.chainSpec.depositContract

  //
  // === OracleDaemonConfig ===
  //
  const oracleDaemonConfigArgs = [
    admin,
    [],
  ]
  const oracleDaemonConfigAddress = await deployWithoutProxy(
    'oracleDaemonConfig', 'OracleDaemonConfig', deployer, oracleDaemonConfigArgs)
  logWideSplitter()

  //
  // === DummyEmptyContract ===
  //
  const dummyContractAddress = await deployWithoutProxy('dummyEmptyContract', 'DummyEmptyContract', deployer)


  //
  // === LidoLocator: dummy invalid implementation ===
  //
  const locatorAddress = await deployBehindOssifiableProxy('lidoLocator', 'DummyEmptyContract', proxyContractsOwner, deployer, [], dummyContractAddress)
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
      [],
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
  const withdrawalVaultImpl = await deployImplementation("withdrawalVault", "WithdrawalVault", deployer, [lidoAddress, treasuryAddress])
  state = readNetworkState(network.name, netId)
  const withdrawalsManagerProxyConstructorArgs = [votingAddress, withdrawalVaultImpl.address]
  const withdrawalsManagerProxy = await deployContract("WithdrawalsManagerProxy", withdrawalsManagerProxyConstructorArgs, deployer)
  const withdrawalVaultAddress = withdrawalsManagerProxy.address
  state.withdrawalVault = {
    ...state.withdrawalVault,
    proxy: {
      contract: await getContractPath("WithdrawalsManagerProxy"),
      address: withdrawalsManagerProxy.address,
      constructorArgs: withdrawalsManagerProxyConstructorArgs,
    },
    address: withdrawalsManagerProxy.address,
  }
  persistNetworkState(network.name, netId, state)
  logWideSplitter()

  //
  // === LidoExecutionLayerRewardsVault ===
  //
  const elRewardsVaultAddress = await deployWithoutProxy(
    "executionLayerRewardsVault", "LidoExecutionLayerRewardsVault", deployer, [lidoAddress, treasuryAddress]
  )
  logWideSplitter()

  //
  // === StakingRouter ===
  //
  const stakingRouterAddress =
    await deployBehindOssifiableProxy("stakingRouter", "StakingRouter", proxyContractsOwner, deployer, [depositContract])

  //
  // === DepositSecurityModule ===
  //
  let depositSecurityModuleAddress = depositSecurityModuleParams.usePredefinedAddressInstead
  if (depositSecurityModuleAddress === null) {
    const {maxDepositsPerBlock, minDepositBlockDistance, pauseIntentValidityPeriodBlocks} = depositSecurityModuleParams
    const depositSecurityModuleArgs = [
      lidoAddress,
      depositContract,
      stakingRouterAddress,
      maxDepositsPerBlock,
      minDepositBlockDistance,
      pauseIntentValidityPeriodBlocks,
    ]
    depositSecurityModuleAddress = await deployWithoutProxy(
      "depositSecurityModule", "DepositSecurityModule", deployer, depositSecurityModuleArgs)
  } else {
    console.log(`NB: skipping deployment of DepositSecurityModule - using the predefined address ${depositSecurityModuleAddress} instead`)
  }
  logWideSplitter()

  //
  // === AccountingOracle ===
  //
  const accountingOracleArgs = [
    locatorAddress,
    lidoAddress,
    legacyOracleAddress,
    Number(chainSpec.secondsPerSlot),
    Number(chainSpec.genesisTime),
  ]
  const accountingOracleAddress = await deployBehindOssifiableProxy(
    "accountingOracle", "AccountingOracle", proxyContractsOwner, deployer, accountingOracleArgs)
  logWideSplitter()

  //
  // === HashConsensus for AccountingOracle ===
  //
  const hashConsensusForAccountingArgs = [
    chainSpec.slotsPerEpoch,
    chainSpec.secondsPerSlot,
    chainSpec.genesisTime,
    hashConsensusForAccountingParams.epochsPerFrame,
    hashConsensusForAccountingParams.fastLaneLengthSlots,
    admin, // admin
    accountingOracleAddress,  // reportProcessor
  ]
  await deployWithoutProxy("hashConsensusForAccountingOracle", "HashConsensus", deployer, hashConsensusForAccountingArgs)
  logWideSplitter()

  //
  // === ValidatorsExitBusOracle ===
  //
  const validatorsExitBusOracleArgs = [
    chainSpec.secondsPerSlot,
    chainSpec.genesisTime,
    locatorAddress,
  ]
  const validatorsExitBusOracleAddress = await deployBehindOssifiableProxy(
    "validatorsExitBusOracle", "ValidatorsExitBusOracle", proxyContractsOwner, deployer, validatorsExitBusOracleArgs)
  logWideSplitter()

  //
  // === HashConsensus for ValidatorsExitBusOracle ===
  //
  const hashConsensusForExitBusArgs = [
    chainSpec.slotsPerEpoch,
    chainSpec.secondsPerSlot,
    chainSpec.genesisTime,
    hashConsensusForExitBusParams.epochsPerFrame,
    hashConsensusForExitBusParams.fastLaneLengthSlots,
    admin, // admin
    validatorsExitBusOracleAddress,  // reportProcessor
  ]
  await deployWithoutProxy("hashConsensusForValidatorsExitBusOracle", "HashConsensus", deployer, hashConsensusForExitBusArgs)
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

  await TotalGasCounter.incrementTotalGasUsedInStateFile()
}

module.exports = runOrWrapScript(deployNewContracts, module)
