const { ethers } = require('hardhat')
const { DEFAULT_DEPLOY_PARAMS, DEFAULT_FACTORIES } = require('./config')

const { newDao } = require('./dao')
const { updateLocatorImplementation } = require('./locator-deploy')

async function deployProtocol(factories = {}, deployParams = {}) {
  const protocol = {}
  protocol.deployParams = { ...DEFAULT_DEPLOY_PARAMS, ...deployParams }
  protocol.factories = { ...DEFAULT_FACTORIES, ...factories }

  // accounts
  protocol.signers = await ethers.getSigners()
  protocol.appManager = await protocol.factories.appManagerFactory(protocol)
  protocol.treasury = await protocol.factories.treasuryFactory(protocol)
  protocol.voting = await protocol.factories.votingFactory(protocol)
  protocol.guardians = await protocol.factories.guardiansFactory(protocol)

  const { dao, acl } = await newDao(protocol.appManager.address)
  protocol.dao = dao
  protocol.acl = acl

  protocol.pool = await protocol.factories.lidoFactory(protocol)
  protocol.token = protocol.pool
  protocol.wsteth = await protocol.factories.wstethFactory(protocol)

  protocol.legacyOracle = await protocol.factories.legacyOracleFactory(protocol)

  protocol.depositContract = await protocol.factories.depositContractFactory(protocol)

  protocol.burner = await protocol.factories.burnerFactory(protocol)
  protocol.lidoLocator = await protocol.factories.lidoLocatorFactory(protocol)

  await updateLocatorImplementation(protocol.lidoLocator.address, protocol.appManager.address, {
    lido: protocol.pool.address,
    burner: protocol.burner.address,
  })

  protocol.validatorExitBus = await protocol.factories.validatorExitBusFactory(protocol)
  protocol.oracleReportSanityChecker = await protocol.factories.oracleReportSanityCheckerFactory(protocol)
  protocol.oracle = await protocol.factories.accountingOracleFactory(protocol)

  protocol.withdrawalCredentials = await protocol.factories.withdrawalCredentialsFactory(protocol)
  protocol.stakingRouter = await protocol.factories.stakingRouterFactory(protocol)
  protocol.stakingModules = await addStakingModules(protocol.factories.stakingModulesFactory, protocol)
  protocol.depositSecurityModule = await protocol.factories.depositSecurityModuleFactory(protocol)

  protocol.elRewardsVault = await protocol.factories.elRewardsVaultFactory(protocol)
  protocol.withdrawalVault = await protocol.factories.withdrawalVaultFactory(protocol)
  protocol.eip712StETH = await protocol.factories.eip712StETHFactory(protocol)

  await updateLocatorImplementation(protocol.lidoLocator.address, protocol.appManager.address, {
    depositSecurityModule: protocol.depositSecurityModule.address,
    elRewardsVault: protocol.elRewardsVault.address,
    legacyOracle: protocol.legacyOracle.address,
    stakingRouter: protocol.stakingRouter.address,
    treasury: protocol.treasury.address,
    withdrawalVault: protocol.withdrawalVault.address,
    postTokenRebaseReceiver: protocol.legacyOracle.address,
    accountingOracle: protocol.oracle.address,
    oracleReportSanityChecker: protocol.oracleReportSanityChecker.address,
    validatorsExitBusOracle: protocol.validatorExitBus.address,
  })

  protocol.consensusContract = await protocol.factories.hashConsensusFactory(protocol)

  protocol.withdrawalQueue = await protocol.factories.withdrawalQueueFactory(protocol)

  await updateLocatorImplementation(protocol.lidoLocator.address, protocol.appManager.address, {
    withdrawalQueue: protocol.withdrawalQueue.address,
  })

  await protocol.factories.postSetup(protocol)

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
  deployProtocol,
}
