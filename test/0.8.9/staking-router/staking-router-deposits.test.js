const { contract, ethers, web3 } = require('hardhat')

const { EvmSnapshot } = require('../../helpers/blockchain')
const { setupNodeOperatorsRegistry } = require('../../helpers/staking-modules')
const { deployProtocol } = require('../../helpers/protocol')

const { ETH, genKeys } = require('../../helpers/utils')
const { assert } = require('../../helpers/assert')
const { ZERO_BYTES32 } = require('../../helpers/constants')

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'

contract('StakingRouter', ([depositor, stranger]) => {
  const evmSnapshot = new EvmSnapshot(ethers.provider)
  let depositContract, router
  let lido, operators, voting
  let curatedModuleId

  const snapshot = () => evmSnapshot.make()
  const revert = () => evmSnapshot.revert()

  before(async () => {
    const deployed = await deployProtocol({
      depositSecurityModuleFactory: async () => {
        return { address: depositor }
      },
    })

    lido = deployed.pool
    router = deployed.stakingRouter
    operators = await setupNodeOperatorsRegistry(deployed, true)
    voting = deployed.voting.address
    depositContract = deployed.depositContract

    // add role
    await router.grantRole(await router.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(), depositor, { from: depositor })
  })

  describe('Make deposit', () => {
    before(snapshot)
    after(revert)

    it('add module', async () => {
      await router.addStakingModule(
        'Curated',
        operators.address,
        10_000, // 100 % _targetShare
        1_000, // 10 % _moduleFee
        5_000, // 50 % _treasuryFee
        { from: voting }
      )
      curatedModuleId = +(await router.getStakingModuleIds())[0]
    })

    it('reverts if no DSM role', async () => {
      const depositsCount = 150

      await assert.reverts(
        lido.deposit(depositsCount, curatedModuleId, '0x', { from: stranger }),
        'APP_AUTH_DSM_FAILED'
      )
      await assert.reverts(lido.deposit(depositsCount, curatedModuleId, '0x', { from: voting }), 'APP_AUTH_DSM_FAILED')
    })

    it('reverts if deposit() not from lido address', async () => {
      const depositsCount = 150
      await assert.reverts(
        router.deposit(depositsCount, curatedModuleId, '0x', { from: voting }),
        'AppAuthLidoFailed()'
      )
    })

    it('add initial balance and keys', async () => {
      // balance are initial
      assert.equals(await web3.eth.getBalance(lido.address), ETH(1))
      assert.equals(await web3.eth.getBalance(router.address), 0)

      const sendEthForKeys = ETH(101 * 32 - 1)
      const totalPooledEther = ETH(101 * 32)

      await web3.eth.sendTransaction({ value: sendEthForKeys, to: lido.address, from: stranger })
      assert.equals(await lido.getBufferedEther(), totalPooledEther)

      // updated balance are lido 100 && sr 0
      assert.equals(await web3.eth.getBalance(lido.address), totalPooledEther)
      assert.equals(await web3.eth.getBalance(router.address), 0)

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
    })

    it('can not deposit with unset withdrawalCredentials', async () => {
      // old WC
      const wcBefore = await router.getWithdrawalCredentials()

      // unset WC
      const newWC = '0x'
      const tx = await router.setWithdrawalCredentials(newWC, { from: voting })
      await assert.emits(tx, 'WithdrawalCredentialsSet', { withdrawalCredentials: ZERO_BYTES32 })
      assert.equal(await router.getWithdrawalCredentials(), ZERO_BYTES32)

      // add 150 keys to module
      const keysAmount = 1
      const keys1 = genKeys(keysAmount)
      await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
      await operators.addSigningKeys(0, keysAmount, keys1.pubkeys, keys1.sigkeys, { from: voting })
      await operators.setNodeOperatorStakingLimit(0, 100000, { from: voting })

      const depositsCount = 100
      await assert.reverts(
        lido.deposit(depositsCount, curatedModuleId, '0x', { from: depositor }),
        `EmptyWithdrawalsCredentials()`
      )

      const tx2 = await router.setWithdrawalCredentials(wcBefore, { from: voting })
      const wcAfter = await router.getWithdrawalCredentials()
      await assert.emits(tx2, 'WithdrawalCredentialsSet', { withdrawalCredentials: wcBefore })
      assert.equal(await router.getWithdrawalCredentials(), wcBefore)
      assert.equal(wcBefore, wcAfter)
    })

    it('Lido.deposit() :: check deposit with keys', async () => {
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

      const depositsCount = 100

      const receipt = await lido.deposit(depositsCount, curatedModuleId, '0x', {
        from: depositor,
      })
      const currentBlockNumber = await web3.eth.getBlockNumber()

      assert.equals(await depositContract.totalCalls(), 100, 'invalid deposits count')

      // on deposit we return balance to Lido
      assert.equals(await web3.eth.getBalance(lido.address), ETH(32), 'invalid lido balance')
      assert.equals(await web3.eth.getBalance(router.address), 0, 'invalid staking_router balance')

      assert.equals(await lido.getBufferedEther(), ETH(32), 'invalid total buffer')

      assert.emits(receipt, 'Unbuffered', { amount: ETH(depositsCount * 32) })

      const lastModuleBlock = await router.getStakingModuleLastDepositBlock(curatedModuleId)
      assert.equal(currentBlockNumber, +lastModuleBlock)
    })
  })

  describe('test deposit from staking router directly', async () => {
    before(snapshot)
    after(revert)

    it('add module', async () => {
      await router.addStakingModule(
        'Curated',
        operators.address,
        10_000, // 100 % _targetShare
        1_000, // 10 % _moduleFee
        5_000, // 50 % _treasuryFee
        { from: voting }
      )
      curatedModuleId = +(await router.getStakingModuleIds())[0]
    })

    it('prepare node operators', async () => {
      // balance are initial
      assert.equals(await web3.eth.getBalance(lido.address), ETH(1))
      assert.equals(await web3.eth.getBalance(router.address), 0)

      const sendEthForKeys = ETH(101 * 32 - 1)
      const totalPooledEther = ETH(101 * 32)

      await web3.eth.sendTransaction({ value: sendEthForKeys, to: lido.address, from: stranger })
      assert.equals(await lido.getBufferedEther(), totalPooledEther)

      // updated balance are lido 100 && sr 0
      assert.equals(await web3.eth.getBalance(lido.address), totalPooledEther)
      assert.equals(await web3.eth.getBalance(router.address), 0)

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
    })

    it('zero deposits just updates module lastDepositBlock', async () => {
      const depositsCount = 0
      // allow tx `StakingRouter.deposit()` from the Lido contract addr
      await ethers.provider.send('hardhat_impersonateAccount', [lido.address])
      const value = ETH(0)
      const receipt = await router.deposit(depositsCount, curatedModuleId, '0x', { from: lido.address, value })

      assert.emits(receipt, 'StakingRouterETHDeposited', { stakingModuleId: curatedModuleId, amount: value })

      const lastModuleBlock = await router.getStakingModuleLastDepositBlock(curatedModuleId)
      const currentBlockNumber = await web3.eth.getBlockNumber()
      assert.equal(currentBlockNumber, +lastModuleBlock)
    })

    it('deposits not work if depositValue != depositsCount * 32 ', async () => {
      const depositsCount = 100

      // allow tx `StakingRouter.deposit()` from the Lido contract addr
      await ethers.provider.send('hardhat_impersonateAccount', [lido.address])

      const value = ETH(1)
      await assert.reverts(
        router.deposit(depositsCount, curatedModuleId, '0x', { from: lido.address, value }),
        `InvalidDepositsValue(${value}, ${depositsCount})`
      )
    })
  })
})
