const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

const withdrawals = require('./withdrawals')
const { newApp } = require('./dao')

const OssifiableProxy = artifacts.require('OssifiableProxy')
const LidoMock = artifacts.require('LidoMock')
const Lido = artifacts.require('Lido')
const WstETHMock = artifacts.require('WstETHMock')
const WstETH = artifacts.require('WstETH')
const OracleMock = artifacts.require('OracleMock')
const LidoOracle = artifacts.require('LidoOracle')
const StakingRouter = artifacts.require('StakingRouter')
const StakingRouterMock = artifacts.require('StakingRouterMock')
const LidoExecutionLayerRewardsVault = artifacts.require('LidoExecutionLayerRewardsVault')
const WithdrawalVault = artifacts.require('WithdrawalVault')
const DepositContractMock = artifacts.require('DepositContractMock')
const DepositContract = artifacts.require('DepositContract')
const DepositSecurityModule = artifacts.require('DepositSecurityModule')
const EIP712StETH = artifacts.require('EIP712StETH')
const LidoLocatorMock = artifacts.require('LidoLocatorMock')
const SelfOwnedStETHBurner = artifacts.require('SelfOwnedStETHBurner')

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

async function lidoMockFactory({ dao, appManager, acl, voting }) {
  const base = await LidoMock.new()

  const proxyAddress = await newApp(dao, 'lido', base.address, appManager.address)

  const pool = await LidoMock.at(proxyAddress)

  await grantLidoRoles(pool, acl, voting, appManager)

  return pool
}

async function grantLidoRoles(pool, acl, voting, appManager) {
  const [
    PAUSE_ROLE,
    RESUME_ROLE,
    BURN_ROLE,
    STAKING_PAUSE_ROLE,
    STAKING_CONTROL_ROLE,
    MANAGE_MAX_POSITIVE_TOKEN_REBASE_ROLE
  ] = await Promise.all([
    pool.PAUSE_ROLE(),
    pool.RESUME_ROLE(),
    pool.BURN_ROLE(),
    pool.STAKING_PAUSE_ROLE(),
    pool.STAKING_CONTROL_ROLE(),
    pool.MANAGE_MAX_POSITIVE_TOKEN_REBASE_ROLE()
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
    acl.createPermission(voting.address, pool.address, MANAGE_MAX_POSITIVE_TOKEN_REBASE_ROLE, appManager.address, {
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

async function oracleFactory({ appManager }) {
  const base = await LidoOracle.new()
  const proxy = await OssifiableProxy.new(base.address, appManager.address, '0x')
  return await LidoOracle.at(proxy.address)
}

async function oracleMockFactory(_) {
  return await OracleMock.new()
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

async function withdrawalQueueFactory({ appManager, wsteth }) {
  const withdrawalQueue = (await withdrawals.deploy(appManager.address, wsteth.address)).queue

  await withdrawalQueue.initialize(appManager.address, appManager.address, appManager.address, appManager.address)

  const BUNKER_MODE_REPORT_ROLE = await withdrawalQueue.BUNKER_MODE_REPORT_ROLE()
  await withdrawalQueue.grantRole(BUNKER_MODE_REPORT_ROLE, appManager.address, { from: appManager.address })

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

async function selfOwnedStETHBurnerFactory({ appManager, treasury, pool }) {
  return SelfOwnedStETHBurner.new(appManager.address, treasury.address, pool.address, 0, 0)
}

async function lidoLocatorMockFactory(protocol) {
  return LidoLocatorMock.new(
    protocol.pool.address,
    protocol.depositSecurityModule.address,
    protocol.elRewardsVault.address,
    protocol.oracle.address,
    ZERO_ADDRESS,
    ZERO_ADDRESS,
    protocol.selfOwnedStETHBurner.address,
    protocol.stakingRouter.address,
    protocol.treasury.address,
    protocol.withdrawalQueue.address,
    protocol.withdrawalVault.address
  )
}

async function postSetup({ pool, lidoLocator, eip712StETH, oracle, depositContract, withdrawalQueue, appManager }) {
  await pool.initialize(lidoLocator.address, eip712StETH.address)

  await oracle.setPool(pool.address)
  await depositContract.reset()
  await depositContract.set_deposit_root(DEPOSIT_ROOT)
  await withdrawalQueue.updateBunkerMode(0, false, { from: appManager.address })
}

module.exports = {
  appManagerFactory,
  treasuryFactory,
  votingEOAFactory,
  depositContractFactory,
  lidoMockFactory,
  wstethFactory,
  oracleFactory,
  oracleMockFactory,
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
  lidoLocatorMockFactory,
  selfOwnedStETHBurnerFactory,
  postSetup
}
