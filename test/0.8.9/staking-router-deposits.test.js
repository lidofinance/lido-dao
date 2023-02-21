const hre = require('hardhat')
const { assertEvent } = require('@aragon/contract-helpers-test/src/asserts')

const { EvmSnapshot } = require('../helpers/blockchain')
const { setupNodeOperatorsRegistry } = require('../helpers/staking-modules')
const { deployProtocol } = require('../helpers/protocol')

const { ETH, genKeys, toBN } = require('../helpers/utils')
const { assert } = require('../helpers/assert')

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'

contract('StakingRouter', ([depositor, stranger]) => {
  let snapshot
  let depositContract, stakingRouter
  let lido, operators, voting

  before(async () => {
    const deployed = await deployProtocol({
      depositSecurityModuleFactory: async () => {
        return { address: depositor }
      },
    })

    lido = deployed.pool
    stakingRouter = deployed.stakingRouter
    operators = await setupNodeOperatorsRegistry(deployed, true)
    voting = deployed.voting.address
    depositContract = deployed.depositContract
    snapshot = new EvmSnapshot(hre.ethers.provider)
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  describe('Make deposit', () => {
    beforeEach(async () => {
      await stakingRouter.addStakingModule(
        'Curated',
        operators.address,
        10_000, // 100 % _targetShare
        1_000, // 10 % _moduleFee
        5_000, // 50 % _treasuryFee
        { from: voting }
      )
    })

    it('Lido.deposit() :: check permissioness', async () => {
      const maxDepositsCount = 150

      await web3.eth.sendTransaction({ value: ETH(maxDepositsCount * 32), to: lido.address, from: stranger })
      assert.equals(await lido.getBufferedEther(), ETH(maxDepositsCount * 32 + 1))

      const [curated] = await stakingRouter.getStakingModules()

      await assert.reverts(lido.deposit(maxDepositsCount, curated.id, '0x', { from: stranger }), 'APP_AUTH_DSM_FAILED')
      await assert.reverts(lido.deposit(maxDepositsCount, curated.id, '0x', { from: voting }), 'APP_AUTH_DSM_FAILED')

      await assert.revertsWithCustomError(
        stakingRouter.deposit(maxDepositsCount, curated.id, '0x', { from: voting }),
        'AppAuthLidoFailed()'
      )
    })

    it('Lido.deposit() :: check deposit with keys', async () => {
      // balance are initial
      assert.equals(await web3.eth.getBalance(lido.address), ETH(1))
      assert.equals(await web3.eth.getBalance(stakingRouter.address), 0)

      const sendEthForKeys = ETH(101 * 32 - 1)
      const totalPooledEther = ETH(101 * 32)
      const maxDepositsCount = 100

      await web3.eth.sendTransaction({ value: sendEthForKeys, to: lido.address, from: stranger })
      assert.equals(await lido.getBufferedEther(), totalPooledEther)

      // updated balance are lido 100 && sr 0
      assert.equals(await web3.eth.getBalance(lido.address), totalPooledEther)
      assert.equals(await web3.eth.getBalance(stakingRouter.address), 0)

      const [curated] = await stakingRouter.getStakingModules()

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

      const receipt = await lido.methods[`deposit(uint256,uint256,bytes)`](maxDepositsCount, curated.id, '0x', {
        from: depositor,
      })

      assert.equals(await depositContract.totalCalls(), 100, 'invalid deposits count')

      // on deposit we return balance to Lido
      assert.equals(await web3.eth.getBalance(lido.address), ETH(32), 'invalid lido balance')
      assert.equals(await web3.eth.getBalance(stakingRouter.address), 0, 'invalid staking_router balance')

      assert.equals(await lido.getBufferedEther(), ETH(32), 'invalid total buffer')

      assertEvent(receipt, 'Unbuffered', { expectedArgs: { amount: ETH(maxDepositsCount * 32) } })
    })

    it('Lido.deposit() :: revert if stakingModuleId more than uint24', async () => {
      const maxDepositsCount = 100
      const maxModuleId = toBN(2).pow(toBN(24))

      await assert.reverts(
        lido.methods[`deposit(uint256,uint256,bytes)`](maxDepositsCount, maxModuleId, '0x', { from: depositor }),
        'StakingModuleIdTooLarge()'
      )
    })
  })
})
