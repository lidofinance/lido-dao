const { newDao, newApp } = require('../../0.4.24/helpers/dao')

const Lido = artifacts.require('LidoMock.sol')
const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')
const OracleMock = artifacts.require('OracleMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')

module.exports = {
  deployDaoAndPool
}

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

  // Initialize the node operators registry and the pool
  await nodeOperatorRegistry.initialize(pool.address)

  const [
    POOL_PAUSE_ROLE,
    POOL_MANAGE_FEE,
    POOL_MANAGE_WITHDRAWAL_KEY,
    POOL_BURN_ROLE,
    NODE_OPERATOR_REGISTRY_MANAGE_SIGNING_KEYS,
    NODE_OPERATOR_REGISTRY_ADD_NODE_OPERATOR_ROLE,
    NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_ACTIVE_ROLE,
    NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_NAME_ROLE,
    NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_ADDRESS_ROLE,
    NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_LIMIT_ROLE,
    NODE_OPERATOR_REGISTRY_REPORT_STOPPED_VALIDATORS_ROLE
  ] = await Promise.all([
    pool.PAUSE_ROLE(),
    pool.MANAGE_FEE(),
    pool.MANAGE_WITHDRAWAL_KEY(),
    pool.BURN_ROLE(),
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
    acl.createPermission(voting, pool.address, POOL_MANAGE_FEE, appManager, { from: appManager }),
    acl.createPermission(voting, pool.address, POOL_MANAGE_WITHDRAWAL_KEY, appManager, { from: appManager }),
    acl.createPermission(voting, pool.address, POOL_BURN_ROLE, appManager, { from: appManager }),
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
    insuranceAddr
  }
}
