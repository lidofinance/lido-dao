const { contract, ethers } = require('hardhat')
const { assert } = require('../../helpers/assert')
const { EvmSnapshot } = require('../../helpers/blockchain')
const { hexConcat, hex, ETH, addSendWithResult } = require('../../helpers/utils')
const { deployProtocol } = require('../../helpers/protocol')
const { setupNodeOperatorsRegistry } = require('../../helpers/staking-modules')

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'

let router, voting
let operators, module2
let module1Id, module2Id
let maxDepositsPerModule

contract('StakingRouter', ([admin, depositor]) => {
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
    addSendWithResult(router.updateExitedValidatorsCountByStakingModule)
    voting = deployed.voting.address
    operators = await setupNodeOperatorsRegistry(deployed, true)
    module2 = await setupNodeOperatorsRegistry(deployed, true)

    await router.grantRole(await router.STAKING_MODULE_MANAGE_ROLE(), admin, { from: admin })
    await router.grantRole(await router.REPORT_EXITED_VALIDATORS_ROLE(), admin, { from: admin })

    // get max allocation per module
    maxDepositsPerModule = async () => {
      const modulesIds = await router.getStakingModuleIds()
      const maxDepositsPerModule = []
      for (let i = 0; i < modulesIds.length; i++) {
        const maxCount = +(await router.getStakingModuleMaxDepositsCount(modulesIds[i], ETH(1000000 * 32)))
        maxDepositsPerModule.push(maxCount)
      }
      return maxDepositsPerModule
    }
  })

  describe('Report exited keys by module changes stake allocation', async () => {
    before(async () => {
      // add modules
      await router.addStakingModule(
        'Module 1',
        operators.address,
        10_000, // 100 % _targetShare
        500, // 10 % _moduleFee
        500, // 50 % _treasuryFee
        { from: admin }
      )
      module1Id = +(await router.getStakingModuleIds())[0]

      await router.addStakingModule(
        'Module 2',
        module2.address,
        10_000, // 100 % _targetShare
        500, // 10 % _moduleFee
        500, // 50 % _treasuryFee
        { from: admin }
      )
      module2Id = +(await router.getStakingModuleIds())[1]

      // add operators
      await operators.testing_addNodeOperator(
        'Operator1',
        ADDRESS_1, // config.rewardAddress,
        100, // totalSigningKeysCount,
        60, // vettedSigningKeysCount,
        50, // depositedSigningKeysCount,
        0 // exitedSigningKeysCount
      )
      await operators.testing_addNodeOperator(
        'Operator1',
        ADDRESS_1, // config.rewardAddress,
        100, // totalSigningKeysCount,
        60, // vettedSigningKeysCount,
        50, // depositedSigningKeysCount,
        0 // exitedSigningKeysCount
      )

      await module2.testing_addNodeOperator(
        'Operator1',
        ADDRESS_1, // config.rewardAddress,
        20, // totalSigningKeysCount,
        15, // vettedSigningKeysCount,
        10, // depositedSigningKeysCount,
        0 // exitedSigningKeysCount
      )
    })

    beforeEach(snapshot)
    afterEach(revert)

    it('check initial keys of operators', async () => {
      const moduleSummary1 = await router.getNodeOperatorSummary(module1Id, 0)
      assert.equal(moduleSummary1.isTargetLimitActive, false)
      assert.equal(moduleSummary1.targetValidatorsCount, 0)
      assert.equal(moduleSummary1.stuckValidatorsCount, 0)
      assert.equal(moduleSummary1.refundedValidatorsCount, 0)
      assert.equal(moduleSummary1.stuckPenaltyEndTimestamp, 0)
      assert.equal(moduleSummary1.totalExitedValidators, 0)
      assert.equal(moduleSummary1.totalDepositedValidators, 50)
      assert.equal(moduleSummary1.depositableValidatorsCount, 10)

      const moduleSummary2 = await router.getNodeOperatorSummary(module2Id, 0)
      assert.equal(moduleSummary2.isTargetLimitActive, false)
      assert.equal(moduleSummary2.targetValidatorsCount, 0)
      assert.equal(moduleSummary2.stuckValidatorsCount, 0)
      assert.equal(moduleSummary2.refundedValidatorsCount, 0)
      assert.equal(moduleSummary2.stuckPenaltyEndTimestamp, 0)
      assert.equal(moduleSummary2.totalExitedValidators, 0)
      assert.equal(moduleSummary2.totalDepositedValidators, 10)
      assert.equal(moduleSummary2.depositableValidatorsCount, 5)
    })

    it('report exited keys should change rewards distribution', async () => {
      // check exited validators before
      let moduleSummary1 = await router.getStakingModuleSummary(module1Id)
      assert.equal(moduleSummary1.totalExitedValidators, 0)
      assert.equal(moduleSummary1.totalDepositedValidators, 100)
      assert.equal(moduleSummary1.depositableValidatorsCount, 20)

      let distribution

      const {
        totalDepositedValidators: totalDepositedValidators1Before,
        totalExitedValidators: totalExitedValidators1Before,
      } = await router.getNodeOperatorSummary(module1Id, 0)
      const {
        totalDepositedValidators: totalDepositedValidators2Before,
        totalExitedValidators: totalExitedValidators2Before,
      } = await router.getNodeOperatorSummary(module1Id, 1)

      const totalActiveValidators1Before = totalDepositedValidators1Before - totalExitedValidators1Before
      const totalActiveValidators2Before = totalDepositedValidators2Before - totalExitedValidators2Before
      const totalActiveValidatorsBefore = totalActiveValidators1Before + totalActiveValidators2Before

      const op1shareBefore = totalActiveValidators1Before / totalActiveValidatorsBefore // should be 0.5
      const op2shareBefore = totalActiveValidators2Before / totalActiveValidatorsBefore // should be 0.5

      assert.equal(op1shareBefore, 0.5)
      assert.equal(op2shareBefore, 0.5)

      const sharesDistribute = ETH(1)
      distribution = await operators.getRewardsDistribution(sharesDistribute)
      assert.equal(+distribution.shares[0], op1shareBefore * sharesDistribute)
      assert.equal(+distribution.shares[1], op2shareBefore * sharesDistribute)

      // update exited validators
      const exitValidatorsCount = 20
      const newlyExitedValidatorsCount = await router.updateExitedValidatorsCountByStakingModule.sendWithResult(
        [module1Id],
        [exitValidatorsCount],
        {
          from: admin,
        }
      )
      assert.equals(newlyExitedValidatorsCount, exitValidatorsCount)

      const nodeOpIds = [0]
      const exitedValidatorsCounts = [exitValidatorsCount]

      const nodeOpIdsData = hexConcat(...nodeOpIds.map((i) => hex(i, 8)))
      const keysData = hexConcat(...exitedValidatorsCounts.map((c) => hex(c, 16)))

      // report exited by module and node operator
      await router.reportStakingModuleExitedValidatorsCountByNodeOperator(module1Id, nodeOpIdsData, keysData, {
        from: admin,
      })

      moduleSummary1 = await router.getStakingModuleSummary(module1Id)
      assert.equal(moduleSummary1.totalExitedValidators, exitValidatorsCount)
      assert.equal(moduleSummary1.totalDepositedValidators, 100)
      assert.equal(moduleSummary1.depositableValidatorsCount, 20)

      // get distribution after exited keys
      const {
        totalDepositedValidators: totalDepositedValidators1After,
        totalExitedValidators: totalExitedValidators1After,
      } = await router.getNodeOperatorSummary(module1Id, 0)
      const {
        totalDepositedValidators: totalDepositedValidators2After,
        totalExitedValidators: totalExitedValidators2After,
      } = await router.getNodeOperatorSummary(module1Id, 1)

      const totalActiveValidators1After = totalDepositedValidators1After - totalExitedValidators1After
      const totalActiveValidators2After = totalDepositedValidators2After - totalExitedValidators2After
      const totalActiveValidatorsAfter = totalActiveValidators1After + totalActiveValidators2After

      assert.notEqual(totalActiveValidatorsBefore, totalActiveValidatorsAfter)
      assert.notEqual(totalActiveValidators1Before, totalActiveValidators1After)
      assert.equal(totalDepositedValidators2Before, totalDepositedValidators2After)

      const op1shareAfter = totalActiveValidators1After / totalActiveValidatorsAfter // should be 0.375
      const op2shareAfter = totalActiveValidators2After / totalActiveValidatorsAfter // should be 0.625

      assert.equal(op1shareAfter, 0.375)
      assert.equal(op2shareAfter, 0.625)

      assert(op1shareBefore > op1shareAfter)
      assert(op2shareBefore < op2shareAfter)
      assert(op1shareBefore < op2shareAfter)

      distribution = await operators.getRewardsDistribution(sharesDistribute)
      assert.equal(+distribution.shares[0], op1shareAfter * sharesDistribute)
      assert.equal(+distribution.shares[1], op2shareAfter * sharesDistribute)
    })

    it('report exited keys without target limit should not change allocation', async () => {
      // check exited validators before
      let moduleSummary1 = await router.getStakingModuleSummary(module1Id)
      assert.equal(moduleSummary1.totalExitedValidators, 0)
      assert.equal(moduleSummary1.totalDepositedValidators, 100)
      assert.equal(moduleSummary1.depositableValidatorsCount, 20)

      const maxDepositsPerModuleBefore = await maxDepositsPerModule()
      assert.deepEqual([20, 5], maxDepositsPerModuleBefore)

      // //update exited validators
      const exitValidatorsCount = 20
      const newlyExitedCount = await router.updateExitedValidatorsCountByStakingModule.sendWithResult(
        [module1Id],
        [exitValidatorsCount],
        { from: admin }
      )
      assert.equals(newlyExitedCount, exitValidatorsCount)

      const nodeOpIds = [0]
      const exitedValidatorsCounts = [exitValidatorsCount]

      const nodeOpIdsData = hexConcat(...nodeOpIds.map((i) => hex(i, 8)))
      const keysData = hexConcat(...exitedValidatorsCounts.map((c) => hex(c, 16)))

      // report exited by module and node operator
      await router.reportStakingModuleExitedValidatorsCountByNodeOperator(module1Id, nodeOpIdsData, keysData, {
        from: admin,
      })

      moduleSummary1 = await router.getStakingModuleSummary(module1Id)
      assert.equal(moduleSummary1.totalExitedValidators, exitValidatorsCount)
      assert.equal(moduleSummary1.totalDepositedValidators, 100)
      assert.equal(moduleSummary1.depositableValidatorsCount, 20)

      const maxDepositsPerModuleAfter = await maxDepositsPerModule()
      assert.deepEqual(maxDepositsPerModuleBefore, maxDepositsPerModuleAfter)
    })

    it('report exited keys with target limit should change allocation', async () => {
      // check exited validators before
      const moduleSummary1Before = await router.getStakingModuleSummary(module1Id)
      assert.equal(moduleSummary1Before.totalExitedValidators, 0)
      assert.equal(moduleSummary1Before.totalDepositedValidators, 100)
      assert.equal(moduleSummary1Before.depositableValidatorsCount, 20)

      let keyStats = await router.getNodeOperatorSummary(module1Id, 0)
      assert.equals(keyStats.isTargetLimitActive, false)
      assert.equals(keyStats.targetValidatorsCount, 0)
      assert.equals(keyStats.totalExitedValidators, 0)
      assert.equals(keyStats.totalDepositedValidators, 50)
      assert.equals(keyStats.depositableValidatorsCount, 10)

      // get max allocation before set target limit
      const maxDepositsPerModuleBefore = await maxDepositsPerModule()
      assert.deepEqual([20, 5], maxDepositsPerModuleBefore)

      await operators.updateTargetValidatorsLimits(0, true, 50, { from: voting })

      //
      keyStats = await router.getNodeOperatorSummary(module1Id, 0)
      assert.equals(keyStats.isTargetLimitActive, true)
      assert.equals(keyStats.targetValidatorsCount, 50)
      assert.equals(keyStats.totalExitedValidators, 0)
      assert.equals(keyStats.totalDepositedValidators, 50)
      assert.equals(keyStats.depositableValidatorsCount, 0)

      // check exited validators after
      let moduleSummary1After = await router.getStakingModuleSummary(module1Id)
      assert.equal(moduleSummary1After.totalExitedValidators, 0)
      assert.equal(moduleSummary1After.totalDepositedValidators, 100)
      assert.equal(moduleSummary1After.depositableValidatorsCount, 10)

      // decreases
      const maxDepositsPerModuleAfter = await maxDepositsPerModule()
      assert.deepEqual([10, 5], maxDepositsPerModuleAfter)

      // increase target limit 50 -> 55
      await operators.updateTargetValidatorsLimits(0, true, 55, { from: voting })
      keyStats = await router.getNodeOperatorSummary(module1Id, 0)
      moduleSummary1After = await router.getStakingModuleSummary(module1Id)

      assert.equals(keyStats.depositableValidatorsCount, 5)
      assert.equal(moduleSummary1After.depositableValidatorsCount, 15)
      assert.deepEqual([15, 5], await maxDepositsPerModule())

      // update exited validators
      const exitValidatorsCount = 1
      const exitedCount = await router.updateExitedValidatorsCountByStakingModule.sendWithResult(
        [module1Id],
        [exitValidatorsCount],
        { from: admin }
      )
      assert.equals(exitValidatorsCount, exitedCount)
      const nodeOpIds = [0]
      let exitedValidatorsCounts = [exitValidatorsCount]

      const nodeOpIdsData = hexConcat(...nodeOpIds.map((i) => hex(i, 8)))
      let keysData = hexConcat(...exitedValidatorsCounts.map((c) => hex(c, 16)))

      // report exited by module and node operator
      await router.reportStakingModuleExitedValidatorsCountByNodeOperator(module1Id, nodeOpIdsData, keysData, {
        from: admin,
      })

      // check allocation
      keyStats = await router.getNodeOperatorSummary(module1Id, 0)
      moduleSummary1After = await router.getStakingModuleSummary(module1Id)

      assert.equals(keyStats.depositableValidatorsCount, 6)
      assert.equal(moduleSummary1After.depositableValidatorsCount, 16)

      const maxDepositsPerModuleAfterAlloc = await maxDepositsPerModule()
      assert.deepEqual([16, 5], maxDepositsPerModuleAfterAlloc)

      // update next exited validators
      const nextExitValidatorsCount = 30
      exitedValidatorsCounts = [nextExitValidatorsCount]
      keysData = hexConcat(...exitedValidatorsCounts.map((c) => hex(c, 16)))

      const newlyExitedCount = await router.updateExitedValidatorsCountByStakingModule.sendWithResult(
        [module1Id],
        [nextExitValidatorsCount],
        { from: admin }
      )
      assert.equals(newlyExitedCount, nextExitValidatorsCount - exitValidatorsCount)
      // report exited by module and node operator
      await router.reportStakingModuleExitedValidatorsCountByNodeOperator(module1Id, nodeOpIdsData, keysData, {
        from: admin,
      })

      // check allocation
      keyStats = await router.getNodeOperatorSummary(module1Id, 0)
      moduleSummary1After = await router.getStakingModuleSummary(module1Id)

      assert.equals(keyStats.depositableValidatorsCount, 10) // we can't change
      assert.equal(moduleSummary1After.depositableValidatorsCount, 20)

      const maxDepositsPerModuleAfterReport = await maxDepositsPerModule()
      assert.deepEqual([20, 5], maxDepositsPerModuleAfterReport)

      // small explanation:
      // vetted  - 60 keys
      // deposited - 50 keys
      // exited - 0 keys
      //
      // for allocation, we need to know how many keys are available for deposit - depositableKeys
      // in common case, when targetLimit is not active `depositableKeys` = vetted - deposited
      //
      // but if targetLimit is active and targetLimit=50, then depositableKeys==0,
      // because there are 50 active keys already.
      //
      // when we report exitedKeys=10, thats mean active keys decrease to 40 keys, and depositableKeys=10 now
      // BUT depositableKeys cannot be more than vetted-deposited
      // so if we report exitedKeys=10 depositableKeys should be still 10
    })

    it('report stuck keys should not change rewards distribution, but return penalized table', async () => {
      let distribution

      const {
        totalDepositedValidators: totalDepositedValidators1Before,
        totalExitedValidators: totalExitedValidators1Before,
      } = await router.getNodeOperatorSummary(module1Id, 0)
      const {
        totalDepositedValidators: totalDepositedValidators2Before,
        totalExitedValidators: totalExitedValidators2Before,
      } = await router.getNodeOperatorSummary(module1Id, 1)

      const totalActiveValidators1Before = totalDepositedValidators1Before - totalExitedValidators1Before
      const totalActiveValidators2Before = totalDepositedValidators2Before - totalExitedValidators2Before
      const totalActiveValidatorsBefore = totalActiveValidators1Before + totalActiveValidators2Before

      const op1shareBefore = totalActiveValidators1Before / totalActiveValidatorsBefore // should be 0.5
      const op2shareBefore = totalActiveValidators2Before / totalActiveValidatorsBefore // should be 0.5

      assert.equal(op1shareBefore, 0.5)
      assert.equal(op2shareBefore, 0.5)

      const sharesDistribute = ETH(1)
      distribution = await operators.getRewardsDistribution(sharesDistribute)
      assert.equal(+distribution.shares[0], op1shareBefore * sharesDistribute)
      assert.equal(+distribution.shares[1], op2shareBefore * sharesDistribute)

      // update stuck validators
      const stuckValidatorsCount = 1

      const nodeOpIds = [0]
      const exitedValidatorsCounts = [stuckValidatorsCount]

      const nodeOpIdsData = hexConcat(...nodeOpIds.map((i) => hex(i, 8)))
      const keysData = hexConcat(...exitedValidatorsCounts.map((c) => hex(c, 16)))

      // report stuck by module and node operator
      await router.reportStakingModuleStuckValidatorsCountByNodeOperator(module1Id, nodeOpIdsData, keysData, {
        from: admin,
      })

      // get distribution after exited keys
      const {
        totalDepositedValidators: totalDepositedValidators1After,
        totalExitedValidators: totalExitedValidators1After,
      } = await router.getNodeOperatorSummary(module1Id, 0)
      const {
        totalDepositedValidators: totalDepositedValidators2After,
        totalExitedValidators: totalExitedValidators2After,
      } = await router.getNodeOperatorSummary(module1Id, 1)

      const totalActiveValidators1After = totalDepositedValidators1After - totalExitedValidators1After
      const totalActiveValidators2After = totalDepositedValidators2After - totalExitedValidators2After
      const totalActiveValidatorsAfter = totalActiveValidators1After + totalActiveValidators2After

      assert.equal(totalActiveValidatorsBefore, totalActiveValidatorsAfter)
      assert.equal(totalActiveValidators1Before, totalActiveValidators1After)
      assert.equal(totalDepositedValidators2Before, totalDepositedValidators2After)

      const op1shareAfter = totalActiveValidators1After / totalActiveValidatorsAfter
      const op2shareAfter = totalActiveValidators2After / totalActiveValidatorsAfter

      // when penalized shares still the same
      assert.equal(op1shareBefore, op1shareAfter)
      assert.equal(op2shareBefore, op2shareAfter)

      distribution = await operators.getRewardsDistribution(sharesDistribute)
      assert.deepEqual([+distribution.shares[0], distribution.penalized[0]], [op1shareAfter * sharesDistribute, true])
      assert.deepEqual([+distribution.shares[1], distribution.penalized[1]], [op2shareAfter * sharesDistribute, false])
    })

    it('report stuck keys should not affect stake allocation', async () => {
      // get max allocation before
      const maxDepositsPerModuleBefore = await maxDepositsPerModule()
      assert.deepEqual([20, 5], maxDepositsPerModuleBefore)

      const moduleSummary1Before = await router.getNodeOperatorSummary(module1Id, 0)
      assert.equal(moduleSummary1Before.stuckValidatorsCount, 0)
      assert.equal(moduleSummary1Before.depositableValidatorsCount, 10)

      // update stuck validators
      const stuckValidatorsCount = 20

      const nodeOpIds = [0]
      const exitedValidatorsCounts = [stuckValidatorsCount]

      const nodeOpIdsData = hexConcat(...nodeOpIds.map((i) => hex(i, 8)))
      const keysData = hexConcat(...exitedValidatorsCounts.map((c) => hex(c, 16)))

      // report exited by module and node operator
      await router.reportStakingModuleStuckValidatorsCountByNodeOperator(module1Id, nodeOpIdsData, keysData, {
        from: admin,
      })

      // we remove allocation from operator, if he has stuck keys
      const maxDepositsPerModuleAfter = await maxDepositsPerModule()
      assert.deepEqual([10, 5], maxDepositsPerModuleAfter)

      const moduleSummary1After = await router.getNodeOperatorSummary(module1Id, 0)
      assert.equal(moduleSummary1After.stuckValidatorsCount, 20)
      assert.equal(moduleSummary1After.depositableValidatorsCount, 0)
    })
  })
})
