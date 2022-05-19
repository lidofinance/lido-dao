const { newDao, newApp } = require('../../0.4.24/helpers/dao')

const Lido = artifacts.require('LidoMock.sol')
const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')
const OracleMock = artifacts.require('OracleMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')
const DepositSecurityModule = artifacts.require('DepositSecurityModule.sol')

module.exports = {
  deployDaoAndPool
}

const NETWORK_ID = 1000
const MAX_DEPOSITS_PER_BLOCK = 100
const MIN_DEPOSIT_BLOCK_DISTANCE = 20
const PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS = 10
const GUARDIAN1 = '0x5Fc0E75BF6502009943590492B02A1d08EAc9C43'
const GUARDIAN2 = '0x8516Cbb5ABe73D775bfc0d21Af226e229F7181A3'
const GUARDIAN3 = '0xdaEAd0E0194abd565d28c1013399801d79627c14'
const GUARDIAN_PRIVATE_KEYS = {
  [GUARDIAN1]: '0x3578665169e03e05a26bd5c565ffd12c81a1e0df7d0679f8aee4153110a83c8c',
  [GUARDIAN2]: '0x88868f0fb667cfe50261bb385be8987e0ce62faee934af33c3026cf65f25f09e',
  [GUARDIAN3]: '0x75e6f508b637327debc90962cd38943ddb9cfc1fc4a8572fc5e3d0984e1261de'
}
const DEPOSIT_ROOT = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'

async function deployDaoAndPool(appManager, voting) {
  // Deploy the DAO, oracle and deposit contract mocks, and base contracts for
  // Lido (the pool) and NodeOperatorsRegistry (the Node Operators registry)

  const [{ dao, acl }, oracleMock, depositContractMock, poolBase, nodeOperatorRegistryBase] = await Promise.all([
    newDao(appManager),
    OracleMock.new(),
    DepositContractMock.new(),
    Lido.new(),
    NodeOperatorsRegistry.new()
  ])

  // Instantiate proxies for the pool, the token, and the node operators registry, using
  // the base contracts as their logic implementation

  const [poolProxyAddress, nodeOperatorRegistryProxyAddress] = await Promise.all([
    newApp(dao, 'lido', poolBase.address, appManager),
    newApp(dao, 'node-operators-registry', nodeOperatorRegistryBase.address, appManager)
  ])

  const [token, pool, nodeOperatorRegistry] = await Promise.all([
    Lido.at(poolProxyAddress),
    Lido.at(poolProxyAddress),
    NodeOperatorsRegistry.at(nodeOperatorRegistryProxyAddress)
  ])

  const depositSecurityModule = await DepositSecurityModule.new(
    pool.address,
    depositContractMock.address,
    nodeOperatorRegistry.address,
    NETWORK_ID,
    MAX_DEPOSITS_PER_BLOCK,
    MIN_DEPOSIT_BLOCK_DISTANCE,
    PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS,
    { from: appManager }
  )
  await depositSecurityModule.addGuardians([GUARDIAN3, GUARDIAN1, GUARDIAN2], 2, { from: appManager })

  // Initialize the node operators registry and the pool
  await nodeOperatorRegistry.initialize(pool.address)

  const [
    POOL_PAUSE_ROLE,
    POOL_RESUME_ROLE,
    POOL_MANAGE_FEE,
    POOL_MANAGE_WITHDRAWAL_KEY,
    POOL_BURN_ROLE,
    DEPOSIT_ROLE,
    STAKING_PAUSE_ROLE,
    STAKING_CONTROL_ROLE,
    SET_EL_REWARDS_VAULT_ROLE,
    SET_EL_REWARDS_WITHDRAWAL_LIMIT_ROLE,
    NODE_OPERATOR_REGISTRY_MANAGE_SIGNING_KEYS,
    NODE_OPERATOR_REGISTRY_ADD_NODE_OPERATOR_ROLE,
    NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_ACTIVE_ROLE,
    NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_NAME_ROLE,
    NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_ADDRESS_ROLE,
    NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_LIMIT_ROLE,
    NODE_OPERATOR_REGISTRY_REPORT_STOPPED_VALIDATORS_ROLE
  ] = await Promise.all([
    pool.PAUSE_ROLE(),
    pool.RESUME_ROLE(),
    pool.MANAGE_FEE(),
    pool.MANAGE_WITHDRAWAL_KEY(),
    pool.BURN_ROLE(),
    pool.DEPOSIT_ROLE(),
    pool.STAKING_PAUSE_ROLE(),
    pool.STAKING_CONTROL_ROLE(),
    pool.SET_EL_REWARDS_VAULT_ROLE(),
    pool.SET_EL_REWARDS_WITHDRAWAL_LIMIT_ROLE(),
    nodeOperatorRegistry.MANAGE_SIGNING_KEYS(),
    nodeOperatorRegistry.ADD_NODE_OPERATOR_ROLE(),
    nodeOperatorRegistry.SET_NODE_OPERATOR_ACTIVE_ROLE(),
    nodeOperatorRegistry.SET_NODE_OPERATOR_NAME_ROLE(),
    nodeOperatorRegistry.SET_NODE_OPERATOR_ADDRESS_ROLE(),
    nodeOperatorRegistry.SET_NODE_OPERATOR_LIMIT_ROLE(),
    nodeOperatorRegistry.REPORT_STOPPED_VALIDATORS_ROLE()
  ])

  await Promise.all([
    // Allow voting to manage the pool
    acl.createPermission(voting, pool.address, POOL_PAUSE_ROLE, appManager, { from: appManager }),
    acl.createPermission(voting, pool.address, POOL_RESUME_ROLE, appManager, { from: appManager }),
    acl.createPermission(voting, pool.address, POOL_MANAGE_FEE, appManager, { from: appManager }),
    acl.createPermission(voting, pool.address, POOL_MANAGE_WITHDRAWAL_KEY, appManager, { from: appManager }),
    acl.createPermission(voting, pool.address, POOL_BURN_ROLE, appManager, { from: appManager }),
    acl.createPermission(voting, pool.address, STAKING_PAUSE_ROLE, appManager, { from: appManager }),
    acl.createPermission(voting, pool.address, STAKING_CONTROL_ROLE, appManager, { from: appManager }),
    acl.createPermission(voting, pool.address, SET_EL_REWARDS_VAULT_ROLE, appManager, { from: appManager }),
    acl.createPermission(voting, pool.address, SET_EL_REWARDS_WITHDRAWAL_LIMIT_ROLE, appManager, { from: appManager }),

    // Allow depositor to deposit buffered ether
    acl.createPermission(depositSecurityModule.address, pool.address, DEPOSIT_ROLE, appManager, { from: appManager }),

    // Allow voting to manage node operators registry
    acl.createPermission(voting, nodeOperatorRegistry.address, NODE_OPERATOR_REGISTRY_MANAGE_SIGNING_KEYS, appManager, {
      from: appManager
    }),
    acl.createPermission(voting, nodeOperatorRegistry.address, NODE_OPERATOR_REGISTRY_ADD_NODE_OPERATOR_ROLE, appManager, {
      from: appManager
    }),
    acl.createPermission(voting, nodeOperatorRegistry.address, NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_ACTIVE_ROLE, appManager, {
      from: appManager
    }),
    acl.createPermission(voting, nodeOperatorRegistry.address, NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_NAME_ROLE, appManager, {
      from: appManager
    }),
    acl.createPermission(voting, nodeOperatorRegistry.address, NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_ADDRESS_ROLE, appManager, {
      from: appManager
    }),
    acl.createPermission(voting, nodeOperatorRegistry.address, NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_LIMIT_ROLE, appManager, {
      from: appManager
    }),
    acl.createPermission(voting, nodeOperatorRegistry.address, NODE_OPERATOR_REGISTRY_REPORT_STOPPED_VALIDATORS_ROLE, appManager, {
      from: appManager
    })
  ])

  await pool.initialize(depositContractMock.address, oracleMock.address, nodeOperatorRegistry.address)

  await oracleMock.setPool(pool.address)
  await depositContractMock.reset()
  await depositContractMock.set_deposit_root(DEPOSIT_ROOT)

  const [treasuryAddr, insuranceAddr] = await Promise.all([pool.getTreasury(), pool.getInsuranceFund()])

  return {
    dao,
    acl,
    oracleMock,
    depositContractMock,
    token,
    pool,
    nodeOperatorRegistry,
    treasuryAddr,
    insuranceAddr,
    depositSecurityModule,
    guardians: {
      privateKeys: GUARDIAN_PRIVATE_KEYS,
      addresses: [GUARDIAN1, GUARDIAN2, GUARDIAN3]
    }
  }
}
