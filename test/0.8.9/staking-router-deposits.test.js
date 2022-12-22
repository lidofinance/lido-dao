const hre = require('hardhat')
const { assert } = require('chai')
const { assertBn, assertRevert } = require('@aragon/contract-helpers-test/src/asserts')
const { BN, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers')
const { newDao, newApp } = require('../0.4.24/helpers/dao')
const { ETH } = require('../helpers/utils')
const { expect } = require('chai')

const LidoMock = artifacts.require('LidoMock.sol')
const LidoOracleMock = artifacts.require('OracleMock.sol')
const NodeOperatorsRegistryMock = artifacts.require('NodeOperatorsRegistryMock')
const StakingRouter = artifacts.require('StakingRouter')
const StakingModuleMock = artifacts.require('StakingModuleMock')
const DepositContractMock = artifacts.require('DepositContractMock.sol')
const DepositSecurityModule = artifacts.require('DepositSecurityModule.sol')
const DepositContractMockForDepositSecurityModule = artifacts.require('DepositContractMockForDepositSecurityModule.sol')
const StakingRouterMockForDepositSecurityModule = artifacts.require('StakingRouterMockForDepositSecurityModule')

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'

const MAX_DEPOSITS_PER_BLOCK = 100
const MIN_DEPOSIT_BLOCK_DISTANCE = 20
const PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS = 10

contract('StakingRouter', (accounts) => {
  let evmSnapshotId
  let depositContract, stakingRouter
  let curatedStakingModuleMock, soloStakingModuleMock, dvtStakingModuleMock
  let dao, acl
  let depositSecurityModule, depositContractMock, stakingRouterMock
  const [deployer, voting, admin, stranger1] = accounts

  before(async () => {
    const lidoBase = await LidoMock.new({ from: deployer })

    const daoObject = await newDao(deployer)
    dao = daoObject.dao
    acl = daoObject.acl

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    let proxyAddress = await newApp(dao, 'lido', lidoBase.address, deployer)
    lido = await LidoMock.at(proxyAddress)
    await lido.resumeProtocolAndStaking()

    depositContract = await DepositContractMock.new({ from: deployer })
    stakingRouter = await StakingRouter.new(depositContract.address, { from: deployer })
    ;[curatedStakingModuleMock, soloStakingModuleMock, dvtStakingModuleMock] = await Promise.all([
      StakingModuleMock.new({ from: deployer }),
      StakingModuleMock.new({ from: deployer }),
      StakingModuleMock.new({ from: deployer })
    ])

    // DSM
    stakingRouterMock = await StakingRouterMockForDepositSecurityModule.new()
    depositContractMock = await DepositContractMockForDepositSecurityModule.new()
    depositSecurityModule = await DepositSecurityModule.new(
      depositContractMock.address,
      stakingRouterMock.address,
      MAX_DEPOSITS_PER_BLOCK,
      MIN_DEPOSIT_BLOCK_DISTANCE,
      PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS,
      { from: deployer }
    )

    // unlock dsm account (allow transactions originated from dsm.address)
    await ethers.provider.send('hardhat_impersonateAccount', [depositSecurityModule.address])

    // Oracle
    oracle = await LidoOracleMock.new({ from: deployer })

    // NodeOperatorsRegistry
    const nodeOperatorsRegistryBase = await NodeOperatorsRegistryMock.new({ from: deployer })
    proxyAddress = await newApp(dao, 'node-operators-registry', nodeOperatorsRegistryBase.address, deployer)
    operators = await NodeOperatorsRegistryMock.at(proxyAddress)
    await operators.initialize(lido.address)

    await lido.initialize(depositContract.address, oracle.address, operators.address)

    // Set up the Lido permissions.
    await acl.createPermission(voting, lido.address, await lido.DEPOSIT_ROLE(), deployer, { from: deployer })
    await acl.createPermission(voting, lido.address, await lido.MANAGE_PROTOCOL_CONTRACTS_ROLE(), deployer, { from: deployer })

    await acl.createPermission(voting, operators.address, await operators.ADD_NODE_OPERATOR_ROLE(), deployer, { from: deployer })
    await acl.createPermission(voting, operators.address, await operators.MANAGE_SIGNING_KEYS(), deployer, { from: deployer })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_LIMIT_ROLE(), deployer, { from: deployer })
    await acl.createPermission(stakingRouter.address, operators.address, await operators.ASSIGN_NEXT_KEYS_ROLE(), deployer, {
      from: deployer
    })
    await acl.createPermission(stakingRouter.address, operators.address, await operators.TRIM_UNUSED_KEYS_ROLE(), deployer, {
      from: deployer
    })

    const wc = '0x'.padEnd(66, '1234')
    await stakingRouter.initialize(admin, wc, { from: deployer })

    // Set up the staking router permissions.
    const [MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, MODULE_PAUSE_ROLE, MODULE_MANAGE_ROLE, STAKING_ROUTER_DEPOSIT_ROLE] = await Promise.all([
      stakingRouter.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(),
      stakingRouter.MODULE_PAUSE_ROLE(),
      stakingRouter.MODULE_MANAGE_ROLE(),
      stakingRouter.STAKING_ROUTER_DEPOSIT_ROLE()
    ])

    await stakingRouter.grantRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, voting, { from: admin })
    await stakingRouter.grantRole(MODULE_PAUSE_ROLE, voting, { from: admin })
    await stakingRouter.grantRole(MODULE_MANAGE_ROLE, voting, { from: admin })
    await stakingRouter.grantRole(STAKING_ROUTER_DEPOSIT_ROLE, lido.address, { from: admin })

    await lido.setStakingRouter(stakingRouter.address, { from: voting })
    await lido.setDepositSecurityModule(depositSecurityModule.address, { from: voting })

    evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
  })

  afterEach(async () => {
    await hre.ethers.provider.send('evm_revert', [evmSnapshotId])
    evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
  })

  describe('Make deposit', () => {
    beforeEach(async () => {
      await stakingRouter.addModule(
        'Curated',
        operators.address,
        10_000, // 100 % _targetShare
        1_000, // 10 % _moduleFee
        5_000, // 50 % _treasuryFee
        { from: voting }
      )
      await stakingRouter.addModule(
        'Community',
        soloStakingModuleMock.address,
        200, // 2 % _targetShare
        5_000, // 50 % _moduleFee
        0, // 0 % _treasuryFee
        { from: voting }
      )
    })

    it('Lido.deposit() :: transfer balance', async () => {
      const maxDepositsCount = 150

      await web3.eth.sendTransaction({ value: ETH(maxDepositsCount * 32), to: lido.address, from: stranger1 })
      assertBn(await lido.getBufferedEther(), ETH(maxDepositsCount * 32))

      // before total tvl
      const prev = await lido.getTotalPooledEther()
      assertBn(prev, ETH(maxDepositsCount * 32))

      await lido.transferToStakingRouter(maxDepositsCount, { from: voting })
      assert(await lido.getBufferedEther(), 0)
      assert(await lido.getStakingRouterBufferedEther(), maxDepositsCount * 32)

      const stakingRouterBalance = await web3.eth.getBalance(stakingRouter.address)
      assert(stakingRouterBalance, maxDepositsCount * 32)

      // after total tvl
      assertBn(await lido.getTotalPooledEther(), prev)
    })

    it('Lido.deposit() :: check permissionss', async () => {
      const maxDepositsCount = 150

      await web3.eth.sendTransaction({ value: ETH(maxDepositsCount * 32), to: lido.address, from: stranger1 })
      assertBn(await lido.getBufferedEther(), ETH(maxDepositsCount * 32))

      const [curated, _] = await stakingRouter.getStakingModules()

      assertRevert(lido.deposit(maxDepositsCount, curated.id, '0x', { from: stranger1 }), 'APP_AUTH_DSM_FAILED')
      assertRevert(lido.deposit(maxDepositsCount, curated.id, '0x', { from: voting }), 'APP_AUTH_DSM_FAILED')

      // assertRevert(stakingRouter.deposit(maxDepositsCount, curated.id, '0x', {'from': voting }), 'APP_AUTH_DSM_FAILED')

      assertRevert(
        lido.deposit(maxDepositsCount, curated.id, '0x', { from: depositSecurityModule.address }),
        "ed with custom error 'ErrorZeroMaxSigningKeysCount()"
      )
    })

    it('Lido.deposit() :: check deposit with keys', async () => {
      // balance are 0
      assertBn(await web3.eth.getBalance(lido.address), 0)
      assertBn(await web3.eth.getBalance(stakingRouter.address), 0)

      const sendEthForKeys = ETH(101 * 32)
      const maxDepositsCount = 100

      await web3.eth.sendTransaction({ value: sendEthForKeys, to: lido.address, from: stranger1 })
      assertBn(await lido.getBufferedEther(), sendEthForKeys)

      // updated balance are lido 100 && sr 0
      assertBn(await web3.eth.getBalance(lido.address), sendEthForKeys)
      assertBn(await web3.eth.getBalance(stakingRouter.address), 0)

      const [curated, _] = await stakingRouter.getStakingModules()

      // prepare node operators
      await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
      await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

      await operators.setNodeOperatorStakingLimit(0, 100000, { from: voting })
      await operators.setNodeOperatorStakingLimit(1, 100000, { from: voting })

      // add 150 keys to module
      const keysAmount = 50
      const keys1 = genKeys(keysAmount)
      await operators.addSigningKeys(0, keysAmount, keys1.pubkeys, keys1.sigkeys, { from: voting })
      await operators.addSigningKeys(0, keysAmount, keys1.pubkeys, keys1.sigkeys, { from: voting })
      await operators.addSigningKeys(0, keysAmount, keys1.pubkeys, keys1.sigkeys, { from: voting })

      await lido.deposit(maxDepositsCount, curated.id, '0x', { from: depositSecurityModule.address })

      assertBn(await lido.getBufferedEther(), ETH(32), 'invalid lido buffer')
      assertBn(await web3.eth.getBalance(lido.address), ETH(32), 'invalid lido balance')

      assertBn(await lido.getStakingRouterBufferedEther(), 0, 'invalid staking_router buffer')
      assertBn(await web3.eth.getBalance(stakingRouter.address), 0, 'invalid staking_router balance')
    })
  })
})

function genKeys(cnt = 1) {
  let pubkeys = ''
  let sigkeys = ''

  for (let i = 1; i <= cnt; i++) {
    pubkeys = hexConcat(pubkeys, `0x`.padEnd(98, i.toString(16))) // 48 bytes * 2 chars + 2 chars (0x)
    sigkeys = hexConcat(sigkeys, `0x`.padEnd(194, i.toString(16))) // 96 bytes * 2 chars + 2 chars (0x)
  }

  return { pubkeys, sigkeys }
}

const hexConcat = (first, ...rest) => {
  let result = first.startsWith('0x') ? first : '0x' + first
  rest.forEach((item) => {
    result += item.startsWith('0x') ? item.substr(2) : item
  })
  return result
}
