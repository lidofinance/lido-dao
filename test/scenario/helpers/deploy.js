const { newDao, newApp } = require('../../0.4.24/helpers/dao')

const StETH = artifacts.require('StETH.sol')
const DePool = artifacts.require('TestDePool.sol')
const StakingProvidersRegistry = artifacts.require('StakingProvidersRegistry')

const OracleMock = artifacts.require('OracleMock.sol')
const ValidatorRegistrationMock = artifacts.require('ValidatorRegistrationMock.sol')

module.exports = {
  deployDaoAndPool
}

async function deployDaoAndPool(appManager, voting, depositIterationLimit = 10) {
  // Deploy the DAO, oracle and validator registration mocks, and base contracts for
  // StETH (the token), DePool (the pool) and StakingProvidersRegistry (the SP registry)

  const [{ dao, acl }, oracleMock, validatorRegistrationMock, stEthBase, poolBase, spRegistryBase] = await Promise.all([
    newDao(appManager),
    OracleMock.new(),
    ValidatorRegistrationMock.new(),
    StETH.new(),
    DePool.new(),
    StakingProvidersRegistry.new()
  ])

  // Instantiate proxies for the pool, the token, and the SP registry, using
  // the base contracts as their logic implementation

  const [tokenProxyAddress, poolProxyAddress, spRegistryProxyAddress] = await Promise.all([
    newApp(dao, 'steth', stEthBase.address, appManager),
    newApp(dao, 'depool', poolBase.address, appManager),
    newApp(dao, 'staking-providers-registry', spRegistryBase.address, appManager)
  ])

  const [token, pool, spRegistry] = await Promise.all([
    StETH.at(tokenProxyAddress),
    DePool.at(poolProxyAddress),
    StakingProvidersRegistry.at(spRegistryProxyAddress)
  ])

  // Initialize the token, the SP registry and the pool

  await token.initialize(pool.address)
  await spRegistry.initialize()

  const [
    POOL_PAUSE_ROLE,
    POOL_MANAGE_FEE,
    POOL_MANAGE_WITHDRAWAL_KEY,
    POOL_SET_DEPOSIT_ITERATION_LIMIT,
    SP_REGISTRY_SET_POOL,
    SP_REGISTRY_MANAGE_SIGNING_KEYS,
    SP_REGISTRY_ADD_STAKING_PROVIDER_ROLE,
    SP_REGISTRY_SET_STAKING_PROVIDER_ACTIVE_ROLE,
    SP_REGISTRY_SET_STAKING_PROVIDER_NAME_ROLE,
    SP_REGISTRY_SET_STAKING_PROVIDER_ADDRESS_ROLE,
    SP_REGISTRY_SET_STAKING_PROVIDER_LIMIT_ROLE,
    SP_REGISTRY_REPORT_STOPPED_VALIDATORS_ROLE,
    TOKEN_MINT_ROLE,
    TOKEN_BURN_ROLE
  ] = await Promise.all([
    pool.PAUSE_ROLE(),
    pool.MANAGE_FEE(),
    pool.MANAGE_WITHDRAWAL_KEY(),
    pool.SET_DEPOSIT_ITERATION_LIMIT(),
    spRegistry.SET_POOL(),
    spRegistry.MANAGE_SIGNING_KEYS(),
    spRegistry.ADD_STAKING_PROVIDER_ROLE(),
    spRegistry.SET_STAKING_PROVIDER_ACTIVE_ROLE(),
    spRegistry.SET_STAKING_PROVIDER_NAME_ROLE(),
    spRegistry.SET_STAKING_PROVIDER_ADDRESS_ROLE(),
    spRegistry.SET_STAKING_PROVIDER_LIMIT_ROLE(),
    spRegistry.REPORT_STOPPED_VALIDATORS_ROLE(),
    token.MINT_ROLE(),
    token.BURN_ROLE()
  ])

  await Promise.all([
    // Allow voting to manage the pool
    acl.createPermission(voting, pool.address, POOL_PAUSE_ROLE, appManager, { from: appManager }),
    acl.createPermission(voting, pool.address, POOL_MANAGE_FEE, appManager, { from: appManager }),
    acl.createPermission(voting, pool.address, POOL_MANAGE_WITHDRAWAL_KEY, appManager, { from: appManager }),
    acl.createPermission(voting, pool.address, POOL_SET_DEPOSIT_ITERATION_LIMIT, appManager, { from: appManager }),
    // Allow voting to manage staking providers registry
    acl.createPermission(voting, spRegistry.address, SP_REGISTRY_SET_POOL, appManager, { from: appManager }),
    acl.createPermission(voting, spRegistry.address, SP_REGISTRY_MANAGE_SIGNING_KEYS, appManager, { from: appManager }),
    acl.createPermission(voting, spRegistry.address, SP_REGISTRY_ADD_STAKING_PROVIDER_ROLE, appManager, { from: appManager }),
    acl.createPermission(voting, spRegistry.address, SP_REGISTRY_SET_STAKING_PROVIDER_ACTIVE_ROLE, appManager, { from: appManager }),
    acl.createPermission(voting, spRegistry.address, SP_REGISTRY_SET_STAKING_PROVIDER_NAME_ROLE, appManager, { from: appManager }),
    acl.createPermission(voting, spRegistry.address, SP_REGISTRY_SET_STAKING_PROVIDER_ADDRESS_ROLE, appManager, { from: appManager }),
    acl.createPermission(voting, spRegistry.address, SP_REGISTRY_SET_STAKING_PROVIDER_LIMIT_ROLE, appManager, { from: appManager }),
    acl.createPermission(voting, spRegistry.address, SP_REGISTRY_REPORT_STOPPED_VALIDATORS_ROLE, appManager, { from: appManager }),
    // Allow the pool to mint and burn tokens
    acl.createPermission(pool.address, token.address, TOKEN_MINT_ROLE, appManager, { from: appManager }),
    acl.createPermission(pool.address, token.address, TOKEN_BURN_ROLE, appManager, { from: appManager })
  ])

  await pool.initialize(token.address, validatorRegistrationMock.address, oracleMock.address, spRegistry.address, depositIterationLimit)

  await oracleMock.setPool(pool.address)
  await spRegistry.setPool(pool.address, { from: voting })
  await validatorRegistrationMock.reset()

  const [treasuryAddr, insuranceAddr] = await Promise.all([pool.getTreasury(), pool.getInsuranceFund()])

  return {
    dao,
    acl,
    oracleMock,
    validatorRegistrationMock,
    token,
    pool,
    spRegistry,
    treasuryAddr,
    insuranceAddr
  }
}
