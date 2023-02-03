const { ethers } = require('hardhat')

const { newDao } = require('./dao')

const factories = require('./factories')
const DEAFAULT_FACTORIES = {
  appManagerFactory: factories.appManagerFactory,
  treasuryFactory: factories.treasuryFactory,
  votingFactory: factories.votingEOAFactory,
  lidoFactory: factories.lidoMockFactory,
  wstethFactory: factories.wstethFactory,
  oracleFactory: factories.oracleMockFactory,
  depositContractFactory: factories.depositContractMockFactory,
  stakingRouterFactory: factories.stakingRouterFactory,
  depositSecurityModuleFactory: factories.depositSecurityModuleFactory,
  elRewardsVaultFactory: factories.elRewardsVaultFactory,
  withdrawalQueueFactory: factories.withdrawalQueueFactory,
  withdrawalVaultFactory: factories.withdrawalVaultFactory,
  eip712StETHFactory: factories.eip712StETHFactory,
  withdrawalCredentialsFactory: factories.withdrawalCredentialsFactory,
  stakingModulesFactory: factories.stakingModulesFactory,
  guardiansFactory: factories.guardiansFactory,
  lidoLocatorFactory: factories.lidoLocatorMockFactory,
  selfOwnedStETHBurnerFactory: factories.selfOwnedStETHBurnerFactory,
  postSetup: factories.postSetup
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

  protocol.wsteth = await getFactory(config, 'wstethFactory')(protocol)
  protocol.oracle = await getFactory(config, 'oracleFactory')(protocol)

  protocol.depositContract = await getFactory(config, 'depositContractFactory')(protocol)

  protocol.withdrawalCredentials = await getFactory(config, 'withdrawalCredentialsFactory')(protocol)
  protocol.stakingRouter = await getFactory(config, 'stakingRouterFactory')(protocol)
  const stakingModulesFactory = getFactory(config, 'stakingModulesFactory')
  protocol.stakingModules = await addStakingModules(stakingModulesFactory, protocol)

  protocol.depositSecurityModule = await getFactory(config, 'depositSecurityModuleFactory')(protocol)
  protocol.elRewardsVault = await getFactory(config, 'elRewardsVaultFactory')(protocol)
  protocol.withdrawalQueue = await getFactory(config, 'withdrawalQueueFactory')(protocol)
  protocol.withdrawalVault = await getFactory(config, 'withdrawalVaultFactory')(protocol)
  protocol.eip712StETH = await getFactory(config, 'eip712StETHFactory')(protocol)
  protocol.selfOwnedStETHBurner = await getFactory(config, 'selfOwnedStETHBurnerFactory')(protocol)
  protocol.lidoLocator = await getFactory(config, 'lidoLocatorFactory')(protocol)

  await getFactory(config, 'postSetup')(protocol)

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

module.exports = {
  deployProtocol
}
