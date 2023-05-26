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
  "accountingOracle",
  "burner",
  "daoInitialSettings",
  "eip712StETH",
  "hashConsensusForAccounting",
  "hashConsensusForValidatorsExitBus",
  "lidoLocator",
  "stakingRouter",
  "validatorsExitBusOracle",
  "withdrawalQueueERC721",
  "withdrawalVault",
  "gateSealAddress",
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
  const gateSealAddress = state["gateSealAddress"]

  const validatorsExitBusOracleParams = state["validatorsExitBusOracle"].parameters
  const accountingOracleParams = state["accountingOracle"].parameters

  const burnerAddress = state["burner"].address
  const stakingRouterAddress = state["stakingRouter"].address
  const withdrawalQueueAddress = state["withdrawalQueueERC721"].address
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
  await stakingRouter.grantRole(await stakingRouter.STAKING_MODULE_PAUSE_ROLE(), depositSecurityModuleAddress, { from: stakingRouterAdmin })
  await stakingRouter.grantRole(await stakingRouter.REPORT_EXITED_VALIDATORS_ROLE(), accountingOracleAddress, { from: stakingRouterAdmin })
  await stakingRouter.grantRole(await stakingRouter.REPORT_REWARDS_MINTED_ROLE(), lidoAddress, { from: stakingRouterAdmin })
  logWideSplitter()

  //
  // === ValidatorsExitBusOracle
  //
  const validatorsExitBusOracle = await artifacts.require('ValidatorsExitBusOracle').at(validatorsExitBusOracleAddress)
  await validatorsExitBusOracle.grantRole(await validatorsExitBusOracle.PAUSE_ROLE(), gateSealAddress, { from: testnetAdmin })
  logWideSplitter()

  //
  // === WithdrawalQueue
  //
  const withdrawalQueue = await artifacts.require('WithdrawalQueueERC721').at(withdrawalQueueAddress)
  await withdrawalQueue.grantRole(await withdrawalQueue.PAUSE_ROLE(), gateSealAddress, { from: testnetAdmin })
  await withdrawalQueue.grantRole(await withdrawalQueue.FINALIZE_ROLE(), lidoAddress, { from: testnetAdmin })
  await withdrawalQueue.grantRole(await withdrawalQueue.ORACLE_ROLE(), accountingOracleAddress, { from: testnetAdmin })
  logWideSplitter()

  //
  // === Burner
  //
  const burner = await artifacts.require('Burner').at(burnerAddress)
  // NB: REQUEST_BURN_SHARES_ROLE is already granted to Lido in Burner constructor
  await burner.grantRole(await burner.REQUEST_BURN_SHARES_ROLE(), nodeOperatorsRegistryAddress, { from: testnetAdmin })

}

module.exports = runOrWrapScript(deployNewContracts, module)
