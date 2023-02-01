const { artifacts } = require('hardhat')
const withdrawals = require('./withdrawals')

const { newApp } = require('./dao')

const OssifiableProxy = artifacts.require('OssifiableProxy.sol')
const LidoMock = artifacts.require('LidoMock')
const Lido = artifacts.require('Lido')
const WstETHMock = artifacts.require('WstETHMock')
const WstETH = artifacts.require('WstETH')
const OracleMock = artifacts.require('OracleMock')
const LidoOracle = artifacts.require('LidoOracle')
const StakingRouter = artifacts.require('StakingRouter.sol')
const StakingRouterMock = artifacts.require('StakingRouterMock.sol')
const LidoELRewardsVault = artifacts.require('LidoExecutionLayerRewardsVault.sol')
const WithdrawalVault = artifacts.require('WithdrawalVault')
const DepositContractMock = artifacts.require('DepositContractMock.sol')
const DepositSecurityModule = artifacts.require('DepositSecurityModule.sol')
const EIP712StETH = artifacts.require('EIP712StETH')

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
async function lidoMockFactory({ dao, appManager }) {
  const base = await LidoMock.new()

  const proxyAddress = await newApp(dao, 'lido', base.address, appManager.address)

  return await LidoMock.at(proxyAddress)
}

async function depositContractFactory(_) {
  return await DepositContractMock.new()
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

async function depositContractMockFactory() {
  return await DepositContractMock.new()
}

async function withdrawalCredentialsFactory() {
  return '0x'.padEnd(66, '1234')
}

async function stakingRouterFactory({ depositContract, dao, appManager, pool, withdrawalCredentials }) {
  const base = await StakingRouter.new(depositContract.address)

  const proxyAddress = await newApp(dao, 'lido-oracle', base.address, appManager.address)
  const stakingRouter = await StakingRouter.at(proxyAddress)
  await stakingRouter.initialize(appManager.address, pool.address, withdrawalCredentials, { from: appManager.address })

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
  return await LidoELRewardsVault.new(pool.address, treasury.address)
}

async function withdrawalQueueFactory({ appManager, wsteth }) {
  return (await withdrawals.deploy(appManager.address, wsteth.address)).queue
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
  guardiansFactory
}
