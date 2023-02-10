const { ethers } = require('hardhat')

const { newDao } = require('./dao')
const { updateLocatorImplementation } = require('./locator-deploy')

const OssifiableProxy = artifacts.require('OssifiableProxy')

const factories = require('./factories')
const DEFAULT_FACTORIES = {
  appManagerFactory: factories.appManagerFactory,
  treasuryFactory: factories.treasuryFactory,
  votingFactory: factories.votingEOAFactory,
  lidoFactory: factories.lidoMockFactory,
  wstethFactory: factories.wstethFactory,
  legacyOracleFactory: factories.legacyOracleMockFactory,
  accountingOracleFactory: factories.accountingOracleFactory,
  hashConsensusFactory: factories.hashConsensusTimeTravellableFactory,
  reportProcessorFactory: factories.reportProcessorFactory,
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
  burnerFactory: factories.burnerFactory,
  postSetup: factories.postSetup,
  lidoLocatorFactory: factories.lidoLocatorFactory
}

const getFactory = (config, factoryName) => {
  return config[factoryName] ? config[factoryName] : DEFAULT_FACTORIES[factoryName]
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
  protocol.legacyOracle = await getFactory(config, 'legacyOracleFactory')(protocol)

  protocol.reportProcessor = await getFactory(config, 'reportProcessorFactory')(protocol)
  protocol.consensusContract = await getFactory(config, 'hashConsensusFactory')(protocol)

  protocol.depositContract = await getFactory(config, 'depositContractFactory')(protocol)

  protocol.withdrawalCredentials = await getFactory(config, 'withdrawalCredentialsFactory')(protocol)
  protocol.stakingRouter = await getFactory(config, 'stakingRouterFactory')(protocol)
  const stakingModulesFactory = getFactory(config, 'stakingModulesFactory')
  protocol.stakingModules = await addStakingModules(stakingModulesFactory, protocol)

  protocol.depositSecurityModule = await getFactory(config, 'depositSecurityModuleFactory')(protocol)
  protocol.elRewardsVault = await getFactory(config, 'elRewardsVaultFactory')(protocol)
  protocol.withdrawalVault = await getFactory(config, 'withdrawalVaultFactory')(protocol)
  protocol.eip712StETH = await getFactory(config, 'eip712StETHFactory')(protocol)
  protocol.burner = await getFactory(config, 'burnerFactory')(protocol)

  protocol.lidoLocator = await getFactory(config, 'lidoLocatorFactory')(protocol)

  await updateLocatorImplementation(protocol.lidoLocator.address, protocol.appManager.address, {
    lido: protocol.pool.address,
    depositSecurityModule: protocol.depositSecurityModule.address,
    elRewardsVault: protocol.elRewardsVault.address,
    legacyOracle: protocol.legacyOracle.address,
    burner: protocol.burner.address,
    stakingRouter: protocol.stakingRouter.address,
    treasury: protocol.treasury.address,
    withdrawalVault: protocol.withdrawalVault.address,
    postTokenRebaseReceiver: protocol.legacyOracle.address
  })

  protocol.oracle = await getFactory(config, 'accountingOracleFactory')(protocol)
  await updateLocatorImplementation(protocol.lidoLocator.address, protocol.appManager.address, {
    accountingOracle: protocol.oracle.address,
  })

  await protocol.legacyOracle.initialize(
    protocol.lidoLocator.address,
    protocol.consensusContract.address)

  protocol.withdrawalQueue = await getFactory(config, 'withdrawalQueueFactory')(protocol)

  await updateLocatorImplementation(protocol.lidoLocator.address, protocol.appManager.address, {
    withdrawalQueue: protocol.withdrawalQueue.address,
  })

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

async function upgradeOssifiableProxy(proxyAddress, newImplementation, proxyOwner) {
  const proxy = await OssifiableProxy.at(proxyAddress)

  await proxy.proxy__upgradeTo(newImplementation, { from: proxyOwner })
}

module.exports = {
  deployProtocol
}
