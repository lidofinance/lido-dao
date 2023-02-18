const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

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
  "legacyOracle",
  "hashConsensusForAccounting",
  "validatorsExitBusOracle",
  "hashConsensusForValidatorsExitBus",
  "withdrawalRequestNFT",
  "withdrawalVault",
]


async function deployNewContracts({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()
  logWideSplitter()
  log(`Network ID:`, yl(netId))

  let state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const agent = state["app:aragon-agent"].proxyAddress
  const lidoAddress = state["app:lido"].proxyAddress
  const legacyOracleAddress = state["app:oracle"].proxyAddress
  const nodeOperatorsRegistryAddress = state["app:node-operators-registry"].proxyAddress

  const validatorsExitBusOracleParams = state["validatorsExitBusOracle"].parameters
  const accountingOracleParams = state["accountingOracle"].parameters

  const stakingRouterAddress = state["stakingRouter"].address
  const withdrawalQueueAddress = state["withdrawalRequestNFT"].address
  const lidoLocatorAddress = state["lidoLocator"].address
  const accountingOracleAddress = state["accountingOracle"].address
  const hashConsensusForAccountingAddress = state["hashConsensusForAccounting"].address
  const validatorsExitBusOracleAddress = state["validatorsExitBusOracle"].address
  const hashConsensusForValidatorsExitBusOracleAddress = state["hashConsensusForValidatorsExitBus"].address
  const eip712StETHAddress = state["eip712StETH"].address
  const withdrawalVaultAddress = state["withdrawalVault"].address
  const depositSecurityModuleAddress = state.depositSecurityModule.address

  const testnetAdmin = DEPLOYER
  const accountingOracleAdmin = testnetAdmin
  const exitBusOracleAdmin = testnetAdmin
  const stakingRouterAdmin = testnetAdmin
  const withdrawalQueueAdmin = testnetAdmin
  // TODO
  // const votingAddress = state["app:aragon-voting"].proxyAddress
  const votingAddress = testnetAdmin

  //
  // === StakingRouter
  //
  const stakingRouter = await artifacts.require('StakingRouter').at(stakingRouterAddress)
  await stakingRouter.grantRole(await stakingRouter.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(), votingAddress, { from: stakingRouterAdmin })
  await stakingRouter.grantRole(await stakingRouter.STAKING_MODULE_PAUSE_ROLE(), depositSecurityModuleAddress, { from: stakingRouterAdmin })
  await stakingRouter.grantRole(await stakingRouter.STAKING_MODULE_RESUME_ROLE(), depositSecurityModuleAddress, { from: stakingRouterAdmin })
  await stakingRouter.grantRole(await stakingRouter.STAKING_MODULE_MANAGE_ROLE(), votingAddress, { from: stakingRouterAdmin })
  await stakingRouter.grantRole(await stakingRouter.REPORT_EXITED_VALIDATORS_ROLE(), accountingOracleAddress, { from: stakingRouterAdmin })
  await stakingRouter.grantRole(await stakingRouter.UNSAFE_SET_EXITED_VALIDATORS_ROLE(), votingAddress, { from: stakingRouterAdmin })
  await stakingRouter.grantRole(await stakingRouter.REPORT_REWARDS_MINTED_ROLE(), lidoAddress, { from: stakingRouterAdmin })
  logWideSplitter()

  //
  // === AccountingOracle
  //
  const accountingOracle = await artifacts.require('AccountingOracle').at(accountingOracleAddress)
  // TODO
  // await accountingOracle.grantRole(await accountingOracle.SUBMIT_DATA_ROLE(), undefined, { from: accountingOracleAdmin })
  await accountingOracle.grantRole(await accountingOracle.MANAGE_CONSENSUS_CONTRACT_ROLE(), votingAddress, { from: accountingOracleAdmin })
  await accountingOracle.grantRole(await accountingOracle.MANAGE_CONSENSUS_VERSION_ROLE(), votingAddress, { from: accountingOracleAdmin })
  logWideSplitter()

  //
  // === HashConsensus for AccountingOracle
  //
  /// NB: Skip because all roles are supposed to be set to the contract admin

  //
  // === ValidatorsExitBusOracle
  //
  const validatorsExitBusOracle = await artifacts.require('ValidatorsExitBusOracle').at(validatorsExitBusOracleAddress)
  // TODO
  // await validatorExitBusOracle.grantRole(await validatorExitBusOracle.SUBMIT_DATA_ROLE(), undefined, { from: exitBusOracleAdmin })
  await validatorsExitBusOracle.grantRole(await validatorsExitBusOracle.MANAGE_CONSENSUS_CONTRACT_ROLE(), votingAddress, { from: exitBusOracleAdmin })
  await validatorsExitBusOracle.grantRole(await validatorsExitBusOracle.MANAGE_CONSENSUS_VERSION_ROLE(), votingAddress, { from: exitBusOracleAdmin })
  logWideSplitter()

  //
  // === HashConsensus for ValidatorExitBusOracle
  //
  /// NB: Skip because all roles are supposed to be set to the contract admin

}

module.exports = runOrWrapScript(deployNewContracts, module)
