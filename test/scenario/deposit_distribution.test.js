const { contract, ethers, web3 } = require('hardhat')
const { assert } = require('../helpers/assert')

const { ETH, genKeys } = require('../helpers/utils')
const { EvmSnapshot } = require('../helpers/blockchain')
const { deployProtocol } = require('../helpers/protocol')
const { setupNodeOperatorsRegistry } = require('../helpers/staking-modules')

contract('StakingRouter', ([depositor, stranger1, address1, address2]) => {
  const snapshot = new EvmSnapshot(ethers.provider)
  let depositContract, stakingRouter
  let lido, curated, anotherCurated, voting

  before(async () => {
    const deployed = await deployProtocol({
      stakingModulesFactory: async (protocol) => {
        const curatedModule = await setupNodeOperatorsRegistry(protocol)
        const anotherCuratedModule = await setupNodeOperatorsRegistry(protocol)
        return [
          {
            module: curatedModule,
            name: 'curated',
            targetShares: 10000,
            moduleFee: 1000,
            treasuryFee: 5000,
          },
          {
            module: anotherCuratedModule,
            name: 'another curated',
            targetShares: 10000,
            moduleFee: 1000,
            treasuryFee: 5000,
          },
        ]
      },
      depositSecurityModuleFactory: async () => {
        return { address: depositor }
      },
    })

    depositContract = deployed.depositContract
    stakingRouter = deployed.stakingRouter
    curated = deployed.stakingModules[0]
    anotherCurated = deployed.stakingModules[1]
    lido = deployed.pool
    voting = deployed.voting.address

    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.revert()
  })

  describe('deposit', async () => {
    it('check two modules splitted deposit', async () => {
      const sendEthForKeys = ETH(200 * 32)
      const maxDepositsCount = 100

      const keysAmount = maxDepositsCount
      const keys1 = genKeys(keysAmount)

      await curated.addNodeOperator('1', address1, { from: voting })
      await anotherCurated.addNodeOperator('1', address2, { from: voting })

      await curated.addSigningKeys(0, keysAmount, keys1.pubkeys, keys1.sigkeys, { from: voting })
      await anotherCurated.addSigningKeys(0, keysAmount, keys1.pubkeys, keys1.sigkeys, { from: voting })

      await curated.setNodeOperatorStakingLimit(0, 100000, { from: voting, gasPrice: 10 })
      await anotherCurated.setNodeOperatorStakingLimit(0, 100000, { from: voting, gasPrice: 10 })

      // balance are initial
      assert.equals(await web3.eth.getBalance(lido.address), ETH(1))
      assert.equals(await web3.eth.getBalance(stakingRouter.address), 0)

      await web3.eth.sendTransaction({ value: sendEthForKeys, to: lido.address, from: stranger1 })
      assert.equals(await lido.getBufferedEther(), ETH(200 * 32 + 1))

      const keysAllocation = await stakingRouter.getDepositsAllocation(200)

      assert.equals(keysAllocation.allocated, 200)
      assert.equals(keysAllocation.allocations, [100, 100])

      const [curatedModule] = await stakingRouter.getStakingModules()

      await lido.deposit(maxDepositsCount, curatedModule.id, '0x', { from: depositor, gasPrice: 10 })

      assert.equals(await depositContract.totalCalls(), 100, 'invalid deposits count')

      // on deposit we return balance to Lido
      assert.equals(await web3.eth.getBalance(lido.address), ETH(100 * 32 + 1), 'invalid lido balance')
      assert.equals(await web3.eth.getBalance(stakingRouter.address), 0, 'invalid staking_router balance')

      assert.equals(await lido.getBufferedEther(), ETH(100 * 32 + 1), 'invalid total buffer')
    })
  })
})
