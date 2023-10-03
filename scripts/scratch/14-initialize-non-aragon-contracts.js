const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('../constants')


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
  "hashConsensusForAccounting",
  "validatorsExitBusOracle",
  "hashConsensusForValidatorsExitBus",
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
  const nodeOperatorsRegistryParams = state["nodeOperatorsRegistry"].parameters

  const validatorsExitBusOracleParams = state["validatorsExitBusOracle"].parameters
  const accountingOracleParams = state["accountingOracle"].parameters

  const stakingRouterAddress = state["stakingRouter"].address
  const withdrawalQueueAddress = state["withdrawalQueueERC721"].address
  const lidoLocatorAddress = state["lidoLocator"].address
  const accountingOracleAddress = state["accountingOracle"].address
  const hashConsensusForAccountingAddress = state["hashConsensusForAccounting"].address
  const ValidatorsExitBusOracleAddress = state["validatorsExitBusOracle"].address
  const hashConsensusForValidatorsExitBusOracleAddress = state["hashConsensusForValidatorsExitBus"].address
  const eip712StETHAddress = state["eip712StETH"].address
  const withdrawalVaultAddress = state["withdrawalVault"].proxy.address

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
  await log.makeTx(nodeOperatorsRegistry, 'initialize', nodeOperatorsRegistryArgs, { from: DEPLOYER })

  //
  // === Lido: initialize ===
  //
  const lidoInitArgs = [
    lidoLocatorAddress,
    eip712StETHAddress,
  ]
  const bootstrapInitBalance = 10 // wei
  const lido = await artifacts.require('Lido').at(lidoAddress)
  await log.makeTx(lido, 'initialize', lidoInitArgs, { value: bootstrapInitBalance, from: DEPLOYER })
  logWideSplitter()

  //
  // === LegacyOracle: initialize ===
  //
  const legacyOracleArgs = [
    lidoLocatorAddress,
    hashConsensusForAccountingAddress,
  ]
  const legacyOracle = await artifacts.require('LegacyOracle').at(legacyOracleAddress)
  await log.makeTx(legacyOracle, 'initialize', legacyOracleArgs, { from: DEPLOYER })

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
  await log.makeTx(accountingOracle, 'initializeWithoutMigration', accountingOracleArgs, { from: DEPLOYER })

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
  await log.makeTx(validatorsExitBusOracle, 'initialize', validatorsExitBusOracleArgs, { from: DEPLOYER })

  //
  // === WithdrawalQueue initialize ===
  //
  const withdrawalQueueArgs = [
    withdrawalQueueAdmin,  // _admin
  ]
  const withdrawalQueue = await artifacts.require('WithdrawalQueueERC721').at(withdrawalQueueAddress)
  await log.makeTx(withdrawalQueue, 'initialize', withdrawalQueueArgs, { from: DEPLOYER })

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
  await log.makeTx(stakingRouter, 'initialize', stakingRouterArgs, { from: DEPLOYER })
  logWideSplitter()

}

module.exports = runOrWrapScript(deployNewContracts, module)
