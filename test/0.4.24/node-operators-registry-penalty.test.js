const hre = require('hardhat')
const { assert } = require('../helpers/assert')
const { assertRevert } = require('../helpers/assertThrow')
const { toBN, padRight, shares } = require('../helpers/utils')
const { BN } = require('bn.js')
const { AragonDAO } = require('./helpers/dao')
const { EvmSnapshot } = require('../helpers/blockchain')
const { ZERO_ADDRESS, getEventAt } = require('@aragon/contract-helpers-test')
const nodeOperators = require('../helpers/node-operators')
const signingKeys = require('../helpers/signing-keys')
const { web3 } = require('hardhat')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { getRandomLocatorConfig } = require('../helpers/locator')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistryMock')
const LidoLocator = artifacts.require('LidoLocator')

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
    forgivenSigningKeysCount: 4
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
    forgivenSigningKeysCount: 4
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
    forgivenSigningKeysCount: 4
  }
]

// bytes32 0x63757261746564
const CURATED_TYPE = padRight(web3.utils.fromAscii('curated'), 32)

const pad = (hex, bytesLength) => {
  const absentZeroes = bytesLength * 2 + 2 - hex.length
  if (absentZeroes > 0) hex = '0x' + '0'.repeat(absentZeroes) + hex.substr(2)
  return hex
}

const hexConcat = (first, ...rest) => {
  let result = first.startsWith('0x') ? first : '0x' + first
  rest.forEach((item) => {
    result += item.startsWith('0x') ? item.substr(2) : item
  })
  return result
}

const ETH = (value) => web3.utils.toWei(value + '', 'ether')
const StETH = artifacts.require('StETHMock')

contract('NodeOperatorsRegistry', ([appManager, voting, user1, user2, user3, user4]) => {
  let appBase, app, pool, steth, dao, locator
  const snapshot = new EvmSnapshot(hre.ethers.provider)

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await NodeOperatorsRegistry.new()
    steth = await StETH.new()

    const locatorConfig = getRandomLocatorConfig({
      lido: steth.address
    })
    locator = await LidoLocator.new(locatorConfig)

    dao = await AragonDAO.create(appManager)
    app = await dao.newAppInstance({
      name: 'node-operators-registry',
      base: appBase,
      permissions: {
        MANAGE_SIGNING_KEYS: voting,
        ADD_NODE_OPERATOR_ROLE: voting,
        MANAGE_NODE_OPERATOR_ROLE: voting,
        // ACTIVATE_NODE_OPERATOR_ROLE: voting,
        // DEACTIVATE_NODE_OPERATOR_ROLE: voting,
        // SET_NODE_OPERATOR_NAME_ROLE: voting,
        // SET_NODE_OPERATOR_ADDRESS_ROLE: voting,
        SET_NODE_OPERATOR_LIMIT_ROLE: voting,
        STAKING_ROUTER_ROLE: voting,
        INVALIDATE_READY_TO_DEPOSIT_KEYS_ROLE: voting
      }
    })

    // grant role to app itself cause it uses solidity's call method to itself
    // inside the testing_requestValidatorsKeysForDeposits() method
    await dao.grantPermission(app.address, app, 'STAKING_ROUTER_ROLE')

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    // const proxyAddress = await newApp(newDAO.dao, 'node-operators-registry', appBase.address, appManager)
    // app = await NodeOperatorsRegistry.at(proxyAddress)

    // Initialize the app's proxy.
    const tx = await app.initialize(locator.address, CURATED_TYPE)

    // Implementation initializer reverts because initialization block was set to max(uint256)
    // in the Autopetrified base contract
    // await assert.reverts(appBase.initialize(steth.address, CURATED_TYPE), 'INIT_ALREADY_INITIALIZED')
    await assertRevert(appBase.initialize(locator.address, CURATED_TYPE), 'INIT_ALREADY_INITIALIZED')

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
      await app.finishUpdatingExitedValidatorsKeysCount({ from: voting })

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

      await app.increaseTotalSigningKeysCount(10)
      await app.increaseVettedSigningKeysCount(10)
      await app.increaseDepositedSigningKeysCount(10)

      // calls distributeRewards() inside
      await app.finishUpdatingExitedValidatorsKeysCount({ from: voting })

      assert.equals(await steth.sharesOf(user1), ETH(3))
      assert.equals(await steth.sharesOf(user2), ETH(7))
      assert.equals(await steth.sharesOf(user3), 0)
    })

    it('emits RewardsDistributed with correct params on reward distribution', async () => {
      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, ETH(10))

      await app.increaseTotalSigningKeysCount(10)
      await app.increaseVettedSigningKeysCount(10)
      await app.increaseDepositedSigningKeysCount(10)

      // calls distributeRewards() inside
      receipt = await app.finishUpdatingExitedValidatorsKeysCount({ from: voting })

      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user1, sharesAmount: ETH(3) })
      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user2, sharesAmount: ETH(7) })
      assert.notEmits(receipt, 'RewardsDistributed', { rewardAddress: user3, sharesAmount: 0 })
    })

    it('distribute with stopped works', async () => {
      let totalRewardShares = ETH(10)

      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, totalRewardShares)

      await app.increaseTotalSigningKeysCount(10)
      await app.increaseVettedSigningKeysCount(10)
      await app.increaseDepositedSigningKeysCount(10)

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
      await app.unsafeUpdateValidatorsKeysCount(firstNodeOperator, 1, 0 , { from: voting })
      await app.unsafeUpdateValidatorsKeysCount(secondNodeOperator, 1, 0 , { from: voting })

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
      receipt = await app.finishUpdatingExitedValidatorsKeysCount({ from: voting })

      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user1, sharesAmount: ETH(2*1.25) })
      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user2, sharesAmount: ETH(6*1.25) })
      assert.notEmits(receipt, 'RewardsDistributed', { rewardAddress: user3, sharesAmount: 0 })
      // assert.emits(receipt, 'NodeOperatorPenalized', { recipientAddress: user1, sharesPenalizedAmount: ETH(3) })
    })

    it('penalized keys with stopped and stuck works', async () => {
      let totalRewardShares = ETH(10)

      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, totalRewardShares)

      await app.increaseTotalSigningKeysCount(10)
      await app.increaseVettedSigningKeysCount(10)
      await app.increaseDepositedSigningKeysCount(10)

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
      await app.unsafeUpdateValidatorsKeysCount(firstNodeOperator, 1, 1 , { from: voting })
      await app.unsafeUpdateValidatorsKeysCount(secondNodeOperator, 1, 0 , { from: voting })

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
      receipt = await app.finishUpdatingExitedValidatorsKeysCount({ from: voting })

      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user1, sharesAmount: ETH(1.25) })
      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user2, sharesAmount: ETH(6*1.25) })
      assert.notEmits(receipt, 'RewardsDistributed', { rewardAddress: user3, sharesAmount: 0 })
      assert.emits(receipt, 'NodeOperatorPenalized', { recipientAddress: user1, sharesPenalizedAmount: ETH(1.25) })
    })

    it('penalized firstOperator, add refund but 2 days have not passed yet', async () => {
      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, ETH(10))

      await app.increaseTotalSigningKeysCount(10)
      await app.increaseVettedSigningKeysCount(10)
      await app.increaseDepositedSigningKeysCount(10)

      //update [operator, exited, stuck]
      await app.unsafeUpdateValidatorsKeysCount(firstNodeOperator, 1, 1 , { from: voting })
      await app.unsafeUpdateValidatorsKeysCount(secondNodeOperator, 1, 0 , { from: voting })

      await app.updateForgivenValidatorsKeysCount(firstNodeOperator, 1, { from: voting })

      // calls distributeRewards() inside
      receipt = await app.finishUpdatingExitedValidatorsKeysCount({ from: voting })

      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user1, sharesAmount: ETH(1.25) })
      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user2, sharesAmount: ETH(6*1.25) })
      assert.notEmits(receipt, 'RewardsDistributed', { rewardAddress: user3, sharesAmount: 0 })
      assert.emits(receipt, 'NodeOperatorPenalized', { recipientAddress: user1, sharesPenalizedAmount: ETH(1.25) })
    })

    it('penalized firstOperator, add refund more than stuck validators', async () => {
      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, ETH(10))

      await app.increaseTotalSigningKeysCount(10)
      await app.increaseVettedSigningKeysCount(10)
      await app.increaseDepositedSigningKeysCount(10)

      //update [operator, exited, stuck]
      await app.unsafeUpdateValidatorsKeysCount(firstNodeOperator, 1, 1 , { from: voting })
      await app.unsafeUpdateValidatorsKeysCount(secondNodeOperator, 1, 0 , { from: voting })

      await app.updateForgivenValidatorsKeysCount(firstNodeOperator, 1000, { from: voting })

      // calls distributeRewards() inside
      receipt = await app.finishUpdatingExitedValidatorsKeysCount({ from: voting })

      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user1, sharesAmount: ETH(1.25) })
      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user2, sharesAmount: ETH(6*1.25) })
      assert.notEmits(receipt, 'RewardsDistributed', { rewardAddress: user3, sharesAmount: 0 })
      assert.emits(receipt, 'NodeOperatorPenalized', { recipientAddress: user1, sharesPenalizedAmount: ETH(1.25) })
    })

    it('penalized firstOperator, add refund less than stuck validators', async () => {
      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, ETH(10))

      await app.increaseTotalSigningKeysCount(10)
      await app.increaseVettedSigningKeysCount(10)
      await app.increaseDepositedSigningKeysCount(10)

      //update [operator, exited, stuck]
      await app.unsafeUpdateValidatorsKeysCount(firstNodeOperator, 2, 2 , { from: voting })
      await app.unsafeUpdateValidatorsKeysCount(secondNodeOperator, 3, 0 , { from: voting })

      // perValidator = ETH(10) / 5 = 2 eth

      await app.updateForgivenValidatorsKeysCount(firstNodeOperator, 1, { from: voting })

      // calls distributeRewards() inside
      receipt = await app.finishUpdatingExitedValidatorsKeysCount({ from: voting })

      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user1, sharesAmount: ETH(1) })
      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user2, sharesAmount: ETH(4*2) })
      assert.notEmits(receipt, 'RewardsDistributed', { rewardAddress: user3, sharesAmount: 0 })
      assert.emits(receipt, 'NodeOperatorPenalized', { recipientAddress: user1, sharesPenalizedAmount: ETH(1) })
    })

    it('penalized firstOperator, add refund and 2 days passed', async () => {
      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, ETH(10))

      await app.increaseTotalSigningKeysCount(10)
      await app.increaseVettedSigningKeysCount(10)
      await app.increaseDepositedSigningKeysCount(10)

      assert.isFalse(await app.testing_isNodeOperatorPenalized(firstNodeOperator))

      //update [operator, exited, stuck]
      await app.unsafeUpdateValidatorsKeysCount(firstNodeOperator, 1, 1 , { from: voting })
      await app.unsafeUpdateValidatorsKeysCount(secondNodeOperator, 1, 0 , { from: voting })
      assert.isTrue(await app.testing_isNodeOperatorPenalized(firstNodeOperator))      

      await app.updateForgivenValidatorsKeysCount(firstNodeOperator, 1, { from: voting })
      assert.isTrue(await app.testing_isNodeOperatorPenalized(firstNodeOperator))

      await hre.network.provider.send('evm_increaseTime', [2 * 24 * 60 * 60 + 10])
      await hre.network.provider.send('evm_mine')

      assert.isFalse(await app.testing_isNodeOperatorPenalized(firstNodeOperator))

      // calls distributeRewards() inside
      receipt = await app.finishUpdatingExitedValidatorsKeysCount({ from: voting })

      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user1, sharesAmount: ETH(2.5) })
      assert.emits(receipt, 'RewardsDistributed', { rewardAddress: user2, sharesAmount: ETH(7.5) })
      assert.notEmits(receipt, 'RewardsDistributed', { rewardAddress: user3, sharesAmount: 0 })
      assert.notEmits(receipt, 'NodeOperatorPenalized')
    })
  })

  describe('getValidatorsKeysStats()', () => {
    beforeEach(async () => {
      await app.testing_addNodeOperator('0', user1, 20, 15, 10, 2)
      await app.testing_addNodeOperator('1', user2, 20, 10, 5, 0)
      await app.testing_addNodeOperator('2', user3, 15, 5, 0, 0)
      await app.testing_addNodeOperator('3', user4, 20, 15, 10, 0)

      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, ETH(10))

      await app.increaseTotalSigningKeysCount(55)
      await app.increaseVettedSigningKeysCount(30)
      await app.increaseDepositedSigningKeysCount(15)
      await app.increaseExitedSigningKeysCount(2)
      // sum of (vetted[i] - exited[i])
      await app.increaseTargetValidatorsCount(28)
    })

    it('updateTargetValidatorsLimits()', async () => {
      await app.updateTargetValidatorsLimits(3, 5, true, { from: voting })
      let keyStats = await app.getNodeOperatorStats(3)

      assert.equal(+keyStats.excessValidatorsCount, 5)
    
      await app.updateExitedValidatorsKeysCount(3, 9, { from: voting })

      keyStats1 = await app.getNodeOperatorStats(3)
      assert.equal(+keyStats1.excessValidatorsCount, 0)
    }) 

    it('updateTargetValidatorsLimits() - try to update to the same active flag', async () => {
      let keyStats = await app.getNodeOperatorStats(0)
      targetValidatorsCountBefore = keyStats.targetValidatorsCount
      assert.isFalse(keyStats.targetValidatorsActive)

      await app.updateTargetValidatorsLimits(0, 10, false, { from: voting })
      keyStats = await app.getNodeOperatorStats(0)
      targetValidatorsCountAfter = keyStats.targetValidatorsCount
      assert.isFalse(keyStats.targetValidatorsActive)
      assert.equal(+targetValidatorsCountBefore, +targetValidatorsCountAfter)

      targetValidatorsCountBefore =  keyStats.targetValidatorsCount
      await app.updateTargetValidatorsLimits(0, 20, true, { from: voting })
      keyStats = await app.getNodeOperatorStats(0)
      targetValidatorsCountAfter = keyStats.targetValidatorsCount
      assert.isTrue(keyStats.targetValidatorsActive)
      assert.notEqual(+targetValidatorsCountBefore, +targetValidatorsCountAfter)

      targetValidatorsCountBefore =  keyStats.targetValidatorsCount
      await app.updateTargetValidatorsLimits(0, 30, true, { from: voting })
      keyStats = await app.getNodeOperatorStats(0)
      targetValidatorsCountAfter = keyStats.targetValidatorsCount
      assert.isTrue(keyStats.targetValidatorsActive)
      assert.equal(+targetValidatorsCountBefore, +targetValidatorsCountAfter)
    })

    it('updateTargetValidatorsLimits()', async () => {
      await app.updateTargetValidatorsLimits(0, 10, true, { from: voting })

      let keysStatTotal = await app.getValidatorsKeysStats()
      // console.log(o2n(keysStatTotal))
      assert.equal(keysStatTotal.exitedValidatorsCount, 2)
      assert.equal(keysStatTotal.activeValidatorsKeysCount, 13)
      assert.equal(keysStatTotal.readyToDepositValidatorsKeysCount, 12)

      let limitStatOp = await app.getNodeOperatorStats(0)
      assert.equal(limitStatOp.targetValidatorsActive, true)
      assert.equal(limitStatOp.targetValidatorsCount, 10)
      assert.equal(limitStatOp.excessValidatorsCount, 0)

      let keysStatOp = await app.getValidatorsKeysStats(0)
      assert.equal(keysStatOp.exitedValidatorsCount, 2)
      assert.equal(keysStatOp.activeValidatorsKeysCount, 8)
      assert.equal(keysStatOp.readyToDepositValidatorsKeysCount, 2)
      // console.log(stat12)

      await app.updateTargetValidatorsLimits(0, 10, false, { from: voting })

      keysStatTotal = await app.getValidatorsKeysStats()
      assert.equal(keysStatTotal.exitedValidatorsCount, 2)
      assert.equal(keysStatTotal.activeValidatorsKeysCount, 13)
      assert.equal(keysStatTotal.readyToDepositValidatorsKeysCount, 15)

      limitStatOp = await app.getNodeOperatorStats(0)
      assert.equal(limitStatOp.targetValidatorsActive, false)
      assert.equal(limitStatOp.targetValidatorsCount, 0)
      assert.equal(limitStatOp.excessValidatorsCount, 0)

      keysStatOp = await app.getValidatorsKeysStats(0)
      assert.equal(keysStatOp.exitedValidatorsCount, 2)
      assert.equal(keysStatOp.activeValidatorsKeysCount, 8)
      assert.equal(keysStatOp.readyToDepositValidatorsKeysCount, 5)
    })

    it('updateExitedValidatorsKeysCount()', async () => {
      await app.updateTargetValidatorsLimits(0, 5, true, { from: voting })
      await app.updateTargetValidatorsLimits(1, 5, true, { from: voting })

      let keysStatTotal = await app.getValidatorsKeysStats()
      // console.log(o2n(keysStatTotal))
      assert.equal(keysStatTotal.exitedValidatorsCount, 2)
      assert.equal(keysStatTotal.activeValidatorsKeysCount, 13)
      assert.equal(keysStatTotal.readyToDepositValidatorsKeysCount, 5)

      // op 0
      let limitStatOp = await app.getNodeOperatorStats(0)
      assert.equal(limitStatOp.targetValidatorsActive, true)
      assert.equal(limitStatOp.targetValidatorsCount, 5)
      assert.equal(limitStatOp.excessValidatorsCount, 3) // deposited - exited - target

      let keysStatOp = await app.getValidatorsKeysStats(0)
      assert.equal(keysStatOp.exitedValidatorsCount, 2)
      assert.equal(keysStatOp.activeValidatorsKeysCount, 8)
      assert.equal(keysStatOp.readyToDepositValidatorsKeysCount, 0)

      // op 1
      limitStatOp = await app.getNodeOperatorStats(1)
      assert.equal(limitStatOp.targetValidatorsActive, true)
      assert.equal(limitStatOp.targetValidatorsCount, 5)
      assert.equal(limitStatOp.excessValidatorsCount, 0) // deposited - exited - target

      keysStatOp = await app.getValidatorsKeysStats(1)
      assert.equal(keysStatOp.exitedValidatorsCount, 0)
      assert.equal(keysStatOp.activeValidatorsKeysCount, 5)
      assert.equal(keysStatOp.readyToDepositValidatorsKeysCount, 0)

      // // console.log(stat12)
      await app.updateExitedValidatorsKeysCount(0, 3, { from: voting })
      await app.updateExitedValidatorsKeysCount(1, 1, { from: voting })

      keysStatTotal = await app.getValidatorsKeysStats()
      assert.equal(keysStatTotal.exitedValidatorsCount, 4)
      assert.equal(keysStatTotal.activeValidatorsKeysCount, 11)
      assert.equal(keysStatTotal.readyToDepositValidatorsKeysCount, 6)

      // op 0
      limitStatOp = await app.getNodeOperatorStats(0)
      assert.equal(limitStatOp.targetValidatorsActive, true)
      assert.equal(limitStatOp.targetValidatorsCount, 5)
      assert.equal(limitStatOp.excessValidatorsCount, 2)

      keysStatOp = await app.getValidatorsKeysStats(0)
      assert.equal(keysStatOp.exitedValidatorsCount, 3)
      assert.equal(keysStatOp.activeValidatorsKeysCount, 7)
      assert.equal(keysStatOp.readyToDepositValidatorsKeysCount, 0)

      // op 1
      limitStatOp = await app.getNodeOperatorStats(1)
      assert.equal(limitStatOp.targetValidatorsActive, true)
      assert.equal(limitStatOp.targetValidatorsCount, 5)
      assert.equal(limitStatOp.excessValidatorsCount, 0)

      keysStatOp = await app.getValidatorsKeysStats(1)
      assert.equal(keysStatOp.exitedValidatorsCount, 1)
      assert.equal(keysStatOp.activeValidatorsKeysCount, 4)
      assert.equal(keysStatOp.readyToDepositValidatorsKeysCount, 1)
    })

    it('setNodeOperatorStakingLimit()', async () => {
      await app.updateTargetValidatorsLimits(0, 10, true, { from: voting })
      await app.updateTargetValidatorsLimits(1, 15, true, { from: voting })

      await app.setNodeOperatorStakingLimit(0, 10, { from: voting })
      await app.setNodeOperatorStakingLimit(1, 15, { from: voting })

      let keysStatTotal = await app.getValidatorsKeysStats()
      // console.log(o2n(keysStatTotal))
      assert.equal(keysStatTotal.exitedValidatorsCount, 2)
      assert.equal(keysStatTotal.activeValidatorsKeysCount, 13)
      assert.equal(keysStatTotal.readyToDepositValidatorsKeysCount, 15)

      // op 0
      let limitStatOp = await app.getNodeOperatorStats(0)
      assert.equal(limitStatOp.targetValidatorsActive, true)
      assert.equal(limitStatOp.targetValidatorsCount, 10)
      assert.equal(limitStatOp.excessValidatorsCount, 0) // deposited - exited - target

      let keysStatOp = await app.getValidatorsKeysStats(0)
      assert.equal(keysStatOp.exitedValidatorsCount, 2)
      assert.equal(keysStatOp.activeValidatorsKeysCount, 8)
      assert.equal(keysStatOp.readyToDepositValidatorsKeysCount, 0)

      // op 1
      limitStatOp = await app.getNodeOperatorStats(1)
      assert.equal(limitStatOp.targetValidatorsActive, true)
      assert.equal(limitStatOp.targetValidatorsCount, 15)
      assert.equal(limitStatOp.excessValidatorsCount, 0) // deposited - exited - target

      keysStatOp = await app.getValidatorsKeysStats(1)
      assert.equal(keysStatOp.exitedValidatorsCount, 0)
      assert.equal(keysStatOp.activeValidatorsKeysCount, 5)
      assert.equal(keysStatOp.readyToDepositValidatorsKeysCount, 10)
    })
  })
})

function o2n(o = {}) {
  for (const k of Object.keys(o)) {
    if (BN.isBN(o[k])) {
      o[k] = o[k].toString()
    }
  }
  return o
}
