const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('../constants')
const { makeTx, TotalGasCounter } = require('../helpers/deploy')


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
  "hashConsensusForAccountingOracle",
  "hashConsensusForValidatorsExitBusOracle",
  "lidoLocator",
  "stakingRouter",
  "validatorsExitBusOracle",
  "withdrawalQueueERC721",
  "withdrawalVault",
  "gateSeal",
]


async function deployNewContracts({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()
  logWideSplitter()
  log(`Network ID:`, yl(netId))

  let state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const lidoAddress = state["app:lido"].proxy.address
  const nodeOperatorsRegistryAddress = state["app:node-operators-registry"].proxy.address
  const gateSealAddress = state.gateSeal.address

  const burnerAddress = state["burner"].address
  const stakingRouterAddress = state["stakingRouter"].proxy.address
  const withdrawalQueueAddress = state["withdrawalQueueERC721"].proxy.address
  const accountingOracleAddress = state["accountingOracle"].proxy.address
  const validatorsExitBusOracleAddress = state["validatorsExitBusOracle"].proxy.address
  const depositSecurityModuleAddress = state.depositSecurityModule.address

  const deployer = state.deployer

  //
  // === StakingRouter
  //
  const stakingRouter = await artifacts.require('StakingRouter').at(stakingRouterAddress)
  await makeTx(stakingRouter, 'grantRole', [await stakingRouter.STAKING_MODULE_PAUSE_ROLE(), depositSecurityModuleAddress], { from: deployer })
  await makeTx(stakingRouter, 'grantRole', [await stakingRouter.STAKING_MODULE_RESUME_ROLE(), depositSecurityModuleAddress], { from: deployer })
  await makeTx(stakingRouter, 'grantRole', [await stakingRouter.REPORT_EXITED_VALIDATORS_ROLE(), accountingOracleAddress], { from: deployer })
  await makeTx(stakingRouter, 'grantRole', [await stakingRouter.REPORT_REWARDS_MINTED_ROLE(), lidoAddress], { from: deployer })
  logWideSplitter()

  //
  // === ValidatorsExitBusOracle
  //
  const validatorsExitBusOracle = await artifacts.require('ValidatorsExitBusOracle').at(validatorsExitBusOracleAddress)
  await makeTx(validatorsExitBusOracle, 'grantRole', [await validatorsExitBusOracle.PAUSE_ROLE(), gateSealAddress], { from: deployer })
  logWideSplitter()

  //
  // === WithdrawalQueue
  //
  const withdrawalQueue = await artifacts.require('WithdrawalQueueERC721').at(withdrawalQueueAddress)
  await makeTx(withdrawalQueue, 'grantRole', [await withdrawalQueue.PAUSE_ROLE(), gateSealAddress], { from: deployer })
  await makeTx(withdrawalQueue, 'grantRole', [await withdrawalQueue.FINALIZE_ROLE(), lidoAddress], { from: deployer })
  await makeTx(withdrawalQueue, 'grantRole', [await withdrawalQueue.ORACLE_ROLE(), accountingOracleAddress], { from: deployer })
  logWideSplitter()

  //
  // === Burner
  //
  const burner = await artifacts.require('Burner').at(burnerAddress)
  // NB: REQUEST_BURN_SHARES_ROLE is already granted to Lido in Burner constructor
  await makeTx(burner, 'grantRole', [await burner.REQUEST_BURN_SHARES_ROLE(), nodeOperatorsRegistryAddress], { from: deployer })

  await TotalGasCounter.incrementTotalGasUsedInStateFile()
}

module.exports = runOrWrapScript(deployNewContracts, module)
