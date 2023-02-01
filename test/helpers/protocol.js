const { ethers } = require('hardhat')

const { newDao } = require('./dao')

const factories = require('./factories')


const DEPOSIT_ROOT = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'
const DEAFAULT_FACTORIES = {
  appManagerFactory: factories.appManagerFactory,
  treasuryFactory: factories.treasuryFactory,
  votingFactory: factories.votingEOAFactory,
  lidoFactory: factories.lidoMockFactory,
  wstethFactory: factories.wstethFactory,
  oracleFactory: factories.oracleMockFactory,
  depositContractFactory: factories.depositContractFactory,
  stakingRouterFactory: factories.stakingRouterFactory,
  depositSecurityModuleFactory: factories.depositSecurityModuleFactory,
  elRewardsVaultFactory: factories.elRewardsVaultFactory,
  withdrawalQueueFactory: factories.withdrawalQueueFactory,
  withdrawalVaultFactory: factories.withdrawalVaultFactory,
  eip712StETHFactory: factories.eip712StETHFactory,
  withdrawalCredentialsFactory: factories.withdrawalCredentialsFactory,
  stakingModulesFactory: factories.stakingModulesFactory,
  guardiansFactory: factories.guardiansFactory
}

const getFactory = (config, factoryName) => {
  return config[factoryName] ? config[factoryName] : DEAFAULT_FACTORIES[factoryName]
}

async function deployProtocol(config = {}) {
  const protocol = {}

  protocol.signers = await ethers.getSigners()
  protocol.appManager = await getFactory(config, 'appManagerFactory')(protocol)
  protocol.treasury = await getFactory(config, 'treasuryFactory')(protocol)
  protocol.voting = await getFactory(config, 'votingFactory')(protocol)

  protocol.guardians = await getFactory(config, 'guardiansFactory')(protocol)

  const { dao, acl } = await newDao(protocol.appManager.address)
  protocol.dao = dao
  protocol.acl = acl

  protocol.pool = await getFactory(config, 'lidoFactory')(protocol)
  protocol.token = protocol.pool

  await grantLidoRoles(protocol)
  protocol.wsteth = await getFactory(config, 'wstethFactory')(protocol)
  protocol.oracle = await getFactory(config, 'oracleFactory')(protocol)

  protocol.depositContract = await getFactory(config, 'depositContractFactory')(protocol)

  protocol.withdrawalCredentials = await getFactory(config, 'withdrawalCredentialsFactory')(protocol)
  protocol.stakingRouter = await getFactory(config, 'stakingRouterFactory')(protocol)
  await grantStakingRouterRoles(protocol)
  const stakingModulesFactory = getFactory(config, 'stakingModulesFactory')
  protocol.stakingModules = await addStakingModules(stakingModulesFactory, protocol)

  protocol.depositSecurityModule = await getFactory(config, 'depositSecurityModuleFactory')(protocol)
  protocol.elRewardsVault = await getFactory(config, 'elRewardsVaultFactory')(protocol)
  protocol.withdrawalQueue = await getFactory(config, 'withdrawalQueueFactory')(protocol)
  protocol.withdrawalVault = await getFactory(config, 'withdrawalVaultFactory')(protocol)
  protocol.eip712StETH = await getFactory(config, 'eip712StETHFactory')(protocol)

  await protocol.pool.initialize(
    protocol.oracle.address,
    protocol.treasury.address,
    protocol.stakingRouter.address,
    protocol.depositSecurityModule.address,
    protocol.elRewardsVault.address,
    protocol.withdrawalVault.address,
    protocol.withdrawalQueue.address,
    protocol.eip712StETH.address
  )

  await protocol.oracle.setPool(protocol.pool.address)
  await protocol.depositContract.reset()
  await protocol.depositContract.set_deposit_root(DEPOSIT_ROOT)

  return protocol
}

async function addStakingModules(stakingModulesFactory, protocol) {
  const stakingModules = await stakingModulesFactory(protocol)

  for (const stakingModule of stakingModules) {
    await protocol.stakingRouter.addStakingModule(
      stakingModule.name,
      stakingModule.module.address,
      stakingModule.targetShares,
      stakingModule.moduleFee,
      stakingModule.treasuryFee,
      { from: protocol.voting.address }
    )
  }

  return stakingModules.map(({ module }) => module)
}

async function grantStakingRouterRoles({ stakingRouter, pool, voting, appManager }) {
  const [
    MANAGE_WITHDRAWAL_CREDENTIALS_ROLE,
    STAKING_MODULE_PAUSE_ROLE,
    STAKING_MODULE_MANAGE_ROLE,
    REPORT_REWARDS_MINTED_ROLE
  ] = await Promise.all([
    stakingRouter.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(),
    stakingRouter.STAKING_MODULE_PAUSE_ROLE(),
    stakingRouter.STAKING_MODULE_MANAGE_ROLE(),
    stakingRouter.REPORT_REWARDS_MINTED_ROLE()
  ])
  await stakingRouter.grantRole(REPORT_REWARDS_MINTED_ROLE, pool.address, { from: appManager.address })

  await stakingRouter.grantRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, voting.address, { from: appManager.address })
  await stakingRouter.grantRole(STAKING_MODULE_PAUSE_ROLE, voting.address, { from: appManager.address })
  await stakingRouter.grantRole(STAKING_MODULE_MANAGE_ROLE, voting.address, { from: appManager.address })

}

async function grantLidoRoles({ pool, acl, voting, appManager }) {
  const [
    PAUSE_ROLE,
    RESUME_ROLE,
    BURN_ROLE,
    STAKING_PAUSE_ROLE,
    STAKING_CONTROL_ROLE,
    SET_EL_REWARDS_WITHDRAWAL_LIMIT_ROLE,
    MANAGE_PROTOCOL_CONTRACTS_ROLE
  ] = await Promise.all([
    pool.PAUSE_ROLE(),
    pool.RESUME_ROLE(),
    pool.BURN_ROLE(),
    pool.STAKING_PAUSE_ROLE(),
    pool.STAKING_CONTROL_ROLE(),
    pool.SET_EL_REWARDS_WITHDRAWAL_LIMIT_ROLE(),
    pool.MANAGE_PROTOCOL_CONTRACTS_ROLE()
  ])
  await Promise.all([
    acl.createPermission(voting.address, pool.address, PAUSE_ROLE, appManager.address, { from: appManager.address }),
    acl.createPermission(voting.address, pool.address, RESUME_ROLE, appManager.address, { from: appManager.address }),
    acl.createPermission(voting.address, pool.address, BURN_ROLE, appManager.address, { from: appManager.address }),
    acl.createPermission(voting.address, pool.address, STAKING_PAUSE_ROLE, appManager.address, {
      from: appManager.address
    }),
    acl.createPermission(voting.address, pool.address, STAKING_CONTROL_ROLE, appManager.address, {
      from: appManager.address
    }),
    acl.createPermission(voting.address, pool.address, SET_EL_REWARDS_WITHDRAWAL_LIMIT_ROLE, appManager.address, {
      from: appManager.address
    }),
    acl.createPermission(voting.address, pool.address, MANAGE_PROTOCOL_CONTRACTS_ROLE, appManager.address, {
      from: appManager.address
    })
  ])
}

module.exports = {
  deployProtocol
}
