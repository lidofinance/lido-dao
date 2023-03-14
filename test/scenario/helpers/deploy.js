const { artifacts, web3 } = require('hardhat')
const withdrawals = require('../../helpers/withdrawals')

const { newDao, newApp } = require('../../0.4.24/helpers/dao')

const Lido = artifacts.require('LidoMock.sol')
const WstETH = artifacts.require('WstETH.sol')
const LidoELRewardsVault = artifacts.require('LidoExecutionLayerRewardsVault.sol')
const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')
const OracleMock = artifacts.require('AccountingOracleMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')
const DepositSecurityModule = artifacts.require('DepositSecurityModule.sol')
const StakingRouter = artifacts.require('StakingRouterMock.sol')
const EIP712StETH = artifacts.require('EIP712StETH')

const MAX_DEPOSITS_PER_BLOCK = 100
const MIN_DEPOSIT_BLOCK_DISTANCE = 20
const PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS = 10
const GUARDIAN1 = '0x5Fc0E75BF6502009943590492B02A1d08EAc9C43'
const GUARDIAN2 = '0x8516Cbb5ABe73D775bfc0d21Af226e229F7181A3'
const GUARDIAN3 = '0xdaEAd0E0194abd565d28c1013399801d79627c14'
const GUARDIAN_PRIVATE_KEYS = {
  [GUARDIAN1]: '0x3578665169e03e05a26bd5c565ffd12c81a1e0df7d0679f8aee4153110a83c8c',
  [GUARDIAN2]: '0x88868f0fb667cfe50261bb385be8987e0ce62faee934af33c3026cf65f25f09e',
  [GUARDIAN3]: '0x75e6f508b637327debc90962cd38943ddb9cfc1fc4a8572fc5e3d0984e1261de',
}
const DEPOSIT_ROOT = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'

const SLOTS_PER_EPOCH = 32
const SECONDS_PER_SLOT = 12
const GENESIS_TIME = 1606824000
const EPOCHS_PER_FRAME = 225

const SLOTS_PER_FRAME = EPOCHS_PER_FRAME * SLOTS_PER_EPOCH
const SECONDS_PER_FRAME = SLOTS_PER_FRAME * SECONDS_PER_SLOT

async function deployDaoAndPool(appManager, voting) {
  // Deploy the DAO, oracle and deposit contract mocks, and base contracts for
  // Lido (the pool) and NodeOperatorsRegistry (the Node Operators registry)

  const treasury = web3.eth.accounts.create()

  const [{ dao, acl }, depositContractMock, poolBase] = await Promise.all([
    newDao(appManager),
    DepositContractMock.new(),
    Lido.new(),
  ])

  const stakingRouter = await StakingRouter.new(depositContractMock.address)

  // Instantiate proxies for the pool and the token using
  // the base contracts as their logic implementation

  const poolProxyAddress = await newApp(dao, 'lido', poolBase.address, appManager)

  const [token, pool] = await Promise.all([Lido.at(poolProxyAddress), Lido.at(poolProxyAddress)])

  const oracleMock = await OracleMock.new(pool.address, SECONDS_PER_SLOT)

  const depositSecurityModule = await DepositSecurityModule.new(
    pool.address,
    depositContractMock.address,
    stakingRouter.address,
    MAX_DEPOSITS_PER_BLOCK,
    MIN_DEPOSIT_BLOCK_DISTANCE,
    PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS,
    { from: appManager }
  )
  await depositSecurityModule.addGuardians([GUARDIAN3, GUARDIAN1, GUARDIAN2], 2, { from: appManager })

  const [POOL_PAUSE_ROLE, POOL_RESUME_ROLE, STAKING_PAUSE_ROLE, STAKING_CONTROL_ROLE, MANAGE_PROTOCOL_CONTRACTS_ROLE] =
    await Promise.all([
      pool.PAUSE_ROLE(),
      pool.RESUME_ROLE(),
      pool.STAKING_PAUSE_ROLE(),
      pool.STAKING_CONTROL_ROLE(),
      pool.MANAGE_PROTOCOL_CONTRACTS_ROLE(),
    ])

  await Promise.all([
    // Allow voting to manage the pool
    acl.createPermission(voting, pool.address, POOL_PAUSE_ROLE, appManager, { from: appManager }),
    acl.createPermission(voting, pool.address, POOL_RESUME_ROLE, appManager, { from: appManager }),
    acl.createPermission(voting, pool.address, STAKING_PAUSE_ROLE, appManager, { from: appManager }),
    acl.createPermission(voting, pool.address, STAKING_CONTROL_ROLE, appManager, { from: appManager }),
    acl.createPermission(voting, pool.address, MANAGE_PROTOCOL_CONTRACTS_ROLE, appManager, { from: appManager }),
  ])

  const elRewardsVault = await LidoELRewardsVault.new(pool.address, treasury.address)
  const nodeOperatorsRegistry = await setupNodeOperatorsRegistry(
    dao,
    acl,
    voting,
    token,
    appManager,
    stakingRouter.address
  )

  const wc = '0x'.padEnd(66, '1234')
  await stakingRouter.initialize(appManager, pool.address, wc, { from: appManager })

  // Set up the staking router permissions.
  const [
    MANAGE_WITHDRAWAL_CREDENTIALS_ROLE,
    STAKING_MODULE_PAUSE_ROLE,
    STAKING_MODULE_MANAGE_ROLE,
    REPORT_REWARDS_MINTED_ROLE,
  ] = await Promise.all([
    stakingRouter.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(),
    stakingRouter.STAKING_MODULE_PAUSE_ROLE(),
    stakingRouter.STAKING_MODULE_MANAGE_ROLE(),
    stakingRouter.REPORT_REWARDS_MINTED_ROLE(),
  ])
  await stakingRouter.grantRole(REPORT_REWARDS_MINTED_ROLE, pool.address, { from: appManager })

  await stakingRouter.grantRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, voting, { from: appManager })
  await stakingRouter.grantRole(STAKING_MODULE_PAUSE_ROLE, voting, { from: appManager })
  await stakingRouter.grantRole(STAKING_MODULE_MANAGE_ROLE, voting, { from: appManager })

  await stakingRouter.grantRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, appManager, { from: appManager })
  await stakingRouter.grantRole(STAKING_MODULE_PAUSE_ROLE, appManager, { from: appManager })
  await stakingRouter.grantRole(STAKING_MODULE_MANAGE_ROLE, appManager, { from: appManager })

  await stakingRouter.addStakingModule(
    'Curated',
    nodeOperatorsRegistry.address,
    10_000, // 100 % _targetShare
    500, // 5 % _moduleFee
    500, // 5 % _treasuryFee
    { from: voting }
  )

  const eip712StETH = await EIP712StETH.new({ from: appManager })

  const wsteth = await WstETH.new(pool.address)
  const withdrawalQueue = (await withdrawals.deploy(appManager, wsteth.address)).queue

  await pool.initialize(
    oracleMock.address,
    treasury.address,
    stakingRouter.address,
    depositSecurityModule.address,
    elRewardsVault.address,
    withdrawalQueue.address,
    eip712StETH.address
  )

  await depositContractMock.reset()
  await depositContractMock.set_deposit_root(DEPOSIT_ROOT)

  const treasuryAddr = await pool.getTreasury()
  return {
    dao,
    acl,
    oracleMock,
    depositContractMock,
    token,
    pool,
    nodeOperatorsRegistry,
    treasuryAddr,
    elRewardsVault,
    depositSecurityModule,
    guardians: {
      privateKeys: GUARDIAN_PRIVATE_KEYS,
      addresses: [GUARDIAN1, GUARDIAN2, GUARDIAN3],
    },
    stakingRouter,
  }
}

async function setupNodeOperatorsRegistry(dao, acl, voting, token, appManager, stakingRouterAddress) {
  const nodeOperatorsRegistryBase = await NodeOperatorsRegistry.new()
  const name = 'node-operators-registry-' + Math.random().toString(36).slice(2, 6)
  const nodeOperatorsRegistryProxyAddress = await newApp(dao, name, nodeOperatorsRegistryBase.address, appManager)
  const nodeOperatorsRegistry = await NodeOperatorsRegistry.at(nodeOperatorsRegistryProxyAddress)

  // Initialize the node operators registry and the pool
  await nodeOperatorsRegistry.initialize(token.address, '0x01')

  const [
    NODE_OPERATOR_REGISTRY_MANAGE_SIGNING_KEYS,
    NODE_OPERATOR_REGISTRY_MANAGE_NODE_OPERATOR_ROLE,
    NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_LIMIT_ROLE,
    NODE_OPERATOR_REGISTRY_STAKING_ROUTER_ROLE,
  ] = await Promise.all([
    nodeOperatorsRegistry.MANAGE_SIGNING_KEYS(),
    nodeOperatorsRegistry.MANAGE_NODE_OPERATOR_ROLE(),
    nodeOperatorsRegistry.SET_NODE_OPERATOR_LIMIT_ROLE(),
    nodeOperatorsRegistry.STAKING_ROUTER_ROLE(),
  ])
  await Promise.all([
    // Allow voting to manage node operators registry
    acl.createPermission(
      voting,
      nodeOperatorsRegistry.address,
      NODE_OPERATOR_REGISTRY_MANAGE_SIGNING_KEYS,
      appManager,
      {
        from: appManager,
      }
    ),
    acl.createPermission(
      voting,
      nodeOperatorsRegistry.address,
      NODE_OPERATOR_REGISTRY_MANAGE_NODE_OPERATOR_ROLE,
      appManager,
      {
        from: appManager,
      }
    ),
    acl.createPermission(
      voting,
      nodeOperatorsRegistry.address,
      NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_LIMIT_ROLE,
      appManager,
      {
        from: appManager,
      }
    ),
    acl.createPermission(
      voting,
      nodeOperatorsRegistry.address,
      NODE_OPERATOR_REGISTRY_STAKING_ROUTER_ROLE,
      appManager,
      { from: appManager }
    ),
  ])

  await acl.grantPermission(
    stakingRouterAddress,
    nodeOperatorsRegistry.address,
    NODE_OPERATOR_REGISTRY_STAKING_ROUTER_ROLE,
    { from: appManager }
  )

  return nodeOperatorsRegistry
}

module.exports = {
  deployDaoAndPool,
  setupNodeOperatorsRegistry,
  SLOTS_PER_EPOCH,
  SECONDS_PER_SLOT,
  GENESIS_TIME,
  EPOCHS_PER_FRAME,
  SLOTS_PER_FRAME,
  SECONDS_PER_FRAME,
}
