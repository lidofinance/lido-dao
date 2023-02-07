const { ethers } = require('hardhat')
const { DEFAULT_DEPLOY_PARAMS, DEAFAULT_FACTORIES } = require('./config')
const { getFactory } = require('./factories')

const { newDao } = require('./dao')

async function deployProtocol(factories = {}, deployParams = {}) {
  const protocol = {}
  protocol.deployParams = { ...DEFAULT_DEPLOY_PARAMS, ...deployParams }
  protocol.factories = { ...DEAFAULT_FACTORIES, ...factories }
  protocol.signers = await ethers.getSigners()

  // accounts
  protocol.appManager = await getFactory(factories, 'appManagerFactory')(protocol)
  protocol.treasury = await getFactory(factories, 'treasuryFactory')(protocol)
  protocol.voting = await getFactory(factories, 'votingFactory')(protocol)
  protocol.guardians = await getFactory(factories, 'guardiansFactory')(protocol)

  // TODO: pass through params
  const { dao, acl } = await newDao(protocol.appManager.address)
  protocol.dao = dao
  protocol.acl = acl

  protocol.pool = await getFactory(factories, 'lidoFactory')(protocol)
  protocol.token = protocol.pool

  protocol.wsteth = await getFactory(factories, 'wstethFactory')(protocol)
  protocol.legacyOracle = await getFactory(factories, 'legacyOracleFactory')(protocol)

  protocol.reportProcessor = await getFactory(factories, 'reportProcessorFactory')(protocol)
  protocol.consensusContract = await getFactory(factories, 'hashConsensusFactory')(protocol)

  protocol.depositContract = await getFactory(factories, 'depositContractFactory')(protocol)

  protocol.withdrawalCredentials = await getFactory(factories, 'withdrawalCredentialsFactory')(protocol)
  protocol.stakingRouter = await getFactory(factories, 'stakingRouterFactory')(protocol)

  protocol.stakingModules = await addStakingModules(getFactory(factories, 'stakingModulesFactory'), protocol)

  protocol.depositSecurityModule = await getFactory(factories, 'depositSecurityModuleFactory')(protocol)
  protocol.elRewardsVault = await getFactory(factories, 'elRewardsVaultFactory')(protocol)
  protocol.withdrawalVault = await getFactory(factories, 'withdrawalVaultFactory')(protocol)
  protocol.eip712StETH = await getFactory(factories, 'eip712StETHFactory')(protocol)
  protocol.selfOwnedStETHBurner = await getFactory(factories, 'selfOwnedStETHBurnerFactory')(protocol)

  protocol.lidoLocator = await getFactory(factories, 'lidoLocatorFactory')(protocol)
  protocol.oracle = await getFactory(factories, 'accountingOracleFactory')(protocol)
  protocol.withdrawalQueue = await getFactory(factories, 'withdrawalQueueFactory')(protocol)

  await getFactory(factories, 'postSetup')(protocol)

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
