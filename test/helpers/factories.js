const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

const withdrawals = require('./withdrawals')
const { newApp } = require('./dao')
const { artifacts } = require('hardhat')

const {
  SLOTS_PER_EPOCH,
  SECONDS_PER_SLOT,
  SECONDS_PER_EPOCH,
  EPOCHS_PER_FRAME,
  CONSENSUS_VERSION
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
const Burner = artifacts.require('Burner')

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

const GENESIS_TIME = ~~(+new Date() / 1000)
const LAST_COMPLETED_EPOCH = 1
const V1_ORACLE_LAST_COMPLETED_EPOCH = 2 * EPOCHS_PER_FRAME
const V1_ORACLE_LAST_REPORT_SLOT = V1_ORACLE_LAST_COMPLETED_EPOCH * SLOTS_PER_EPOCH

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

async function legacyOracleMockFactory({ appManager, dao }) {
  const base = await MockLegacyOracle.new()

  const proxyAddress = await newApp(dao, 'lido-legacy-oracle', base.address, appManager.address)

  const oracle = await MockLegacyOracle.at(proxyAddress)

  await oracle.setParams(
    EPOCHS_PER_FRAME,
    SLOTS_PER_EPOCH,
    SECONDS_PER_SLOT,
    GENESIS_TIME,
    V1_ORACLE_LAST_COMPLETED_EPOCH
  )

  return oracle
}

async function reportProcessorFactory(_) {
  return await MockReportProcessor.new(CONSENSUS_VERSION)
}

async function hashConsensusFactory({ voting, reportProcessor, signers, legacyOracle }) {
  const initialEpoch = (await legacyOracle.getLastCompletedEpochId()) + EPOCHS_PER_FRAME
  const consensus = await HashConsensus.new(
    SLOTS_PER_EPOCH,
    SECONDS_PER_SLOT,
    GENESIS_TIME,
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

async function hashConsensusTimeTravellableFactory({
  legacyOracle,
  voting,
  reportProcessor,
  signers,
  fastLaneLengthSlots = 0
}) {
  const initialEpoch = +(await legacyOracle.getLastCompletedEpochId()) + EPOCHS_PER_FRAME
  const consensus = await HashConsensusTimeTravellable.new(
    SLOTS_PER_EPOCH,
    SECONDS_PER_SLOT,
    GENESIS_TIME,
    EPOCHS_PER_FRAME,
    initialEpoch,
    fastLaneLengthSlots,
    voting.address,
    reportProcessor.address
  )

  await consensus.grantRole(await consensus.MANAGE_MEMBERS_AND_QUORUM_ROLE(), voting.address, { from: voting.address })
  await consensus.grantRole(await consensus.DISABLE_CONSENSUS_ROLE(), voting.address, { from: voting.address })
  await consensus.grantRole(await consensus.MANAGE_FRAME_CONFIG_ROLE(), voting.address, { from: voting.address })
  await consensus.grantRole(await consensus.MANAGE_REPORT_PROCESSOR_ROLE(), voting.address, { from: voting.address })

  await consensus.addMember(signers[2].address, 1, { from: voting.address })
  await consensus.addMember(signers[3].address, 2, { from: voting.address })
  await consensus.addMember(signers[4].address, 2, { from: voting.address })
  await consensus.setTime(GENESIS_TIME + initialEpoch * SLOTS_PER_EPOCH * SECONDS_PER_SLOT)

  return consensus
}

async function accountingOracleFactory({ voting, pool, lidoLocator, consensusContract, legacyOracle }) {
  const base = await AccountingOracle.new(lidoLocator.address, SECONDS_PER_SLOT, GENESIS_TIME)
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

async function depositSecurityModuleFactory({ pool, depositContract, stakingRouter, appManager }) {
  const depositSecurityModule = await DepositSecurityModule.new(
    pool.address,
    depositContract.address,
    stakingRouter.address,
    MAX_DEPOSITS_PER_BLOCK,
    MIN_DEPOSIT_BLOCK_DISTANCE,
    PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS,
    { from: appManager.address }
  )
  await depositSecurityModule.addGuardians([GUARDIAN3, GUARDIAN1, GUARDIAN2], 2, { from: appManager.address })

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

async function guardiansFactory(_) {
  return {
    privateKeys: GUARDIAN_PRIVATE_KEYS,
    addresses: [GUARDIAN1, GUARDIAN2, GUARDIAN3]
  }
}

async function burnerFactory({ appManager, treasury, pool, voting }) {
  const burner = await Burner.new(appManager.address, treasury.address, pool.address, 0, 0)

  const [REQUEST_BURN_MY_STETH_ROLE, RECOVER_ASSETS_ROLE] = await Promise.all([
    burner.REQUEST_BURN_MY_STETH_ROLE(),
    burner.RECOVER_ASSETS_ROLE()
  ])

  await burner.grantRole(REQUEST_BURN_MY_STETH_ROLE, voting.address, { from: appManager.address })
  await burner.grantRole(RECOVER_ASSETS_ROLE, voting.address, { from: appManager.address })

  return burner
}

async function lidoLocatorFactory(protocol) {
  const base = await lidoLocatorMockImplFactory(protocol)
  return await OssifiableProxy.new(base.address, protocol.appManager.address, '0x')
}

async function lidoLocatorMockImplFactory(protocol) {
  return LidoLocatorMock.new({
    lido: protocol.pool.address,
    depositSecurityModule: protocol.depositSecurityModule.address,
    elRewardsVault: protocol.elRewardsVault.address,
    accountingOracle: protocol.oracle ? protocol.oracle.address : ZERO_ADDRESS,
    legacyOracle: protocol.legacyOracle.address,
    oracleReportSanityChecker: ZERO_ADDRESS,
    burner: protocol.burner.address,
    validatorExitBus: ZERO_ADDRESS,
    stakingRouter: protocol.stakingRouter.address,
    treasury: protocol.treasury.address,
    withdrawalQueue: protocol.withdrawalQueue ? protocol.withdrawalQueue.address : ZERO_ADDRESS,
    withdrawalVault: protocol.withdrawalVault.address,
    postTokenRebaseReceiver: protocol.legacyOracle.address
  })
}

async function postSetup({ pool, lidoLocator, eip712StETH, depositContract, withdrawalQueue, appManager, voting }) {
  await pool.initialize(lidoLocator.address, eip712StETH.address)

  // await oracle.setPool(pool.address)
  await depositContract.reset()
  await depositContract.set_deposit_root(DEPOSIT_ROOT)
  await withdrawalQueue.updateBunkerMode(false, 0, { from: appManager.address })
  await pool.resumeProtocolAndStaking({ from: voting.address })
}

module.exports = {
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
  burnerFactory,
  postSetup,
  legacyOracleFactory,
  legacyOracleMockFactory,
  hashConsensusFactory,
  hashConsensusTimeTravellableFactory,
  reportProcessorFactory,
  lidoLocatorFactory
}
