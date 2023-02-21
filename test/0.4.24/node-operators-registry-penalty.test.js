const hre = require('hardhat')
const { web3 } = require('hardhat')
const { bn } = require('@aragon/contract-helpers-test')
const { BN } = require('bn.js')

const { assert } = require('../helpers/assert')
const { padRight, ETH, prepIdsCountsPayload } = require('../helpers/utils')
const { AragonDAO } = require('./helpers/dao')
const { EvmSnapshot, advanceChainTime } = require('../helpers/blockchain')
const { getRandomLocatorConfig } = require('../helpers/locator')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistryMock')
const LidoLocator = artifacts.require('LidoLocator')
const Burner = artifacts.require('Burner.sol')

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'
const ADDRESS_3 = '0x0000000000000000000000000000000000000003'
const ADDRESS_4 = '0x0000000000000000000000000000000000000005'

const NODE_OPERATORS = [
  {
    name: 'fo o',
    rewardAddress: ADDRESS_1,
    totalSigningKeysCount: 10,
    depositedSigningKeysCount: 5,
    exitedSigningKeysCount: 1,
    vettedSigningKeysCount: 6,
    targetValidatorsLimitActive: false,
    targetValidatorsKeysCount: 1,
    unavaliableKeysCount: 2,
    stuckSigningKeysCount: 3,
    refundedSigningKeysCount: 4
  },
  {
    name: ' bar',
    rewardAddress: ADDRESS_2,
    totalSigningKeysCount: 15,
    depositedSigningKeysCount: 7,
    exitedSigningKeysCount: 0,
    vettedSigningKeysCount: 10,
    targetValidatorsLimitActive: false,
    targetValidatorsKeysCount: 1,
    unavaliableKeysCount: 2,
    stuckSigningKeysCount: 3,
    refundedSigningKeysCount: 4
  },
  {
    name: 'deactivated',
    isActive: false,
    rewardAddress: ADDRESS_3,
    totalSigningKeysCount: 10,
    depositedSigningKeysCount: 0,
    exitedSigningKeysCount: 0,
    vettedSigningKeysCount: 5,
    targetValidatorsLimitActive: false,
    targetValidatorsKeysCount: 1,
    unavaliableKeysCount: 2,
    stuckSigningKeysCount: 3,
    refundedSigningKeysCount: 4
  }
]

// bytes32 0x63757261746564
const CURATED_TYPE = padRight(web3.utils.fromAscii('curated'), 32)
const PENALTY_DELAY = 2 * 24 * 60 * 60 // 2 days

const StETH = artifacts.require('StETHMock')

contract('NodeOperatorsRegistry', ([appManager, voting, user1, user2, user3, user4, no1, treasury]) => {
  let appBase, app, pool, steth, dao, locator, burner
  const snapshot = new EvmSnapshot(hre.ethers.provider)

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await NodeOperatorsRegistry.new()
    steth = await StETH.new({ value: ETH(1) })

    burner = await Burner.new(voting, treasury, steth.address, bn(0), bn(0), { from: appManager })

    const locatorConfig = getRandomLocatorConfig({
      lido: steth.address,
      burner: burner.address
    })
    locator = await LidoLocator.new(locatorConfig)

    dao = await AragonDAO.create(appManager)
    app = await dao.newAppInstance({
      name: 'node-operators-registry',
      base: appBase,
      permissions: {
        MANAGE_SIGNING_KEYS: voting,
        MANAGE_NODE_OPERATOR_ROLE: voting,
        SET_NODE_OPERATOR_LIMIT_ROLE: voting,
        STAKING_ROUTER_ROLE: voting
      }
    })

    //grant REQUEST_BURN_SHARES_ROLE to NOR
    await burner.grantRole(web3.utils.keccak256(`REQUEST_BURN_SHARES_ROLE`), app.address, { from: voting })

    // grant role to app itself cause it uses solidity's call method to itself
    // inside the testing_requestValidatorsKeysForDeposits() method
    await dao.grantPermission(app.address, app, 'STAKING_ROUTER_ROLE')

    // Instantiate a proxy for the app, using the base c ontract as its logic implementation.
    // const proxyAddress = await newApp(newDAO.dao, 'node-operators-registry', appBase.address, appManager)
    // app = await NodeOperatorsRegistry.at(proxyAddress)

    // Initialize the app's proxy.
    const tx = await app.initialize(locator.address, CURATED_TYPE, PENALTY_DELAY)

    //set stuck penalty voting
    // await app.setStuckPenaltyDelay(PENALTY_DELAY, { from: voting })

    // Implementation initializer reverts because initialization block was set to max(uint256)
    // in the Autopetrified base contract
    // await assert.reverts(appBase.initialize(steth.address, CURATED_TYPE), 'INIT_ALREADY_INITIALIZED')
    await assert.reverts(appBase.initialize(locator.address, CURATED_TYPE, PENALTY_DELAY), 'INIT_ALREADY_INITIALIZED')

    const moduleType = await app.getType()
    assert.emits(tx, 'ContractVersionSet', { version: 2 })
    assert.emits(tx, 'LocatorContractSet', { locatorAddress: locator.address })
    assert.emits(tx, 'StakingModuleTypeSet', { moduleType })
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  describe('distributeRewards()', () => {
    let firstNodeOperator = 0;
    let secondNodeOperator = 1;

    beforeEach(async () => {
      await app.testing_addNodeOperator('0', user1, 3, 3, 3, 0)
      await app.testing_addNodeOperator('1', user2, 7, 7, 7, 0)
      await app.testing_addNodeOperator('2', user3, 0, 0, 0, 0)
    })

    it("doesn't distributes rewards if no shares to distribute", async () => {
      const sharesCount = await steth.sharesOf(app.address)
      assert.equals(sharesCount, 0)
      const recipientsSharesBefore = await Promise.all([
        steth.sharesOf(user1),
        steth.sharesOf(user2),
        steth.sharesOf(user3)
      ])

      // calls distributeRewards() inside
      await app.testing__distributeRewards({ from: voting })

      const recipientsSharesAfter = await Promise.all([
        steth.sharesOf(user1),
        steth.sharesOf(user2),
        steth.sharesOf(user3)
      ])
      assert.equal(recipientsSharesBefore.length, recipientsSharesAfter.length)
      for (let i = 0; i < recipientsSharesBefore.length; ++i) {
        assert.equals(recipientsSharesBefore[i], recipientsSharesAfter[i])
      }
    })

    it('must distribute rewards to operators', async () => {
      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, ETH(10))

      // calls distributeRewards() inside
      await app.testing__distributeRewards({ from: voting })

      assert.equals(await steth.sharesOf(user1), ETH(3))
      assert.equals(await steth.sharesOf(user2), ETH(7))
      assert.equals(await steth.sharesOf(user3), 0)
    })

    it('emits RewardsDistributed with correct params on reward distribution', async () => {
      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, ETH(10))

      // calls distributeRewards() inside
      receipt = await app.testing__distributeRewards({ from: voting })

      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user1, sharesAmount: ETH(3) })
      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user2, sharesAmount: ETH(7) })
      assert.notEmits(receipt, 'RewardsDistributed', { rewardAddress: user3, sharesAmount: 0 })
    })

    it('distribute with stopped works', async () => {
      let totalRewardShares = ETH(10)

      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, totalRewardShares)

      //before
      //      operatorId | Total | Deposited | Exited | Active (deposited-exited)
      //         0           3         3         0        3
      //         1           7         7         0        7
      //         2           0         0         0        0
      //-----------------------------------------------------------------------------
      //total    3           10       10         0       10
      //
      //perValidatorShare 10*10^18 / 10 = 10^18

      //update [operator, exited, stuck]
      await app.unsafeUpdateValidatorsCount(firstNodeOperator, 1, 0 , { from: voting })
      await app.unsafeUpdateValidatorsCount(secondNodeOperator, 1, 0 , { from: voting })

      //after
      //      operatorId | Total | Deposited | Exited | Stuck | Active (deposited-exited)
      //         0           3         3         1        0        2
      //         1           7         7         1        0        6
      //         2           0         0         0        0        0
      //-----------------------------------------------------------------------------
      //total    3           10       10         2       0         8
      //
      //perValidatorShare 10*10^18 / 8 = 1250000000000000000 == 1.25 * 10^18

      // calls distributeRewards() inside
      receipt = await app.testing__distributeRewards({ from: voting })

      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user1, sharesAmount: ETH(2*1.25) })
      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user2, sharesAmount: ETH(6*1.25) })
      assert.notEmits(receipt, 'RewardsDistributed', { rewardAddress: user3, sharesAmount: 0 })
      // assert.emits(receipt, 'NodeOperatorPenalized', { recipientAddress: user1, sharesPenalizedAmount: ETH(3) })
    })

    it('penalized keys with stopped and stuck works', async () => {
      let totalRewardShares = ETH(10)

      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, totalRewardShares)

      //before
      //      operatorId | Total | Deposited | Exited | Active (deposited-exited)
      //         0           3         3         0        3
      //         1           7         7         0        7
      //         2           0         0         0        0
      //-----------------------------------------------------------------------------
      //total    3           10       10         0       10
      //
      //perValidatorShare 10*10^18 / 10 = 10^18

      //update [operator, exited, stuck]
      await app.unsafeUpdateValidatorsCount(firstNodeOperator, 1, 1 , { from: voting })
      await app.unsafeUpdateValidatorsCount(secondNodeOperator, 1, 0 , { from: voting })

      //after
      //      operatorId | Total | Deposited | Exited | Stuck | Active (deposited-exited)
      //         0           3         3         1        1        2
      //         1           7         7         1        0        6
      //         2           0         0         0        0        0
      //-----------------------------------------------------------------------------
      //total    3           10       10         2       1         8
      //
      //perValidatorShare 10*10^18 / 8 = 1250000000000000000 == 1.25 * 10^18
      // but half goes to burner

      // calls distributeRewards() inside
      receipt = await app.testing__distributeRewards({ from: voting })

      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user1, sharesAmount: ETH(1.25) })
      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user2, sharesAmount: ETH(6*1.25) })
      assert.notEmits(receipt, 'RewardsDistributed', { rewardAddress: user3, sharesAmount: 0 })
      assert.emits(receipt, 'NodeOperatorPenalized', { recipientAddress: user1, sharesPenalizedAmount: ETH(1.25) })
    })

    it('penalized firstOperator, add refund but 2 days have not passed yet', async () => {
      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, ETH(10))

      //update [operator, exited, stuck]
      await app.unsafeUpdateValidatorsCount(firstNodeOperator, 1, 1 , { from: voting })
      await app.unsafeUpdateValidatorsCount(secondNodeOperator, 1, 0 , { from: voting })

      await app.updateRefundedValidatorsCount(firstNodeOperator, 1, { from: voting })

      // calls distributeRewards() inside
      receipt = await app.testing__distributeRewards({ from: voting })

      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user1, sharesAmount: ETH(1.25) })
      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user2, sharesAmount: ETH(6*1.25) })
      assert.notEmits(receipt, 'RewardsDistributed', { rewardAddress: user3, sharesAmount: 0 })
      assert.emits(receipt, 'NodeOperatorPenalized', { recipientAddress: user1, sharesPenalizedAmount: ETH(1.25) })
    })

    it('reverts when refund more than DEPOSITED_KEYS_COUNT_OFFSET', async () => {
      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, ETH(10))

      //update [operator, exited, stuck]
      await app.unsafeUpdateValidatorsCount(firstNodeOperator, 1, 1, { from: voting })
      await app.unsafeUpdateValidatorsCount(secondNodeOperator, 1, 0, { from: voting })

      await assert.reverts(app.updateRefundedValidatorsCount(firstNodeOperator, 1000, { from: voting }), "OUT_OF_RANGE")
    })

    it('penalized firstOperator, add refund less than stuck validators', async () => {
      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, ETH(10))

      //update [operator, exited, stuck]
      await app.unsafeUpdateValidatorsCount(firstNodeOperator, 2, 2 , { from: voting })
      await app.unsafeUpdateValidatorsCount(secondNodeOperator, 3, 0 , { from: voting })

      // perValidator = ETH(10) / 5 = 2 eth

      await app.updateRefundedValidatorsCount(firstNodeOperator, 1, { from: voting })

      // calls distributeRewards() inside
      receipt = await app.testing__distributeRewards({ from: voting })

      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user1, sharesAmount: ETH(1) })
      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user2, sharesAmount: ETH(4*2) })
      assert.notEmits(receipt, 'RewardsDistributed', { rewardAddress: user3, sharesAmount: 0 })
      assert.emits(receipt, 'NodeOperatorPenalized', { recipientAddress: user1, sharesPenalizedAmount: ETH(1) })
    })

    it('penalized firstOperator, add refund and 2 days passed', async () => {
      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, ETH(10))



      assert.isFalse(await app.testing_isNodeOperatorPenalized(firstNodeOperator))

      //update [operator, exited, stuck]
      await app.unsafeUpdateValidatorsCount(firstNodeOperator, 1, 1 , { from: voting })
      await app.unsafeUpdateValidatorsCount(secondNodeOperator, 1, 0 , { from: voting })
      assert.isTrue(await app.testing_isNodeOperatorPenalized(firstNodeOperator))

      await app.updateRefundedValidatorsCount(firstNodeOperator, 1, { from: voting })
      assert.isTrue(await app.testing_isNodeOperatorPenalized(firstNodeOperator))

      await advanceChainTime(2 * 24 * 60 * 60 + 10)

      assert.isFalse(await app.testing_isNodeOperatorPenalized(firstNodeOperator))

      // calls distributeRewards() inside
      receipt = await app.testing__distributeRewards({ from: voting })

      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user1, sharesAmount: ETH(2.5) })
      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user2, sharesAmount: ETH(7.5) })
      assert.notEmits(receipt, 'RewardsDistributed', { rewardAddress: user3, sharesAmount: 0 })
      assert.notEmits(receipt, 'NodeOperatorPenalized')
    })
  })

  describe('getNodeOperatorSummary()', () => {
    beforeEach(async () => {
      //total vetted deposited exited
      await app.testing_addNodeOperator('0', user1, 20, 15, 10, 2)
      await app.testing_addNodeOperator('1', user2, 20, 10, 5, 0)
      await app.testing_addNodeOperator('2', user3, 15, 5, 0, 0)
      await app.testing_addNodeOperator('3', user4, 20, 15, 10, 0)

      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, ETH(10))

      // await app.testing_addNodeOperator('no', no1, 55, 30, 15, 2)
    })

    it('updateTargetValidatorsLimits() - target <= deposited', async () => {
      let keyStats = await app.getNodeOperatorSummary(3)
      assert.equal(+keyStats.isTargetLimitActive, false)
      assert.equal(+keyStats.targetValidatorsCount, 0)

      await app.updateTargetValidatorsLimits(3, true, 3, { from: voting })
      keyStats = await app.getNodeOperatorSummary(3)

      assert.equal(+keyStats.isTargetLimitActive, true)
      assert.equal(+keyStats.targetValidatorsCount, 3)
    })

    it('updateTargetValidatorsLimits() - deposited < target < vetted', async () => {
      let keyStats = await app.getNodeOperatorSummary(3)
      assert.equal(+keyStats.isTargetLimitActive, false)
      assert.equal(+keyStats.targetValidatorsCount, 0)
      assert.equal(+keyStats.depositableValidatorsCount, 5)

      await app.updateTargetValidatorsLimits(3, true, 11, { from: voting })
      keyStats = await app.getNodeOperatorSummary(3)

      assert.equal(+keyStats.isTargetLimitActive, true)
      assert.equal(+keyStats.targetValidatorsCount, 11)
      assert.equal(+keyStats.depositableValidatorsCount, 1)
    })

    it('updateTargetValidatorsLimits() - vetted <= target', async () => {
      let keyStats = await app.getNodeOperatorSummary(3)
      assert.equal(+keyStats.isTargetLimitActive, false)
      assert.equal(+keyStats.targetValidatorsCount, 0)
      assert.equal(+keyStats.depositableValidatorsCount, 5)

      await app.updateTargetValidatorsLimits(3, true, 18, { from: voting })
      keyStats = await app.getNodeOperatorSummary(3)

      assert.equal(+keyStats.isTargetLimitActive, true)
      assert.equal(+keyStats.targetValidatorsCount, 18)
      assert.equal(+keyStats.depositableValidatorsCount, 5)
    })


    it('updateExitedValidatorsCount() - check if appeared a new deposited keys', async () => {
      await app.updateTargetValidatorsLimits(3, true, 5, { from: voting })
      let keyStats = await app.getNodeOperatorSummary(3)

      //excess = deposited - stopped - targetLimit
      assert.equal(+keyStats.targetValidatorsCount, 5)

      //increase _newActiveValidatorsCount by add new depositedKeys
      await app.increaseNodeOperatorDepositedSigningKeysCount(3, 2)

      const { operatorIds, keysCounts } = prepIdsCountsPayload(3, 1)
      await app.updateExitedValidatorsCount(operatorIds, keysCounts, { from: voting })

    })

    it('updateTargetValidatorsLimits() - try to update to the same active flag', async () => {
      let keyStats = await app.getNodeOperatorSummary(0)
      targetValidatorsCountBefore = keyStats.targetValidatorsCount
      assert.equal(keyStats.isTargetLimitActive, false)
      assert.equal(+keyStats.targetValidatorsCount, 0)

      await app.updateTargetValidatorsLimits(0, false, 10, { from: voting })
      keyStats = await app.getNodeOperatorSummary(0)
      targetValidatorsCountAfter = keyStats.targetValidatorsCount
      assert.equal(keyStats.isTargetLimitActive, false)
      assert.equal(+targetValidatorsCountBefore, +targetValidatorsCountAfter)

      targetValidatorsCountBefore =  keyStats.targetValidatorsCount
      await app.updateTargetValidatorsLimits(0, true, 20, { from: voting })
      keyStats = await app.getNodeOperatorSummary(0)
      targetValidatorsCountAfter = keyStats.targetValidatorsCount
      assert.equal(keyStats.isTargetLimitActive, true)
      assert.notEqual(+targetValidatorsCountBefore, +targetValidatorsCountAfter)

      await app.updateTargetValidatorsLimits(0, true, 30, { from: voting })
      keyStats = await app.getNodeOperatorSummary(0)
      targetValidatorsCountAfter = keyStats.targetValidatorsCount
      assert.equal(keyStats.isTargetLimitActive, true)
      assert.equal(+targetValidatorsCountAfter, 30)
    })

    it('updateTargetValidatorsLimits()', async () => {
      await app.updateTargetValidatorsLimits(0, true, 10, { from: voting })

      let keysStatTotal = await app.getStakingModuleSummary()
      assert.equal(+keysStatTotal.totalExitedValidators, 2)
      assert.equal(+keysStatTotal.totalDepositedValidators, 25)
      assert.equal(+keysStatTotal.depositableValidatorsCount, 17)

      let limitStatOp = await app.getNodeOperatorSummary(0)
      assert.equal(limitStatOp.isTargetLimitActive, true)
      assert.equal(+limitStatOp.targetValidatorsCount, 10)

      let keysStatOp = await app.getNodeOperatorSummary(0)
      assert.equal(+keysStatOp.totalExitedValidators, 2)
      assert.equal(keysStatOp.totalDepositedValidators.toNumber()-keysStatOp.totalExitedValidators.toNumber(), 8)
      assert.equal(+keysStatOp.depositableValidatorsCount, 2)

      await app.updateTargetValidatorsLimits(0, false, 10, { from: voting })

      keysStatTotal = await app.getStakingModuleSummary()
      assert.equal(+keysStatTotal.totalExitedValidators, 2)
      assert.equal(+keysStatTotal.totalDepositedValidators, 25)
      assert.equal(+keysStatTotal.depositableValidatorsCount, 20)

      limitStatOp = await app.getNodeOperatorSummary(0)
      assert.equal(limitStatOp.isTargetLimitActive, false)
      assert.equal(+limitStatOp.targetValidatorsCount, 0)

      keysStatOp = await app.getNodeOperatorSummary(0)
      assert.equal(+keysStatOp.totalExitedValidators, 2)
      assert.equal(keysStatOp.totalDepositedValidators.toNumber()-keysStatOp.totalExitedValidators.toNumber(), 8)
      assert.equal(+keysStatOp.depositableValidatorsCount, 5)
    })

    it('updateExitedValidatorsCount()', async () => {
      await app.updateTargetValidatorsLimits(0, true, 5, { from: voting })
      await app.updateTargetValidatorsLimits(1, true, 5, { from: voting })

      let keysStatTotal = await app.getStakingModuleSummary()
      // console.log(o2n(keysStatTotal))
      assert.equal(+keysStatTotal.totalExitedValidators, 2)
      assert.equal(+keysStatTotal.totalDepositedValidators, 25)
      assert.equal(+keysStatTotal.depositableValidatorsCount, 10)

      // op 0
      let limitStatOp = await app.getNodeOperatorSummary(0)
      assert.equal(limitStatOp.isTargetLimitActive, true)
      assert.equal(limitStatOp.targetValidatorsCount, 5)

      let keysStatOp = await app.getNodeOperatorSummary(0)
      assert.equal(keysStatOp.totalExitedValidators, 2)
      assert.equal(keysStatOp.totalDepositedValidators.toNumber()-keysStatOp.totalExitedValidators.toNumber(), 8)
      assert.equal(keysStatOp.depositableValidatorsCount, 0)

      // op 1
      limitStatOp = await app.getNodeOperatorSummary(1)
      assert.equal(limitStatOp.isTargetLimitActive, true)
      assert.equal(limitStatOp.targetValidatorsCount, 5)

      keysStatOp = await app.getNodeOperatorSummary(1)
      assert.equal(keysStatOp.totalExitedValidators, 0)
      assert.equal(keysStatOp.totalDepositedValidators.toNumber()-keysStatOp.totalExitedValidators.toNumber(), 5)
      assert.equal(keysStatOp.depositableValidatorsCount, 0)

      // console.log(o2n(limitStatOp))
      const { operatorIds: operatorIds1, keysCounts: keysCounts1 } = prepIdsCountsPayload(0, 3)
      const { operatorIds: operatorIds2, keysCounts: keysCounts2 } = prepIdsCountsPayload(1, 1)
      await app.updateExitedValidatorsCount(operatorIds1, keysCounts1, { from: voting })
      await app.updateExitedValidatorsCount(operatorIds2, keysCounts2, { from: voting })

      keysStatTotal = await app.getStakingModuleSummary()
      // console.log(o2n(keysStatTotal))
      assert.equal(+keysStatTotal.totalExitedValidators, 4)
      assert.equal(keysStatTotal.totalDepositedValidators.toNumber()-keysStatTotal.totalExitedValidators.toNumber(), 25-(3+1))
      assert.equal(+keysStatTotal.depositableValidatorsCount, 11)

      // op 0
      limitStatOp = await app.getNodeOperatorSummary(0)
      assert.equal(limitStatOp.isTargetLimitActive, true)
      assert.equal(limitStatOp.targetValidatorsCount, 5)

      keysStatOp = await app.getNodeOperatorSummary(0)
      assert.equal(keysStatOp.totalExitedValidators, 3)
      assert.equal(keysStatOp.totalDepositedValidators.toNumber()-keysStatOp.totalExitedValidators.toNumber(), 7)
      assert.equal(keysStatOp.depositableValidatorsCount, 0)

      // op 1
      limitStatOp = await app.getNodeOperatorSummary(1)
      assert.equal(limitStatOp.isTargetLimitActive, true)
      assert.equal(limitStatOp.targetValidatorsCount, 5)

      keysStatOp = await app.getNodeOperatorSummary(1)
      assert.equal(keysStatOp.totalExitedValidators, 1)
      assert.equal(keysStatOp.totalDepositedValidators.toNumber()-keysStatOp.totalExitedValidators.toNumber(), 4)
      assert.equal(keysStatOp.depositableValidatorsCount, 1)
    })

    it('setNodeOperatorStakingLimit()', async () => {
      await app.updateTargetValidatorsLimits(0, true, 10, { from: voting })
      await app.updateTargetValidatorsLimits(1, true, 15, { from: voting })

      await app.setNodeOperatorStakingLimit(0, 10, { from: voting })
      await app.setNodeOperatorStakingLimit(1, 15, { from: voting })

      let keysStatTotal = await app.getStakingModuleSummary()
      // console.log(o2n(keysStatTotal))
      assert.equal(+keysStatTotal.totalExitedValidators, 2)
      assert.equal(+keysStatTotal.totalDepositedValidators, 25)
      assert.equal(+keysStatTotal.depositableValidatorsCount, 20)

      // op 0
      let limitStatOp = await app.getNodeOperatorSummary(0)
      assert.equal(limitStatOp.isTargetLimitActive, true)
      assert.equal(+limitStatOp.targetValidatorsCount, 10)

      let keysStatOp = await app.getNodeOperatorSummary(0)
      assert.equal(+keysStatOp.totalExitedValidators, 2)
      assert.equal(keysStatOp.totalDepositedValidators.toNumber()-keysStatOp.totalExitedValidators.toNumber(), 8)
      assert.equal(+keysStatOp.depositableValidatorsCount, 0)

      // op 1
      limitStatOp = await app.getNodeOperatorSummary(1)
      assert.equal(limitStatOp.isTargetLimitActive, true)
      assert.equal(limitStatOp.targetValidatorsCount, 15)

      keysStatOp = await app.getNodeOperatorSummary(1)
      assert.equal(keysStatOp.totalExitedValidators, 0)
      assert.equal(keysStatOp.totalDepositedValidators.toNumber()-keysStatOp.totalExitedValidators.toNumber(), 5)
      assert.equal(keysStatOp.depositableValidatorsCount, 10)
    })
  })
})

function o2n(o = {}) {
  for (const k of Object.keys(o)) {
    if (bn.isBN(o[k])) {
      o[k] = o[k].toString()
    }
  }
  return o
}
