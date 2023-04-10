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
let module1Id, module3Id, module4Id
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
        vettedSigningKeysCount: 7,
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

    it("getStakingRewardsDistribution() - doesn't reverts if total fee = 100%", async () => {
      const { totalFee } = await router.getStakingRewardsDistribution()
      await assert.equals(totalFee, await router.FEE_PRECISION_POINTS())
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

      // share = active 2 / totalActive = 2 == 1
      // moduleFee = share * moduleFee = 1 * 5 = 5 * 10^18

      assert.deepEqual(distribution.recipients, [operators.address])
      assert.deepEqual(toNum(distribution.stakingModuleIds), [1])
      assert.deepEqual(toNum(distribution.stakingModuleFees), [5 * 10 ** 18])
      assert.equal(toNum(distribution.totalFee), 10 * 10 ** 18)
    })

    it('add 3 modules', async () => {
      // add module withoud node operators
      await router.addStakingModule(
        'Solo1',
        solo1.address,
        3000, // 30 % _targetShare
        500, // 50 % _moduleFee
        500, // 50 % _treasuryFee
        { from: admin }
      )

      // add solo2 with node operators
      await router.addStakingModule(
        'Solo2',
        solo2.address,
        2000, // 20 % _targetShare
        500, // 40 % _moduleFee
        500, // 40 % _treasuryFee
        { from: admin }
      )
      module3Id = +(await router.getStakingModuleIds())[2]

      config = {
        name: 'Solo2',
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
      ///

      // add solo3 with node operators, but stop this module
      await router.addStakingModule(
        'Solo3',
        solo3.address,
        2000, // 20 % _targetShare
        700, // 40 % _moduleFee
        300, // 40 % _treasuryFee
        { from: admin }
      )
      module4Id = +(await router.getStakingModuleIds())[3]

      config = {
        name: 'Solo3',
        rewardAddress: ADDRESS_3,
        totalSigningKeysCount: 13,
        vettedSigningKeysCount: 12,
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
      assert.equal(lengthShouldBe, 3)
      assert.equal(distribution.recipients.length, lengthShouldBe)
      assert.equal(distribution.stakingModuleIds.length, lengthShouldBe)
      assert.equal(distribution.stakingModuleFees.length, lengthShouldBe)

      // totalActiveVal = 2 + 6 + 2 + 0 = 10
      //
      // share1 = 2/10 = 0.2, fee1 = share1 * moduleFee1 = 0.2 * 0.05 = 0.01
      // share2 = 6/10 = 0.6, fee2 = share2 * moduleFee2 = 0.6 * 0.05 = 0.03
      // share3 = 0, fee3 = 0
      // share4 = 0, fee4 = 0 //module not active
      // moduleFee = share * moduleFee = 1 * 5 = 5 * 10^18

      assert.deepEqual(distribution.recipients, [operators.address, solo2.address, solo3.address])
      assert.deepEqual(toNum(distribution.stakingModuleIds), [module1Id, module3Id, module4Id])
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
        vettedSigningKeysCount: 8,
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
    })

    it('works 2 active modules', async () => {
      const distribution = await router.getStakingFeeAggregateDistribution()

      assert.equal(+distribution.modulesFee, 5 * 10 ** 18)
      assert.equal(+distribution.treasuryFee, 5 * 10 ** 18)
      assert.equal(+distribution.basePrecision, new BN(10).pow(new BN(20)))
    })

    it('add next module', async () => {
      // add solo2 with node operators
      await router.addStakingModule(
        'Solo2',
        solo2.address,
        2000, // 20 % _targetShare
        500, // 40 % _moduleFee
        500, // 40 % _treasuryFee
        { from: admin }
      )
      module3Id = +(await router.getStakingModuleIds())[2]

      config = {
        name: 'Solo2',
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
      ///

      // add solo3 with node operators, but stop this module
      await router.addStakingModule(
        'Solo3',
        solo3.address,
        2000, // 20 % _targetShare
        700, // 40 % _moduleFee
        300, // 40 % _treasuryFee
        { from: admin }
      )
      module4Id = +(await router.getStakingModuleIds())[3]

      config = {
        name: 'Solo3',
        rewardAddress: ADDRESS_3,
        totalSigningKeysCount: 13,
        vettedSigningKeysCount: 13,
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
      assert.equal(lengthShouldBe, 3)
      assert.equal(distribution.recipients.length, lengthShouldBe)
      assert.equal(distribution.stakingModuleIds.length, lengthShouldBe)
      assert.equal(distribution.stakingModuleFees.length, lengthShouldBe)

      // m1 - 2 active, 5%
      // m2 - 0 active, 5%
      // m3 - 6 active, 5%
      // m4 - 2 active, 7% stopped

      assert.deepEqual(distribution.recipients, [operators.address, solo2.address, solo3.address])
      assert.deepEqual(toNum(distribution.stakingModuleIds), [module1Id, module3Id, module4Id])
      assert.deepEqual(toNum(distribution.stakingModuleFees), [1 * 10 ** 18, 3 * 10 ** 18, 0])
      assert.equal(toNum(distribution.totalFee), 10 * 10 ** 18)

      distribution = await router.getStakingFeeAggregateDistribution()
      assert.equal(+distribution.modulesFee, (1 + 3) * 10 ** 18)
      assert.equal(+distribution.treasuryFee, 6 * 10 ** 18)
      assert.equal(+distribution.basePrecision, new BN(10).pow(new BN(20)))
    })

    it('getTotalFeeE4Precision', async () => {
      const totalFeeE4 = await router.getTotalFeeE4Precision()
      const fee = await router.getStakingFeeAggregateDistributionE4Precision()
      assert.equal(+totalFeeE4, +fee.modulesFee + +fee.treasuryFee)
    })
  })
})
