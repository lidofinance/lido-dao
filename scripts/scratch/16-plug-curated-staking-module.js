const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('../constants')


const REQUIRED_NET_STATE = [
  "stakingRouter",
  "app:node-operators-registry",
  "owner",

  "app:aragon-agent",
  `app:${APP_NAMES.LIDO}`,
  `app:${APP_NAMES.ORACLE}`,
  "app:aragon-voting",
  "accountingOracle",
  "burner",
  "daoInitialSettings",
  "eip712StETH",
  "hashConsensusForAccounting",
  "hashConsensusForValidatorsExitBus",
  "lidoLocator",
  "validatorsExitBusOracle",
  "withdrawalQueueERC721",
  "withdrawalVault",
  "gateSealAddress",
]

const NOR_STAKING_MODULE_TARGET_SHARE_BP = 10000  // 100%
const NOR_STAKING_MODULE_MODULE_FEE_BP = 500  // 5%
const NOR_STAKING_MODULE_TREASURY_FEE_BP = 500  // 5%
const STAKING_MODULE_MANAGE_ROLE = web3.utils.keccak256('STAKING_MODULE_MANAGE_ROLE')


async function deployNewContracts({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()
  logWideSplitter()
  log(`Network ID:`, yl(netId))

  let state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const owner = state.owner
  const stakingRouter = await artifacts.require('StakingRouter').at(state.stakingRouter.address)
  const nodeOperatorsRegistry = await artifacts.require('NodeOperatorsRegistry').at(state['app:node-operators-registry'].proxyAddress)

  await log.makeTx(stakingRouter, 'grantRole', [STAKING_MODULE_MANAGE_ROLE, owner], { from: owner })

  await log.makeTx(stakingRouter, 'addStakingModule', [
    state.nodeOperatorsRegistry.parameters.stakingModuleTypeId,
    nodeOperatorsRegistry.address,
    NOR_STAKING_MODULE_TARGET_SHARE_BP,
    NOR_STAKING_MODULE_MODULE_FEE_BP,
    NOR_STAKING_MODULE_TREASURY_FEE_BP,
  ], { from: owner })
  await log.makeTx(stakingRouter, 'renounceRole', [STAKING_MODULE_MANAGE_ROLE, owner], { from: owner })
}

module.exports = runOrWrapScript(deployNewContracts, module)
