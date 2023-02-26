const { contract, ethers } = require('hardhat')
const { BN } = require('bn.js')

const { assert } = require('../../helpers/assert')
const { EvmSnapshot } = require('../../helpers/blockchain')
const { toNum } = require('../../helpers/utils')
const { deployProtocol } = require('../../helpers/protocol')

const { setupNodeOperatorsRegistry } = require('../../helpers/staking-modules')

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'
const ADDRESS_3 = '0x0000000000000000000000000000000000000003'

const StakingModuleStatus = {
  Active: 0, // deposits and rewards allowed
  DepositsPaused: 1, // deposits NOT allowed, rewards allowed
  Stopped: 2, // deposits and rewards NOT allowed
}

let router
let operators, solo1, solo2, solo3
let module1Id, module2Id, module3Id, module4Id
let config

contract('StakingRouter', ([deployer, admin, depositor, stranger]) => {
  const evmSnapshot = new EvmSnapshot(ethers.provider)

  const snapshot = () => evmSnapshot.make()
  const revert = () => evmSnapshot.revert()

  before(async () => {
    const deployed = await deployProtocol({
      depositSecurityModuleFactory: async () => {
        return { address: depositor }
      },
    })

    router = deployed.stakingRouter
    operators = await setupNodeOperatorsRegistry(deployed, true)
    solo1 = await setupNodeOperatorsRegistry(deployed, true)
    solo2 = await setupNodeOperatorsRegistry(deployed, true)
    solo3 = await setupNodeOperatorsRegistry(deployed, true)
  })

  describe('getNodeOperatorDigests() by module id and list of nopIds', async () => {
    before(snapshot)
    after(revert)

    it('getStakingRewardsDistribution() - without modules', async () => {
      const distribution = await router.getStakingRewardsDistribution()

      const lengthShouldBe = distribution.stakingModuleFees.length
      assert.equal(distribution.recipients.length, lengthShouldBe)
      assert.equal(distribution.stakingModuleIds.length, lengthShouldBe)
      assert.equal(distribution.stakingModuleFees.length, lengthShouldBe)

      assert.equal(distribution.totalFee, 0)
      assert.equal(+distribution.precisionPoints, new BN(10).pow(new BN(20))) // 100 * 10^18
    })

    it('add one module', async () => {
      await router.addStakingModule(
        'Curated',
        operators.address,
        10_000, // 100 % _targetShare
        5000, // 50 % _moduleFee
        5000, // 50 % _treasuryFee
        { from: admin }
      )
      module1Id = +(await router.getStakingModuleIds())[0]
    })

    it('getStakingRewardsDistribution() - one module - no validators', async () => {
      const distribution = await router.getStakingRewardsDistribution()

      const lengthShouldBe = distribution.stakingModuleFees.length
      assert.equal(distribution.recipients.length, lengthShouldBe)
      assert.equal(distribution.stakingModuleIds.length, lengthShouldBe)
      assert.equal(distribution.stakingModuleFees.length, lengthShouldBe)

      assert.equal(distribution.totalFee, 0)
      assert.equal(+distribution.precisionPoints, new BN(10).pow(new BN(20))) // 100 * 10^18
    })

    it('prepare node operators', async () => {
      const config = {
        name: 'test',
        rewardAddress: ADDRESS_1,
        totalSigningKeysCount: 13,
        vettedSigningKeysCount: 4,
        depositedSigningKeysCount: 7,
        exitedSigningKeysCount: 5,
      }

      await operators.testing_addNodeOperator(
        config.name,
        config.rewardAddress,
        config.totalSigningKeysCount,
        config.vettedSigningKeysCount,
        config.depositedSigningKeysCount,
        config.exitedSigningKeysCount
      )
    })

    it('getStakingRewardsDistribution() - reverts if total fee >= 100%', async () => {
      await assert.reverts(router.getStakingRewardsDistribution(), 'ValueOver100Percent("totalFee")')
    })

    it('update module - set fee and treasury fee', async () => {
      await router.updateStakingModule(module1Id, 10_000, 500, 500, { from: admin })
    })

    it('getStakingRewardsDistribution() - works for one module', async () => {
      const distribution = await router.getStakingRewardsDistribution()

      const lengthShouldBe = distribution.stakingModuleFees.length
      assert.equal(distribution.recipients.length, lengthShouldBe)
      assert.equal(distribution.stakingModuleIds.length, lengthShouldBe)
      assert.equal(distribution.stakingModuleFees.length, lengthShouldBe)

      assert.deepEqual(distribution.recipients, [operators.address])
      assert.deepEqual(toNum(distribution.stakingModuleIds), [1])
      assert.deepEqual(toNum(distribution.stakingModuleFees), [5 * 10 ** 18])
      assert.equal(toNum(distribution.totalFee), 10 * 10 ** 18)
    })

    it('add 2 modules', async () => {
      await router.addStakingModule(
        'Solo1',
        solo1.address,
        3000, // 30 % _targetShare
        500, // 50 % _moduleFee
        500, // 50 % _treasuryFee
        { from: admin }
      )
      module2Id = +(await router.getStakingModuleIds())[1]

      await router.addStakingModule(
        'Solo2',
        solo2.address,
        2000, // 20 % _targetShare
        500, // 40 % _moduleFee
        500, // 40 % _treasuryFee
        { from: admin }
      )
      module3Id = +(await router.getStakingModuleIds())[2]

      await router.addStakingModule(
        'Solo3',
        solo3.address,
        2000, // 20 % _targetShare
        700, // 40 % _moduleFee
        300, // 40 % _treasuryFee
        { from: admin }
      )
      module4Id = +(await router.getStakingModuleIds())[3]
    })

    it('prepare node operators for 3d module', async () => {
      config = {
        name: 'test3',
        rewardAddress: ADDRESS_2,
        totalSigningKeysCount: 10,
        vettedSigningKeysCount: 10,
        depositedSigningKeysCount: 7,
        exitedSigningKeysCount: 1,
      }

      await solo2.testing_addNodeOperator(
        config.name,
        config.rewardAddress,
        config.totalSigningKeysCount,
        config.vettedSigningKeysCount,
        config.depositedSigningKeysCount,
        config.exitedSigningKeysCount
      )

      config = {
        name: 'test4',
        rewardAddress: ADDRESS_3,
        totalSigningKeysCount: 13,
        vettedSigningKeysCount: 4,
        depositedSigningKeysCount: 7,
        exitedSigningKeysCount: 5,
      }

      await solo3.testing_addNodeOperator(
        config.name,
        config.rewardAddress,
        config.totalSigningKeysCount,
        config.vettedSigningKeysCount,
        config.depositedSigningKeysCount,
        config.exitedSigningKeysCount
      )
    })

    it('getStakingRewardsDistribution() - skip one module without active validators', async () => {
      await router.setStakingModuleStatus(module4Id, StakingModuleStatus.Stopped, { from: admin })

      const distribution = await router.getStakingRewardsDistribution()

      const lengthShouldBe = distribution.stakingModuleFees.length
      assert.equal(distribution.recipients.length, lengthShouldBe)
      assert.equal(distribution.stakingModuleIds.length, lengthShouldBe)
      assert.equal(distribution.stakingModuleFees.length, lengthShouldBe)

      assert.deepEqual(distribution.recipients, [operators.address, solo2.address, solo3.address])
      assert.deepEqual(toNum(distribution.stakingModuleIds), [module1Id, module2Id, module3Id])
      assert.deepEqual(toNum(distribution.stakingModuleFees), [1 * 10 ** 18, 3 * 10 ** 18, 0])
      assert.equal(toNum(distribution.totalFee), 10 * 10 ** 18)
    })
  })

  describe('getStakingFeeAggregateDistribution()', async () => {
    before(snapshot)
    after(revert)

    it('works with empty modules', async () => {
      const distribution = await router.getStakingFeeAggregateDistribution()

      assert.equal(+distribution.modulesFee, 0)
      assert.equal(+distribution.treasuryFee, 0)
      assert.equal(+distribution.basePrecision, new BN(10).pow(new BN(20)))
    })

    it('add one module', async () => {
      await router.addStakingModule(
        'Curated',
        operators.address,
        10_000, // 100 % _targetShare
        500, // 50 % _moduleFee
        500, // 50 % _treasuryFee
        { from: admin }
      )
      module1Id = +(await router.getStakingModuleIds())[0]
    })

    it('prepare node operators', async () => {
      const config = {
        name: 'test',
        rewardAddress: ADDRESS_1,
        totalSigningKeysCount: 13,
        vettedSigningKeysCount: 4,
        depositedSigningKeysCount: 7,
        exitedSigningKeysCount: 5,
      }

      await operators.testing_addNodeOperator(
        config.name,
        config.rewardAddress,
        config.totalSigningKeysCount,
        config.vettedSigningKeysCount,
        config.depositedSigningKeysCount,
        config.exitedSigningKeysCount
      )
    })

    it('works with empty modules', async () => {
      const distribution = await router.getStakingFeeAggregateDistribution()

      assert.equal(+distribution.modulesFee, 5 * 10 ** 18)
      assert.equal(+distribution.treasuryFee, 5 * 10 ** 18)
      assert.equal(+distribution.basePrecision, new BN(10).pow(new BN(20)))
    })

    it('add next module', async () => {
      await router.addStakingModule(
        'Solo1',
        solo1.address,
        10_000, // 100 % _targetShare
        500, // 50 % _moduleFee
        500, // 50 % _treasuryFee
        { from: admin }
      )
      module2Id = +(await router.getStakingModuleIds())[1]

      const config = {
        name: 'test',
        rewardAddress: ADDRESS_1,
        totalSigningKeysCount: 13,
        vettedSigningKeysCount: 4,
        depositedSigningKeysCount: 7,
        exitedSigningKeysCount: 5,
      }

      await operators.testing_addNodeOperator(
        config.name,
        config.rewardAddress,
        config.totalSigningKeysCount,
        config.vettedSigningKeysCount,
        config.depositedSigningKeysCount,
        config.exitedSigningKeysCount
      )
    })

    it('works 2 active modules', async () => {
      const distribution = await router.getStakingFeeAggregateDistribution()

      assert.equal(+distribution.modulesFee, 5 * 10 ** 18)
      assert.equal(+distribution.treasuryFee, 5 * 10 ** 18)
      assert.equal(+distribution.basePrecision, new BN(10).pow(new BN(20)))
    })

    it('add next module', async () => {
      await router.addStakingModule(
        'Solo2',
        solo2.address,
        2000, // 20 % _targetShare
        500, // 40 % _moduleFee
        500, // 40 % _treasuryFee
        { from: admin }
      )
      module3Id = +(await router.getStakingModuleIds())[2]

      await router.addStakingModule(
        'Solo3',
        solo3.address,
        2000, // 20 % _targetShare
        500, // 40 % _moduleFee
        500, // 40 % _treasuryFee
        { from: admin }
      )
      module4Id = +(await router.getStakingModuleIds())[3]
    })

    it('prepare node operators for 3d module', async () => {
      config = {
        name: 'test3',
        rewardAddress: ADDRESS_3,
        totalSigningKeysCount: 10,
        vettedSigningKeysCount: 10,
        depositedSigningKeysCount: 7,
        exitedSigningKeysCount: 5,
      }

      await solo2.testing_addNodeOperator(
        config.name,
        config.rewardAddress,
        config.totalSigningKeysCount,
        config.vettedSigningKeysCount,
        config.depositedSigningKeysCount,
        config.exitedSigningKeysCount
      )

      config = {
        name: 'test4',
        rewardAddress: ADDRESS_3,
        totalSigningKeysCount: 13,
        vettedSigningKeysCount: 4,
        depositedSigningKeysCount: 7,
        exitedSigningKeysCount: 5,
      }

      await solo3.testing_addNodeOperator(
        config.name,
        config.rewardAddress,
        config.totalSigningKeysCount,
        config.vettedSigningKeysCount,
        config.depositedSigningKeysCount,
        config.exitedSigningKeysCount
      )
    })

    it('works 2 active modules and 1 stopped and 1 without active validators', async () => {
      await router.setStakingModuleStatus(module4Id, StakingModuleStatus.Stopped, { from: admin })
      let distribution = await router.getStakingRewardsDistribution()

      const lengthShouldBe = distribution.stakingModuleFees.length
      assert.equal(distribution.recipients.length, lengthShouldBe)
      assert.equal(distribution.stakingModuleIds.length, lengthShouldBe)
      assert.equal(distribution.stakingModuleFees.length, lengthShouldBe)

      assert.deepEqual(distribution.recipients, [operators.address, solo2.address, solo3.address])
      assert.deepEqual(toNum(distribution.stakingModuleIds), [module1Id, module2Id, module3Id])
      assert.deepEqual(toNum(distribution.stakingModuleFees), [2.5 * 10 ** 18, 1.25 * 10 ** 18, 0])
      assert.equal(toNum(distribution.totalFee), 10 * 10 ** 18)

      distribution = await router.getStakingFeeAggregateDistribution()
      assert.equal(+distribution.modulesFee, 3.75 * 10 ** 18)
      assert.equal(+distribution.treasuryFee, 6.25 * 10 ** 18)
      assert.equal(+distribution.basePrecision, new BN(10).pow(new BN(20)))
    })

    it('getTotalFeeE4Precision', async () => {
      const totalFeeE4 = await router.getTotalFeeE4Precision()
      const fee = await router.getStakingFeeAggregateDistributionE4Precision()
      assert.equal(+totalFeeE4, +fee.modulesFee + +fee.treasuryFee)
    })
  })
})
