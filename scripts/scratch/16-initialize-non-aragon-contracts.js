const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logWideSplitter, yl, gr } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { hexPaddedToByte } = require('../../test/helpers/utils')
const { APP_NAMES } = require('../constants')
const { makeTx, TotalGasCounter } = require('../helpers/deploy')


const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = [
  `app:${APP_NAMES.LIDO}`,
  `app:${APP_NAMES.ORACLE}`,
  "app:aragon-agent",
  "app:aragon-voting",
  "app:node-operators-registry",
  "lidoLocator",
  "stakingRouter",
  "daoInitialSettings",
  "eip712StETH",
  "accountingOracle",
  "hashConsensusForAccountingOracle",
  "validatorsExitBusOracle",
  "hashConsensusForValidatorsExitBusOracle",
  "withdrawalQueueERC721",
  "withdrawalVault",
  "nodeOperatorsRegistry",
]


async function deployNewContracts({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()
  logWideSplitter()
  log(`Network ID:`, yl(netId))

  let state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const lidoAddress = state["app:lido"].proxy.address
  const legacyOracleAddress = state["app:oracle"].proxy.address
  const nodeOperatorsRegistryAddress = state["app:node-operators-registry"].proxy.address
  const nodeOperatorsRegistryParams = state["nodeOperatorsRegistry"].deployParameters

  const validatorsExitBusOracleParams = state["validatorsExitBusOracle"].deployParameters
  const accountingOracleParams = state["accountingOracle"].deployParameters

  const stakingRouterAddress = state["stakingRouter"].proxy.address
  const withdrawalQueueAddress = state["withdrawalQueueERC721"].proxy.address
  const lidoLocatorAddress = state["lidoLocator"].proxy.address
  const accountingOracleAddress = state["accountingOracle"].proxy.address
  const hashConsensusForAccountingAddress = state["hashConsensusForAccountingOracle"].address
  const ValidatorsExitBusOracleAddress = state["validatorsExitBusOracle"].proxy.address
  const hashConsensusForValidatorsExitBusOracleAddress = state["hashConsensusForValidatorsExitBusOracle"].address
  const eip712StETHAddress = state["eip712StETH"].address
  const withdrawalVaultAddress = state["withdrawalVault"].proxy.address
  const oracleDaemonConfigAddress = state.oracleDaemonConfig.address

  const testnetAdmin = DEPLOYER
  const accountingOracleAdmin = testnetAdmin
  const exitBusOracleAdmin = testnetAdmin
  const stakingRouterAdmin = testnetAdmin
  const withdrawalQueueAdmin = testnetAdmin

  //
  // === NodeOperatorsRegistry: initialize ===
  //
  // https://github.com/ethereum/solidity-examples/blob/master/docs/bytes/Bytes.md#description
  const stakingModuleTypeId = web3.utils.padRight(web3.utils.stringToHex(
    nodeOperatorsRegistryParams.stakingModuleTypeId
  ), 64)
  const nodeOperatorsRegistryArgs = [
    lidoLocatorAddress,
    stakingModuleTypeId,
    nodeOperatorsRegistryParams.stuckPenaltyDelay,
  ]
  const nodeOperatorsRegistry = await artifacts.require('NodeOperatorsRegistry').at(nodeOperatorsRegistryAddress)
  await makeTx(nodeOperatorsRegistry, 'initialize', nodeOperatorsRegistryArgs, { from: DEPLOYER })

  //
  // === Lido: initialize ===
  //
  const lidoInitArgs = [
    lidoLocatorAddress,
    eip712StETHAddress,
  ]
  const bootstrapInitBalance = 10 // wei
  const lido = await artifacts.require('Lido').at(lidoAddress)
  await makeTx(lido, 'initialize', lidoInitArgs, { value: bootstrapInitBalance, from: DEPLOYER })
  logWideSplitter()

  //
  // === LegacyOracle: initialize ===
  //
  const legacyOracleArgs = [
    lidoLocatorAddress,
    hashConsensusForAccountingAddress,
  ]
  const legacyOracle = await artifacts.require('LegacyOracle').at(legacyOracleAddress)
  await makeTx(legacyOracle, 'initialize', legacyOracleArgs, { from: DEPLOYER })

  const zeroLastProcessingRefSlot = 0

  //
  // === AccountingOracle: initialize ===
  //
  //! NB: LegacyOracle must be initialized before
  const accountingOracle = await artifacts.require('AccountingOracle').at(accountingOracleAddress)
  const accountingOracleArgs = [
    accountingOracleAdmin,
    hashConsensusForAccountingAddress,
    accountingOracleParams.consensusVersion,
    zeroLastProcessingRefSlot,
  ]
  await makeTx(accountingOracle, 'initializeWithoutMigration', accountingOracleArgs, { from: DEPLOYER })

  //
  // === ValidatorsExitBusOracle: initialize ===
  //
  const validatorsExitBusOracle = await artifacts.require('ValidatorsExitBusOracle').at(ValidatorsExitBusOracleAddress)
  const validatorsExitBusOracleArgs = [
    exitBusOracleAdmin,  // admin
    hashConsensusForValidatorsExitBusOracleAddress,
    validatorsExitBusOracleParams.consensusVersion,
    zeroLastProcessingRefSlot,
  ]
  await makeTx(validatorsExitBusOracle, 'initialize', validatorsExitBusOracleArgs, { from: DEPLOYER })

  //
  // === WithdrawalQueue: initialize ===
  //
  const withdrawalQueue = await artifacts.require('WithdrawalQueueERC721').at(withdrawalQueueAddress)
  const withdrawalQueueArgs = [
    withdrawalQueueAdmin,  // _admin
  ]
  await makeTx(withdrawalQueue, 'initialize', withdrawalQueueArgs, { from: DEPLOYER })

  //
  // === WithdrawalQueue: setBaseURI ===
  //
  const withdrawalQueueBaseUri = state["withdrawalQueueERC721"].deployParameters.baseUri
  if (withdrawalQueueBaseUri !== null && withdrawalQueueBaseUri !== "") {
    const MANAGE_TOKEN_URI_ROLE = await withdrawalQueue.MANAGE_TOKEN_URI_ROLE()
    await makeTx(withdrawalQueue, 'grantRole', [MANAGE_TOKEN_URI_ROLE, DEPLOYER], { from: DEPLOYER })
    await makeTx(withdrawalQueue, 'setBaseURI', [withdrawalQueueBaseUri] , { from: DEPLOYER })
    console.log({ withdrawalQueueBaseUri })
    await makeTx(withdrawalQueue, 'renounceRole', [MANAGE_TOKEN_URI_ROLE, DEPLOYER], { from: DEPLOYER })
  }

  //
  // === StakingRouter: initialize ===
  //
  const withdrawalCredentials = `0x010000000000000000000000${withdrawalVaultAddress.slice(2)}`
  const stakingRouterArgs = [
    stakingRouterAdmin,  // _admin
    lidoAddress,  // _lido
    withdrawalCredentials,  // _withdrawalCredentials
  ]
  const stakingRouter = await artifacts.require('StakingRouter').at(stakingRouterAddress)
  await makeTx(stakingRouter, 'initialize', stakingRouterArgs, { from: DEPLOYER })
  logWideSplitter()

  //
  // === OracleDaemonConfig: set parameters ===
  //
  const oracleDaemonConfig = await artifacts.require('OracleDaemonConfig').at(oracleDaemonConfigAddress)
  const CONFIG_MANAGER_ROLE = await oracleDaemonConfig.CONFIG_MANAGER_ROLE()
  await makeTx(oracleDaemonConfig, 'grantRole', [CONFIG_MANAGER_ROLE, testnetAdmin], { from: testnetAdmin })
  for (const [key, value] of Object.entries(state.oracleDaemonConfig.deployParameters)) {
    await makeTx(oracleDaemonConfig, 'set', [key, hexPaddedToByte(value)], { from: DEPLOYER })
  }
  await makeTx(oracleDaemonConfig, 'renounceRole', [CONFIG_MANAGER_ROLE, testnetAdmin], { from: testnetAdmin })

  await TotalGasCounter.incrementTotalGasUsedInStateFile()
}

module.exports = runOrWrapScript(deployNewContracts, module)
