const { ethers } = require('hardhat')
const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { deployWithoutProxy, deployBehindOssifiableProxy, getTotalGasUsed, getDeployTxParams } = require('../helpers/deploy')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')
const { assert } = require('chai')

const { APP_NAMES } = require('../constants')

const DEPLOYER = process.env.DEPLOYER || ''
const LIDO_LOCATOR_PROXY_PREDEPLOYED = process.env.LIDO_LOCATOR_PROXY_PREDEPLOYED || ''
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
  "wstethContractAddress",
  "oracleDaemonConfig",
  "withdrawalVault",
  "executionLayerRewardsVaultAddress",
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
  const treasuryAddress = agentAddress
  const beaconSpec = state["daoInitialSettings"]["beaconSpec"]
  const depositSecurityModuleParams = state["depositSecurityModule"].parameters
  const burnerParams = state["burner"].parameters
  const hashConsensusForAccountingParams = state["hashConsensusForAccounting"].parameters
  const hashConsensusForExitBusParams = state["hashConsensusForValidatorsExitBus"].parameters
  const withdrawalQueueERC721Params = state["withdrawalQueueERC721"].parameters
  const wstETHAddress = state["wstethContractAddress"]
  const oracleDaemonConfigParams = state["oracleDaemonConfig"].parameters
  const withdrawalVaultAddress = state["withdrawalVault"].address
  const elRewardsVaultAddress = state["executionLayerRewardsVaultAddress"]
  const votingAddress = state["app:aragon-voting"].proxyAddress

  if (!DEPLOYER) {
    throw new Error('DEPLOYER env variable is not specified')
  }

  const sanityChecks = state["oracleReportSanityChecker"].parameters
  logWideSplitter()

  if (!state.depositContractAddress && !state.daoInitialSettings.beaconSpec.depositContractAddress && isPublicNet) {
    throw new Error(`please specify deposit contract address in state file ${networkStateFile}`)
  }
  const depositContract = state.depositContractAddress || state.daoInitialSettings.beaconSpec.depositContractAddress


  // Deployer and admins
  const deployer = DEPLOYER
  const temporaryAdmin = deployer
  const proxyContractsOwner = temporaryAdmin
  const lidoLocatorProxyTemporaryOwner = temporaryAdmin
  const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000"
  const CONFIG_MANAGER_ROLE = "0xbbfb55d933c2bfa638763473275b1d84c4418e58d26cf9d2cd5758237756d9f0"
  const txParams = await getDeployTxParams(deployer)
  console.log({
    txParams,
    deployer,
  })
  let tx = null

  //
  // === OracleDaemonConfig ===
  //
  const oracleDaemonConfigArgs = [
    temporaryAdmin,
    [],
  ]
  const oracleDaemonConfigAddress = await deployWithoutProxy(
    'oracleDaemonConfig', 'OracleDaemonConfig', deployer, oracleDaemonConfigArgs)
  const oracleDaemonConfig = await ethers.getContractAt("OracleDaemonConfig", oracleDaemonConfigAddress)

  console.log(`oracleDaemonConfig.grantRole(${CONFIG_MANAGER_ROLE}, ${temporaryAdmin})...`)
  tx = await oracleDaemonConfig.grantRole(CONFIG_MANAGER_ROLE, temporaryAdmin, txParams)
  await tx.wait()

  for (const [key, value] of Object.entries(oracleDaemonConfigParams)) {
    let valueHex = `${value.toString(16)}`
    if (valueHex.length % 2 == 1) {
      valueHex = '0' + valueHex
    }
    valueHex = '0x' + valueHex
    console.log(`    oracleDaemonConfig.set(${key}, ${valueHex})...`)
    await oracleDaemonConfig.set(key, valueHex, txParams)
  }

  console.log(`oracleDaemonConfig.revokeRole(${CONFIG_MANAGER_ROLE}, ${temporaryAdmin})...`)
  tx = await oracleDaemonConfig.revokeRole(CONFIG_MANAGER_ROLE, temporaryAdmin, txParams)
  await tx.wait()

  console.log(`oracleDaemonConfig.grantRole(${DEFAULT_ADMIN_ROLE}, ${agentAddress})...`)
  tx = await oracleDaemonConfig.grantRole(DEFAULT_ADMIN_ROLE, agentAddress, txParams)
  await tx.wait()

  console.log(`oracleDaemonConfig.revokeRole(${DEFAULT_ADMIN_ROLE}, ${temporaryAdmin})...`)
  tx = await oracleDaemonConfig.revokeRole(DEFAULT_ADMIN_ROLE, temporaryAdmin, txParams)
  await tx.wait()
  logWideSplitter()

  //
  // DummyContract (for initial proxy deployment)
  //
  console.log("Deploying DummyEmptyContract...")
  const dummyContractAddress = await deployWithoutProxy("dummyEmptyContract", "DummyEmptyContract", deployer)
  console.log("Done")

  //
  // === LidoLocator: dummy invalid implementation ===
  //
  let locatorAddress = null
  if (LIDO_LOCATOR_PROXY_PREDEPLOYED) {
    locatorAddress = LIDO_LOCATOR_PROXY_PREDEPLOYED

    // Need to deploy something like locator here to increase nonce to keep the next deployed addresses the same
    await deployBehindOssifiableProxy('dummyDeployItemNotUsed', 'DummyEmptyContract', lidoLocatorProxyTemporaryOwner, deployer, [], implementation=dummyContractAddress)

    assert(network.name === 'mainnet-fork-shapella-upgrade', 'Using pre-deployed proxy of LidoLocator only allowed in the network for local fork tests')
    console.log(`Using pre-deployed address of proxy of LidoLocator ${locatorAddress}`)
  } else {
    locatorAddress = await deployBehindOssifiableProxy('lidoLocator', 'DummyEmptyContract', lidoLocatorProxyTemporaryOwner, deployer, [], implementation=dummyContractAddress)
  }
  logWideSplitter()

  //
  // === OracleReportSanityChecker ===
  //
  const oracleReportSanityCheckerArgs = [
    locatorAddress,
    agentAddress,
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
  // === WithdrawalQueueERC721 ===
  //
  const withdrawalQueueERC721Args = [
    wstETHAddress,
    withdrawalQueueERC721Params.name,
    withdrawalQueueERC721Params.symbol,
  ]
  const withdrawalQueueERC721Address = await deployBehindOssifiableProxy(
    "withdrawalQueueERC721", "DummyEmptyContract", proxyContractsOwner, deployer, [], implementation=dummyContractAddress)
  await deployWithoutProxy("withdrawalQueueERC721", "WithdrawalQueueERC721", deployer, withdrawalQueueERC721Args, "implementation")
  logWideSplitter()

  //
  // === WithdrawalVault ===
  //
  await deployWithoutProxy("withdrawalVault", "WithdrawalVault", deployer, [lidoAddress, treasuryAddress], "implementation")
  logWideSplitter()

  //
  // === StakingRouter ===
  //
  const stakingRouterAddress = await deployBehindOssifiableProxy("stakingRouter", "DummyEmptyContract", proxyContractsOwner, deployer, [], implementation=dummyContractAddress)
  await deployWithoutProxy("stakingRouter", "StakingRouter", deployer, [depositContract], "implementation")
  logWideSplitter()

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
  const accountingOracleAddress = await deployBehindOssifiableProxy("accountingOracle", "DummyEmptyContract", proxyContractsOwner, deployer, [], implementation=dummyContractAddress)
  await deployWithoutProxy("accountingOracle", "AccountingOracle", deployer, accountingOracleArgs, "implementation")
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
    temporaryAdmin, // admin
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
  const validatorsExitBusOracleAddress = await deployBehindOssifiableProxy("validatorsExitBusOracle", "DummyEmptyContract", proxyContractsOwner, deployer, [], implementation=dummyContractAddress)
  await deployWithoutProxy("validatorsExitBusOracle", "ValidatorsExitBusOracle", deployer, validatorsExitBusOracleArgs, "implementation")
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
    temporaryAdmin, // admin
    validatorsExitBusOracleAddress,  // reportProcessor
  ]
  await deployWithoutProxy("hashConsensusForValidatorsExitBus", "HashConsensus", deployer, hashConsensusForExitBusArgs)
  logWideSplitter()


  //
  // === Burner ===
  //
  const burnerArgs = [
    temporaryAdmin,
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
  await deployWithoutProxy("lidoLocator", "LidoLocator", deployer, [locatorConfig], "implementation")

  console.log(`Total gas used by this deploy script: ${getTotalGasUsed()}`)
}

module.exports = runOrWrapScript(deployNewContracts, module)
