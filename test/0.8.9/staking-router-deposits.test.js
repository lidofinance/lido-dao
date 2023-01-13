const hre = require('hardhat')
const { assertBn, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { assertRevert } = require('../helpers/assertThrow')
const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const { newDao, newApp } = require('../0.4.24/helpers/dao')
const { ETH, genKeys } = require('../helpers/utils')

const LidoMock = artifacts.require('LidoMock.sol')
const LidoOracleMock = artifacts.require('OracleMock.sol')
const NodeOperatorsRegistryMock = artifacts.require('NodeOperatorsRegistryMock')
const StakingRouter = artifacts.require('StakingRouterMock.sol')
const StakingModuleMock = artifacts.require('StakingModuleMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')
const DepositSecurityModule = artifacts.require('DepositSecurityModule.sol')
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
  let dao, acl, lido, oracle, operators
  let depositSecurityModule, stakingRouterMock
  const [deployer, voting, admin, treasury, stranger1] = accounts

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
    depositSecurityModule = await DepositSecurityModule.new(
      lido.address,
      depositContract.address,
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
    await operators.initialize(lido.address, '0x01')

    // Set up the Lido permissions.
    await acl.createPermission(voting, lido.address, await lido.MANAGE_PROTOCOL_CONTRACTS_ROLE(), deployer, { from: deployer })

    await acl.createPermission(voting, operators.address, await operators.ADD_NODE_OPERATOR_ROLE(), deployer, { from: deployer })
    await acl.createPermission(voting, operators.address, await operators.MANAGE_SIGNING_KEYS(), deployer, { from: deployer })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_LIMIT_ROLE(), deployer, { from: deployer })
    await acl.createPermission(
      stakingRouter.address,
      operators.address,
      await operators.REQUEST_VALIDATORS_KEYS_FOR_DEPOSITS_ROLE(),
      deployer,
      {
        from: deployer
      }
    )
    await acl.createPermission(
      stakingRouter.address,
      operators.address,
      await operators.INVALIDATE_READY_TO_DEPOSIT_KEYS_ROLE(),
      deployer,
      {
        from: deployer
      }
    )

    const wc = '0x'.padEnd(66, '1234')
    await stakingRouter.initialize(admin, lido.address, wc, { from: deployer })

    // Set up the staking router permissions.
    const [MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, MODULE_PAUSE_ROLE, MODULE_MANAGE_ROLE] = await Promise.all([
      stakingRouter.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(),
      stakingRouter.MODULE_PAUSE_ROLE(),
      stakingRouter.MODULE_MANAGE_ROLE()
    ])

    await stakingRouter.grantRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, voting, { from: admin })
    await stakingRouter.grantRole(MODULE_PAUSE_ROLE, voting, { from: admin })
    await stakingRouter.grantRole(MODULE_MANAGE_ROLE, voting, { from: admin })

    await lido.initialize(oracle.address, treasury, stakingRouter.address, depositSecurityModule.address, ZERO_ADDRESS, ZERO_ADDRESS)

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

      // add 150 keys to module
      const keysAmount = 50
      const keys1 = genKeys(keysAmount)
      await operators.addSigningKeys(0, keysAmount, keys1.pubkeys, keys1.sigkeys, { from: voting })
      await operators.addSigningKeys(0, keysAmount, keys1.pubkeys, keys1.sigkeys, { from: voting })
      await operators.addSigningKeys(0, keysAmount, keys1.pubkeys, keys1.sigkeys, { from: voting })

      await operators.setNodeOperatorStakingLimit(0, 100000, { from: voting })
      await operators.setNodeOperatorStakingLimit(1, 100000, { from: voting })

      const receipt = await lido.deposit(maxDepositsCount, curated.id, '0x', { from: depositSecurityModule.address })

      assertBn(await depositContract.totalCalls(), 100, 'invalid deposits count')

      // on deposit we return balance to Lido
      assertBn(await web3.eth.getBalance(lido.address), ETH(32), 'invalid lido balance')
      assertBn(await web3.eth.getBalance(stakingRouter.address), 0, 'invalid staking_router balance')

      assertBn(await lido.getBufferedEther(), ETH(32), 'invalid total buffer')

      assertEvent(receipt, 'Unbuffered', { expectedArgs: { amount: ETH(maxDepositsCount * 32) } })
    })
  })
})
