const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

const withdrawals = require('./withdrawals')
const { newApp } = require('./dao')
const { artifacts } = require('hardhat')
const { DEAFAULT_FACTORIES } = require('./config')

const {
  SLOTS_PER_EPOCH,
  SECONDS_PER_SLOT,
  EPOCHS_PER_FRAME,
  CONSENSUS_VERSION,
  SECONDS_PER_FRAME
} = require('./constants')

const OssifiableProxy = artifacts.require('OssifiableProxy')
const LidoMock = artifacts.require('LidoMock')
const Lido = artifacts.require('Lido')
const WstETHMock = artifacts.require('WstETHMock')
const WstETH = artifacts.require('WstETH')
const LidoOracle = artifacts.require('LidoOracle')
const MockLegacyOracle = artifacts.require('MockLegacyOracle')
const AccountingOracle = artifacts.require('AccountingOracle')
const HashConsensus = artifacts.require('HashConsensus')
const HashConsensusTimeTravellable = artifacts.require('HashConsensusTimeTravellable')
const MockReportProcessor = artifacts.require('MockReportProcessor')
const StakingRouter = artifacts.require('StakingRouter')
const LidoExecutionLayerRewardsVault = artifacts.require('LidoExecutionLayerRewardsVault')
const WithdrawalVault = artifacts.require('WithdrawalVault')
const DepositContractMock = artifacts.require('DepositContractMock')
const DepositContract = artifacts.require('DepositContract')
const DepositSecurityModule = artifacts.require('DepositSecurityModule')
const EIP712StETH = artifacts.require('EIP712StETH')
const LidoLocatorMock = artifacts.require('LidoLocatorMock')
const SelfOwnedStETHBurner = artifacts.require('SelfOwnedStETHBurner')
const OracleReportSanityChecker = artifacts.require('OracleReportSanityChecker')

function getFactory(config, factoryName) {
  return config[factoryName] ? config[factoryName] : DEAFAULT_FACTORIES[factoryName]
}

async function lidoMockFactory({ dao, appManager, acl, voting }) {
  const base = await LidoMock.new()

  const proxyAddress = await newApp(dao, 'lido', base.address, appManager.address)

  const pool = await LidoMock.at(proxyAddress)

  await grantLidoRoles(pool, acl, voting, appManager)

  return pool
}

async function grantLidoRoles(pool, acl, voting, appManager) {
  await Promise.all([
    acl.createPermission(voting.address, pool.address, await pool.PAUSE_ROLE(), appManager.address, {
      from: appManager.address
    }),
    acl.createPermission(voting.address, pool.address, await pool.RESUME_ROLE(), appManager.address, {
      from: appManager.address
    }),
    acl.createPermission(voting.address, pool.address, await pool.STAKING_PAUSE_ROLE(), appManager.address, {
      from: appManager.address
    }),
    acl.createPermission(voting.address, pool.address, await pool.STAKING_CONTROL_ROLE(), appManager.address, {
      from: appManager.address
    })
  ])
}

async function depositContractMockFactory(_) {
  return await DepositContractMock.new()
}

async function depositContractFactory(_) {
  return await DepositContract.new()
}

async function wstethFactory({ pool }) {
  return await WstETH.new(pool.address)
}

async function appManagerFactory({ signers }) {
  return signers[0]
}

async function votingEOAFactory({ signers }) {
  return signers[1]
}

async function treasuryFactory(_) {
  return web3.eth.accounts.create()
}

async function legacyOracleFactory({ appManager }) {
  const base = await LidoOracle.new()
  const proxy = await OssifiableProxy.new(base.address, appManager.address, '0x')
  return await LidoOracle.at(proxy.address)
}

async function legacyOracleMockFactory({ appManager, dao, deployParams }) {
  const base = await MockLegacyOracle.new()

  const proxyAddress = await newApp(dao, 'lido-legacy-oracle', base.address, appManager.address)

  const oracle = await MockLegacyOracle.at(proxyAddress)

  await oracle.setParams(
    EPOCHS_PER_FRAME,
    SLOTS_PER_EPOCH,
    SECONDS_PER_SLOT,
    deployParams.genesisTime,
    deployParams.v1OracleLastCompletedEpoch
  )

  return oracle
}

async function reportProcessorMockFactory(_) {
  return await MockReportProcessor.new(CONSENSUS_VERSION)
}

async function hashConsensusFactory({ voting, reportProcessor, signers, legacyOracle, deployParams }) {
  const initialEpoch = (await legacyOracle.getLastCompletedEpochId()) + EPOCHS_PER_FRAME
  const consensus = await HashConsensus.new(
    SLOTS_PER_EPOCH,
    SECONDS_PER_SLOT,
    deployParams.genesisTime,
    EPOCHS_PER_FRAME,
    initialEpoch,
    voting.address,
    reportProcessor.address
  )

  await consensus.grantRole(await consensus.MANAGE_MEMBERS_AND_QUORUM_ROLE(), voting.address, { from: voting.address })
  await consensus.grantRole(await consensus.DISABLE_CONSENSUS_ROLE(), voting.address, { from: voting.address })
  await consensus.grantRole(await consensus.MANAGE_INTERVAL_ROLE(), voting.address, { from: voting.address })
  await consensus.grantRole(await consensus.MANAGE_REPORT_PROCESSOR_ROLE(), voting.address, { from: voting.address })

  await consensus.addMember(signers[2].address, 1, { from: voting.address })
  await consensus.addMember(signers[3].address, 2, { from: voting.address })
  await consensus.addMember(signers[4].address, 2, { from: voting.address })

  return consensus
}

async function hashConsensusTimeTravellableFactory({ legacyOracle, voting, reportProcessor, signers, deployParams }) {
  const initialEpoch = +(await legacyOracle.getLastCompletedEpochId()) + EPOCHS_PER_FRAME
  const consensus = await HashConsensusTimeTravellable.new(
    SLOTS_PER_EPOCH,
    SECONDS_PER_SLOT,
    deployParams.genesisTime,
    EPOCHS_PER_FRAME,
    initialEpoch,
    voting.address,
    reportProcessor.address
  )

  await consensus.grantRole(await consensus.MANAGE_MEMBERS_AND_QUORUM_ROLE(), voting.address, { from: voting.address })
  await consensus.grantRole(await consensus.DISABLE_CONSENSUS_ROLE(), voting.address, { from: voting.address })
  await consensus.grantRole(await consensus.MANAGE_INTERVAL_ROLE(), voting.address, { from: voting.address })
  await consensus.grantRole(await consensus.MANAGE_REPORT_PROCESSOR_ROLE(), voting.address, { from: voting.address })

  await consensus.addMember(signers[2].address, 1, { from: voting.address })
  await consensus.addMember(signers[3].address, 2, { from: voting.address })
  await consensus.addMember(signers[4].address, 2, { from: voting.address })
  await consensus.setTime(deployParams.genesisTime + initialEpoch * SLOTS_PER_EPOCH * SECONDS_PER_SLOT)

  return consensus
}

async function accountingOracleFactory({ voting, pool, lidoLocator, consensusContract, legacyOracle, deployParams }) {
  const base = await AccountingOracle.new(lidoLocator.address, SECONDS_PER_SLOT, deployParams.genesisTime)
  const proxy = await OssifiableProxy.new(base.address, voting.address, '0x')
  const oracle = await AccountingOracle.at(proxy.address)

  await oracle.initialize(
    voting.address,
    consensusContract.address,
    CONSENSUS_VERSION,
    legacyOracle.address,
    10000,
    10000
  )

  await legacyOracle.initialize(pool.address, oracle.address)

  await oracle.grantRole(await oracle.MANAGE_CONSENSUS_CONTRACT_ROLE(), voting.address, { from: voting.address })
  await oracle.grantRole(await oracle.MANAGE_CONSENSUS_VERSION_ROLE(), voting.address, { from: voting.address })
  await oracle.grantRole(await oracle.SUBMIT_DATA_ROLE(), voting.address, { from: voting.address })
  await oracle.grantRole(await oracle.MANAGE_DATA_BOUNDARIES_ROLE(), voting.address, { from: voting.address })

  await consensusContract.setReportProcessor(oracle.address, { from: voting.address })

  return oracle
}

async function withdrawalCredentialsFactory() {
  return '0x'.padEnd(66, '1234')
}

async function stakingRouterFactory({ depositContract, dao, appManager, voting, pool, withdrawalCredentials }) {
  const base = await StakingRouter.new(depositContract.address)

  const proxyAddress = await newApp(dao, 'lido-oracle', base.address, appManager.address)
  const stakingRouter = await StakingRouter.at(proxyAddress)
  await stakingRouter.initialize(appManager.address, pool.address, withdrawalCredentials, { from: appManager.address })

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

  return stakingRouter
}

async function depositSecurityModuleFactory({
  pool,
  depositContract,
  stakingRouter,
  appManager,
  deployParams,
  guardians
}) {
  const depositSecurityModule = await DepositSecurityModule.new(
    pool.address,
    depositContract.address,
    stakingRouter.address,
    deployParams.maxDepositsPerBlock,
    deployParams.minDepositBlockDistance,
    deployParams.pauseIntentValidityPeriodBlocks,
    { from: appManager.address }
  )
  await depositSecurityModule.addGuardians(
    guardians.map(({ address }) => address),
    2,
    { from: appManager.address }
  )

  return depositSecurityModule
}

async function elRewardsVaultFactory({ pool, treasury }) {
  return await LidoExecutionLayerRewardsVault.new(pool.address, treasury.address)
}

async function withdrawalQueueFactory({ appManager, oracle, wsteth }) {
  const withdrawalQueue = (await withdrawals.deploy(appManager.address, wsteth.address)).queue

  await withdrawalQueue.initialize(appManager.address, appManager.address, appManager.address, appManager.address)

  const BUNKER_MODE_REPORT_ROLE = await withdrawalQueue.BUNKER_MODE_REPORT_ROLE()
  await withdrawalQueue.grantRole(BUNKER_MODE_REPORT_ROLE, appManager.address, { from: appManager.address })
  await withdrawalQueue.grantRole(BUNKER_MODE_REPORT_ROLE, oracle.address, { from: appManager.address })

  return withdrawalQueue
}

async function withdrawalVaultFactory({ pool, treasury }) {
  return await WithdrawalVault.new(pool.address, treasury.address)
}

async function eip712StETHFactory({ appManager }) {
  return await EIP712StETH.new({ from: appManager.address })
}

async function stakingModulesFactory(_) {
  return []
}

async function guardiansFactory({ deployParams }) {
  return {
    privateKeys: deployParams.guardians,
    addresses: deployParams.guardians.keys()
  }
}

async function selfOwnedStETHBurnerFactory({ appManager, treasury, pool, voting }) {
  const burner = await SelfOwnedStETHBurner.new(appManager.address, treasury.address, pool.address, 0, 0)

  const [REQUEST_BURN_MY_STETH_ROLE, RECOVER_ASSETS_ROLE] = await Promise.all([
    burner.REQUEST_BURN_MY_STETH_ROLE(),
    burner.RECOVER_ASSETS_ROLE()
  ])

  await burner.grantRole(REQUEST_BURN_MY_STETH_ROLE, voting.address, { from: appManager.address })
  await burner.grantRole(RECOVER_ASSETS_ROLE, voting.address, { from: appManager.address })

  return burner
}

async function oracleReportSanityCheckerFactory({ lidoLocator, appManager, deployParams }) {
  return OracleReportSanityChecker.new(
    lidoLocator,
    SECONDS_PER_FRAME,
    appManager.address,
    deployParams.oracleReportSanityCheckerLimitsList,
    deployParams.oracleReportSanityCheckerManagersRoster
  )
}

async function validatorExitBus(protocol) {
  
}

async function lidoLocatorFactory(protocol) {
  const base = await lidoLocatorMockImplFactory(protocol)
  return await OssifiableProxy.new(base.address, protocol.appManager.address, '0x')
}

async function lidoLocatorMockImplFactory(protocol) {
  return LidoLocatorMock.new({
    lido: protocol.pool ? protocol.pool.address : ZERO_ADDRESS,
    depositSecurityModule: protocol.depositSecurityModule ? protocol.depositSecurityModule.address : ZERO_ADDRESS,
    elRewardsVault: protocol.elRewardsVault ? protocol.elRewardsVault.address : ZERO_ADDRESS,
    accountingOracle: protocol.oracle ? protocol.oracle.address : ZERO_ADDRESS,
    legacyOracle: protocol.legacyOracle ? protocol.legacyOracle.address : ZERO_ADDRESS,
    oracleReportSanityChecker: protocol.oracleReportSanityChecker
      ? protocol.oracleReportSanityChecker.address
      : ZERO_ADDRESS,
    selfOwnedStEthBurner: protocol.selfOwnedStETHBurner ? protocol.selfOwnedStETHBurner.address : ZERO_ADDRESS,
    validatorExitBus: protocol.validatorExitBus ? protocol.validatorExitBus.address : ZERO_ADDRESS,
    stakingRouter: protocol.stakingRouter ? protocol.stakingRouter.address : ZERO_ADDRESS,
    treasury: protocol.treasury ? protocol.treasury.address : ZERO_ADDRESS,
    withdrawalQueue: protocol.withdrawalQueue ? protocol.withdrawalQueue.address : ZERO_ADDRESS,
    withdrawalVault: protocol.withdrawalVault ? protocol.withdrawalVault.address : ZERO_ADDRESS,
    postTokenRebaseReceiver: protocol.legacyOracle ? protocol.legacyOracle.address : ZERO_ADDRESS
  })
}

async function postSetup(protocol) {
  const { pool, lidoLocator, eip712StETH, depositContract, withdrawalQueue, appManager, voting } = protocol

  await upgradeOssifiableProxy(
    lidoLocator.address,
    (
      await getFactory(protocol.factories, 'lidoLocatorImplFactory')(protocol)
    ).address,
    appManager.address
  )

  await pool.initialize(lidoLocator.address, eip712StETH.address)

  await depositContract.reset()
  await depositContract.set_deposit_root(DEPOSIT_ROOT)
  await withdrawalQueue.updateBunkerMode(false, 0, { from: appManager.address })
  await pool.resumeProtocolAndStaking({ from: voting.address })
}

async function upgradeOssifiableProxy(proxyAddress, newImplemantation, proxyOwner) {
  const proxy = await OssifiableProxy.at(proxyAddress)

  await proxy.proxy__upgradeTo(newImplemantation, { from: proxyOwner })
}

module.exports = {
  getFactory,
  upgradeOssifiableProxy,
  appManagerFactory,
  treasuryFactory,
  votingEOAFactory,
  depositContractFactory,
  lidoMockFactory,
  wstethFactory,
  accountingOracleFactory,
  depositContractMockFactory,
  stakingRouterFactory,
  depositSecurityModuleFactory,
  elRewardsVaultFactory,
  withdrawalQueueFactory,
  withdrawalVaultFactory,
  eip712StETHFactory,
  withdrawalCredentialsFactory,
  stakingModulesFactory,
  guardiansFactory,
  lidoLocatorMockImplFactory,
  selfOwnedStETHBurnerFactory,
  postSetup,
  legacyOracleFactory,
  legacyOracleMockFactory,
  hashConsensusFactory,
  hashConsensusTimeTravellableFactory,
  reportProcessorMockFactory,
  lidoLocatorFactory,
  oracleReportSanityCheckerFactory,
  validatorExitBus
}
