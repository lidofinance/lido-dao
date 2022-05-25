const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn, assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { toBN } = require('../helpers/utils')
const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const keccak256 = require('js-sha3').keccak_256

const LidoOracle = artifacts.require('LidoOracleMock.sol')
const Lido = artifacts.require('LidoMockForOracle.sol')
const BeaconReportReceiver = artifacts.require('BeaconReportReceiverMock')
const BeaconReportReceiverWithoutERC165 = artifacts.require('BeaconReportReceiverMockWithoutERC165')

const GENESIS_TIME = 1606824000
const EPOCH_LENGTH = 32 * 12
const DENOMINATION_OFFSET = 1e9

// initial pooled ether (it's required to smooth increase of balance
// if you jump from 30 to 60 in one epoch it's a huge annual relative jump over 9000%
// but if you jump from 1e12+30 to 1e12+60 then it's smooth small jump as in the real world.
const START_BALANCE = 1e12

contract('LidoOracle', ([appManager, voting, user1, user2, user3, user4, user5, user6, user7, nobody]) => {
  let appBase, appLido, app

  const assertExpectedEpochs = async (startEpoch, endEpoch) => {
    assertBn(await app.getExpectedEpochId(), startEpoch)
    assertBn(await app.getCurrentEpochId(), endEpoch)
  }

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await LidoOracle.new()
    appLido = await Lido.new()
  })

  beforeEach('deploy dao and app', async () => {
    const { dao, acl } = await newDao(appManager)

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    const proxyAddress = await newApp(dao, 'lidooracle', appBase.address, appManager)
    app = await LidoOracle.at(proxyAddress)

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.MANAGE_MEMBERS(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.MANAGE_QUORUM(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_BEACON_SPEC(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_REPORT_BOUNDARIES(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_BEACON_REPORT_RECEIVER(), appManager, { from: appManager })

    // Initialize the app's proxy.
    await app.setTime(GENESIS_TIME)

    assertBn(await app.getVersion(), 0)
    await app.setVersion(1)
    await assertRevert(app.initialize(appLido.address, 1, 32, 12, GENESIS_TIME, 1000, 500), 'BASE_VERSION_MUST_BE_ZERO')
    await app.setVersion(0)

    // 1000 and 500 stand for 10% yearly increase, 5% moment decrease
    await app.initialize(appLido.address, 1, 32, 12, GENESIS_TIME, 1000, 500)
    assertBn(await app.getVersion(), 3)
  })

  it('finalizeUpgrade', async () => {
    const baseVersionRequired = 1
    const latestVersion = 3

    assertBn(await app.getVersion(), latestVersion)
    await assertRevert(app.finalizeUpgrade_v3(), 'WRONG_BASE_VERSION')

    await app.setVersion(baseVersionRequired)

    const receipt = await app.finalizeUpgrade_v3()
    assertEvent(receipt, 'ContractVersionSet', {
      expectedArgs: {
        version: latestVersion
      }
    })

    assertBn(await app.getVersion(), latestVersion)
  })

  it('check not-mocked _getTime()', async () => {
    const block = await ethers.provider.getBlock('latest')
    assertBn(block.timestamp, await app.getTimeOriginal())
  })

  it('beaconSpec is correct', async () => {
    const beaconSpec = await app.getBeaconSpec()
    assertBn(beaconSpec.epochsPerFrame, 1)
    assertBn(beaconSpec.slotsPerEpoch, 32)
    assertBn(beaconSpec.secondsPerSlot, 12)
    assertBn(beaconSpec.genesisTime, GENESIS_TIME)
  })

  it('setBeaconSpec works', async () => {
    await assertRevert(app.setBeaconSpec(0, 1, 1, 1, { from: voting }), 'BAD_EPOCHS_PER_FRAME')
    await assertRevert(app.setBeaconSpec(1, 0, 1, 1, { from: voting }), 'BAD_SLOTS_PER_EPOCH')
    await assertRevert(app.setBeaconSpec(1, 1, 0, 1, { from: voting }), 'BAD_SECONDS_PER_SLOT')
    await assertRevert(app.setBeaconSpec(1, 1, 1, 0, { from: voting }), 'BAD_GENESIS_TIME')

    const receipt = await app.setBeaconSpec(1, 1, 1, 1, { from: voting })
    assertEvent(receipt, 'BeaconSpecSet', {
      expectedArgs: {
        epochsPerFrame: 1,
        slotsPerEpoch: 1,
        secondsPerSlot: 1,
        genesisTime: 1
      }
    })
    const beaconSpec = await app.getBeaconSpec()
    assertBn(beaconSpec.epochsPerFrame, 1)
    assertBn(beaconSpec.slotsPerEpoch, 1)
    assertBn(beaconSpec.secondsPerSlot, 1)
    assertBn(beaconSpec.genesisTime, 1)
  })
  describe('Test utility functions:', function () {
    this.timeout(60000) // addOracleMember edge-case is heavy on execution time

    beforeEach(async () => {
      await app.setTime(GENESIS_TIME)
    })

    it('addOracleMember works', async () => {
      await assertRevert(app.addOracleMember(user1, { from: user1 }), 'APP_AUTH_FAILED')
      await assertRevert(app.addOracleMember('0x0000000000000000000000000000000000000000', { from: voting }), 'BAD_ARGUMENT')

      await app.addOracleMember(user1, { from: voting })
      await assertRevert(app.addOracleMember(user2, { from: user2 }), 'APP_AUTH_FAILED')
      await assertRevert(app.addOracleMember(user3, { from: user2 }), 'APP_AUTH_FAILED')

      await app.addOracleMember(user2, { from: voting })
      await app.addOracleMember(user3, { from: voting })

      await assertRevert(app.addOracleMember(user1, { from: voting }), 'MEMBER_EXISTS')
      await assertRevert(app.addOracleMember(user2, { from: voting }), 'MEMBER_EXISTS')
    })

    it('addOracleMember edge-case', async () => {
      const promises = []
      const maxMembersCount = await app.MAX_MEMBERS()
      for (let i = 0; i < maxMembersCount; ++i) {
        const addr = '0x' + keccak256('member' + i).substring(0, 40)
        promises.push(app.addOracleMember(addr, { from: voting }))
      }
      await Promise.all(promises)

      assertRevert(app.addOracleMember(user4, { from: voting }), 'TOO_MANY_MEMBERS')
    })

    it('removeOracleMember works', async () => {
      await app.addOracleMember(user1, { from: voting })

      await assertRevert(app.removeOracleMember(user1, { from: user1 }), 'APP_AUTH_FAILED')
      await app.removeOracleMember(user1, { from: voting })
      assert.deepStrictEqual(await app.getOracleMembers(), [])

      await app.addOracleMember(user1, { from: voting })
      await app.addOracleMember(user2, { from: voting })
      await app.addOracleMember(user3, { from: voting })

      await assertRevert(app.removeOracleMember(nobody, { from: voting }), 'MEMBER_NOT_FOUND')

      await app.removeOracleMember(user1, { from: voting })
      await app.removeOracleMember(user2, { from: voting })

      await assertRevert(app.removeOracleMember(user2, { from: user1 }), 'APP_AUTH_FAILED')
      assert.deepStrictEqual(await app.getOracleMembers(), [user3])
    })

    it('setQuorum works', async () => {
      await app.addOracleMember(user1, { from: voting })
      await app.addOracleMember(user2, { from: voting })
      await app.addOracleMember(user3, { from: voting })

      await assertRevert(app.setQuorum(2, { from: user1 }), 'APP_AUTH_FAILED')
      await assertRevert(app.setQuorum(0, { from: voting }), 'QUORUM_WONT_BE_MADE')
      await app.setQuorum(4, { from: voting })
      assertBn(await app.getQuorum(), 4)

      await app.setQuorum(3, { from: voting })
      assertBn(await app.getQuorum(), 3)
    })

    it('setQuorum updates expectedEpochId and tries to push', async () => {
      await app.addOracleMember(user1, { from: voting })
      await app.addOracleMember(user2, { from: voting })
      await app.addOracleMember(user3, { from: voting })

      await app.setQuorum(4, { from: voting })

      await appLido.pretendTotalPooledEtherGweiForTest(32)
      await app.reportBeacon(1, 31, 1, { from: user1 })
      await app.reportBeacon(1, 32, 1, { from: user2 })
      await app.reportBeacon(1, 32, 1, { from: user3 })
      await assertExpectedEpochs(1, 0)

      await app.setQuorum(3, { from: voting })
      await assertExpectedEpochs(1, 0)

      const receipt = await app.setQuorum(2, { from: voting })
      assertEvent(receipt, 'Completed', { expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 } })
      await assertExpectedEpochs(2, 0)
    })

    it('getOracleMembers works', async () => {
      await app.addOracleMember(user1, { from: voting })
      await app.addOracleMember(user2, { from: voting })
      await app.addOracleMember(user3, { from: voting })

      assert.deepStrictEqual(await app.getOracleMembers(), [user1, user2, user3])

      await app.removeOracleMember(user1, { from: voting })

      assert.deepStrictEqual(await app.getOracleMembers(), [user3, user2])
    })

    it('getCurrentEpochId works', async () => {
      assertBn(await app.getCurrentEpochId(), 0)
      await app.setTime(GENESIS_TIME + EPOCH_LENGTH - 1)
      assertBn(await app.getCurrentEpochId(), 0)
      await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 123 + 1)
      assertBn(await app.getCurrentEpochId(), 123)
    })

    it('getExpectedEpochId and getLastCompletedEpochId work', async () => {
      assertBn(await app.getExpectedEpochId(), 1)
      assertBn(await app.getLastCompletedEpochId(), 0)

      await app.setTime(GENESIS_TIME + EPOCH_LENGTH - 1)
      assertBn(await app.getExpectedEpochId(), 1)

      await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 123 + 1)
      await app.setQuorum(1, { from: voting })
      await app.addOracleMember(user1, { from: voting })
      await app.reportBeacon(123, 32, 1, { from: user1 })
      assertBn(await app.getExpectedEpochId(), 124)
      assertBn(await app.getLastCompletedEpochId(), 123)
    })

    it('getCurrentFrame works', async () => {
      await app.setBeaconSpec(10, 32, 12, GENESIS_TIME, { from: voting })

      let result = await app.getCurrentFrame()
      assertBn(result.frameEpochId, 0)
      assertBn(result.frameStartTime, GENESIS_TIME)
      assertBn(result.frameEndTime, GENESIS_TIME + EPOCH_LENGTH * 10 - 1)

      await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 10 - 1)
      result = await app.getCurrentFrame()
      assertBn(result.frameEpochId, 0)
      assertBn(result.frameStartTime, GENESIS_TIME)
      assertBn(result.frameEndTime, GENESIS_TIME + EPOCH_LENGTH * 10 - 1)

      await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 123)
      result = await app.getCurrentFrame()
      assertBn(result.frameEpochId, 120)
      assertBn(result.frameStartTime, GENESIS_TIME + EPOCH_LENGTH * 120)
      assertBn(result.frameEndTime, GENESIS_TIME + EPOCH_LENGTH * 130 - 1)
    })
  })

  describe('When there is single-member setup', function () {
    describe('current epoch: 1', function () {
      beforeEach(async () => {
        await app.setTime(GENESIS_TIME)
        await app.addOracleMember(user1, { from: voting })
        await appLido.pretendTotalPooledEtherGweiForTest(START_BALANCE)
      })

      it('if given old eth1 denominated balances just truncates them to 64 bits', async () => {
        const BALANCE = toBN('183216444408705000000000')
        const INT64_MASK = toBN('0xFFFFFFFFFFFFFFFF')
        const BALANCE_TRUNCATED64_GWEI = BALANCE.and(INT64_MASK)
        const BALANCE_TRUNCATED64_WEI = BALANCE_TRUNCATED64_GWEI.mul(toBN(DENOMINATION_OFFSET))
        await appLido.pretendTotalPooledEtherGweiForTest(BALANCE_TRUNCATED64_GWEI)
        const receipt = await app.reportBeacon(1, BALANCE, 5692, { from: user1 })
        assertEvent(receipt, 'BeaconReported', {
          expectedArgs: {
            epochId: 1,
            beaconBalance: BALANCE_TRUNCATED64_WEI,
            beaconValidators: 5692,
            caller: user1
          }
        })
      })

      it('accepts new eth2 denominated balances, no trunc', async () => {
        const BALANCE_GWEI = toBN('183216444408705')
        const BALANCE_WEI = BALANCE_GWEI.mul(toBN(DENOMINATION_OFFSET))
        await appLido.pretendTotalPooledEtherGweiForTest(BALANCE_GWEI)
        const receipt = await app.reportBeacon(1, BALANCE_GWEI, 5692, { from: user1 })
        assertEvent(receipt, 'BeaconReported', {
          expectedArgs: { epochId: 1, beaconBalance: BALANCE_WEI, beaconValidators: 5692, caller: user1 }
        })
      })

      it('reverts when trying to report from non-member', async () => {
        await assertRevert(app.reportBeacon(1, 32, 1, { from: nobody }), 'MEMBER_NOT_FOUND')
      })

      it('reverts when trying to report from non-member', async () => {
        for (const account of [user2, user3, user4, nobody])
          await assertRevert(app.reportBeacon(1, 32, 1, { from: account }), 'MEMBER_NOT_FOUND')
      })

      it('reportBeacon works and emits event, getLastCompletedReportDelta tracks last 2 reports', async () => {
        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 1) // 1 epoch later
        const prePooledEther = START_BALANCE + 32
        let receipt = await app.reportBeacon(1, prePooledEther, 1, { from: user1 })
        assertEvent(receipt, 'Completed', {
          expectedArgs: { epochId: 1, beaconBalance: prePooledEther * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
        assertEvent(receipt, 'PostTotalShares', {
          expectedArgs: {
            postTotalPooledEther: prePooledEther * DENOMINATION_OFFSET,
            preTotalPooledEther: START_BALANCE * DENOMINATION_OFFSET,
            timeElapsed: EPOCH_LENGTH * 1,
            totalShares: 42
          }
        })
        await assertExpectedEpochs(2, 1)

        let res = await app.getLastCompletedReportDelta()
        assertBn(res.postTotalPooledEther, toBN(prePooledEther).mul(toBN(DENOMINATION_OFFSET)))
        assertBn(res.preTotalPooledEther, toBN(START_BALANCE).mul(toBN(DENOMINATION_OFFSET)))
        assertBn(res.timeElapsed, EPOCH_LENGTH * 1)

        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 3) // 2 epochs later
        const postPooledEther = prePooledEther + 99
        receipt = await app.reportBeacon(3, postPooledEther, 3, { from: user1 })
        assertEvent(receipt, 'Completed', {
          expectedArgs: { epochId: 3, beaconBalance: postPooledEther * DENOMINATION_OFFSET, beaconValidators: 3 }
        })
        assertEvent(receipt, 'PostTotalShares', {
          expectedArgs: {
            postTotalPooledEther: postPooledEther * DENOMINATION_OFFSET,
            preTotalPooledEther: prePooledEther * DENOMINATION_OFFSET,
            timeElapsed: EPOCH_LENGTH * 2,
            totalShares: 42
          }
        })
        await assertExpectedEpochs(4, 3)

        res = await app.getLastCompletedReportDelta()
        assertBn(res.postTotalPooledEther, toBN(postPooledEther).mul(toBN(DENOMINATION_OFFSET)))
        assertBn(res.preTotalPooledEther, toBN(prePooledEther).mul(toBN(DENOMINATION_OFFSET)))
        assertBn(res.timeElapsed, EPOCH_LENGTH * 2)
      })

      it('reportBeacon works OK on OK pooledEther increase', async () => {
        const beginPooledEther = START_BALANCE
        let receipt = await app.reportBeacon(1, beginPooledEther, 1, { from: user1 })
        assertEvent(receipt, 'Completed', {
          expectedArgs: { epochId: 1, beaconBalance: beginPooledEther * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
        await assertExpectedEpochs(2, 0)

        const reward = Math.round((START_BALANCE * (768 / 365 / 24 / 3600) * 9) / 100) // annual increase by 9%
        const nextPooledEther = beginPooledEther + reward
        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 3) // 2 epochs later (timeElapsed = 768)
        receipt = await app.reportBeacon(3, nextPooledEther, 3, { from: user1 })
        assertEvent(receipt, 'Completed', {
          expectedArgs: { epochId: 3, beaconBalance: nextPooledEther * DENOMINATION_OFFSET, beaconValidators: 3 }
        })
      })

      it('reportBeacon reverts on too high pooledEther increase', async () => {
        const beginPooledEther = START_BALANCE
        const receipt = await app.reportBeacon(1, beginPooledEther, 1, { from: user1 })
        assertEvent(receipt, 'Completed', {
          expectedArgs: { epochId: 1, beaconBalance: beginPooledEther * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
        await assertExpectedEpochs(2, 0)

        const reward = Math.round((START_BALANCE * (768 / 365 / 24 / 3600) * 11) / 100) // annual increase by 11%
        const nextPooledEther = beginPooledEther + reward
        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 3) // 2 epochs later (timeElapsed = 768)
        await assertRevert(app.reportBeacon(3, nextPooledEther, 3, { from: user1 }), 'ALLOWED_BEACON_BALANCE_INCREASE')
      })

      it('reportBeacon works OK on OK pooledEther decrease', async () => {
        const beginPooledEther = START_BALANCE
        let receipt = await app.reportBeacon(1, beginPooledEther, 1, { from: user1 })
        assertEvent(receipt, 'Completed', {
          expectedArgs: { epochId: 1, beaconBalance: beginPooledEther * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
        await assertExpectedEpochs(2, 0)

        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 3) // 2 epochs later (timeElapsed = 768)
        const loss = Math.round((START_BALANCE * 4) / 100) // decrease by 4%
        const nextPooledEther = beginPooledEther - loss
        receipt = await app.reportBeacon(3, nextPooledEther, 3, { from: user1 })
        assertEvent(receipt, 'Completed', {
          expectedArgs: { epochId: 3, beaconBalance: nextPooledEther * DENOMINATION_OFFSET, beaconValidators: 3 }
        })
      })

      it('reportBeacon reverts on too high pooledEther decrease', async () => {
        const beginPooledEther = START_BALANCE
        const receipt = await app.reportBeacon(1, beginPooledEther, 1, { from: user1 })
        assertEvent(receipt, 'Completed', {
          expectedArgs: { epochId: 1, beaconBalance: beginPooledEther * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
        await assertExpectedEpochs(2, 0)

        const loss = Math.round((START_BALANCE * 6) / 100) // decrease by 6%
        const nextPooledEther = beginPooledEther - loss
        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 3) // 2 epochs later (timeElapsed = 768)
        await assertRevert(app.reportBeacon(3, nextPooledEther, 3, { from: user1 }), 'ALLOWED_BEACON_BALANCE_DECREASE')
      })

      it('reportBeacon change increase limit works', async () => {
        let res = await app.setAllowedBeaconBalanceAnnualRelativeIncrease(42, { from: voting })
        assertEvent(res, 'AllowedBeaconBalanceAnnualRelativeIncreaseSet', { expectedArgs: { value: 42 } })
        let limit = await app.getAllowedBeaconBalanceAnnualRelativeIncrease()
        assertBn(limit, 42)

        res = await app.setAllowedBeaconBalanceAnnualRelativeIncrease(777, { from: voting })
        assertEvent(res, 'AllowedBeaconBalanceAnnualRelativeIncreaseSet', { expectedArgs: { value: 777 } })
        limit = await app.getAllowedBeaconBalanceAnnualRelativeIncrease()
        assertBn(limit, 777)
      })

      it('reportBeacon change decrease limit works', async () => {
        let res = await app.setAllowedBeaconBalanceRelativeDecrease(42, { from: voting })
        assertEvent(res, 'AllowedBeaconBalanceRelativeDecreaseSet', { expectedArgs: { value: 42 } })
        let limit = await app.getAllowedBeaconBalanceRelativeDecrease()
        assertBn(limit, 42)

        res = await app.setAllowedBeaconBalanceRelativeDecrease(777, { from: voting })
        assertEvent(res, 'AllowedBeaconBalanceRelativeDecreaseSet', { expectedArgs: { value: 777 } })
        limit = await app.getAllowedBeaconBalanceRelativeDecrease()
        assertBn(limit, 777)
      })

      it('reportBeacon change increase limit affect sanity checks', async () => {
        const beginPooledEther = START_BALANCE
        let receipt = await app.reportBeacon(1, beginPooledEther, 1, { from: user1 })
        assertEvent(receipt, 'Completed', {
          expectedArgs: { epochId: 1, beaconBalance: beginPooledEther * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
        await assertExpectedEpochs(2, 0)

        const reward = Math.round((START_BALANCE * (768 / 365 / 24 / 3600) * 11) / 100) // annual increase by 11%
        const nextPooledEther = beginPooledEther + reward
        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 3) // 2 epochs later (timeElapsed = 768)

        // check fails
        await assertRevert(app.reportBeacon(2, nextPooledEther, 3, { from: user1 }), 'ALLOWED_BEACON_BALANCE_INCREASE')

        // set limit up to 12%
        const res = await app.setAllowedBeaconBalanceAnnualRelativeIncrease(1200, { from: voting })
        assertEvent(res, 'AllowedBeaconBalanceAnnualRelativeIncreaseSet', { expectedArgs: { value: 1200 } })

        // check OK
        receipt = await app.reportBeacon(3, nextPooledEther, 3, { from: user1 })
        assertEvent(receipt, 'Completed', {
          expectedArgs: { epochId: 3, beaconBalance: nextPooledEther * DENOMINATION_OFFSET, beaconValidators: 3 }
        })
      })

      it('reportBeacon change decrease limit affect sanity checks', async () => {
        const beginPooledEther = START_BALANCE
        let receipt = await app.reportBeacon(1, beginPooledEther, 1, { from: user1 })
        assertEvent(receipt, 'Completed', {
          expectedArgs: { epochId: 1, beaconBalance: beginPooledEther * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
        await assertExpectedEpochs(2, 0)

        const loss = Math.round((START_BALANCE * 6) / 100) // decrease by 6%
        const nextPooledEther = beginPooledEther - loss
        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 3) // 2 epochs later (timeElapsed = 768)

        // check fails
        await assertRevert(app.reportBeacon(3, nextPooledEther, 3, { from: user1 }), 'ALLOWED_BEACON_BALANCE_DECREASE')

        // set limit up to 7%
        const res = await app.setAllowedBeaconBalanceRelativeDecrease(700, { from: voting })
        assertEvent(res, 'AllowedBeaconBalanceRelativeDecreaseSet', { expectedArgs: { value: 700 } })

        // check OK
        receipt = await app.reportBeacon(3, nextPooledEther, 3, { from: user1 })
        assertEvent(receipt, 'Completed', {
          expectedArgs: { epochId: 3, beaconBalance: nextPooledEther * DENOMINATION_OFFSET, beaconValidators: 3 }
        })
      })

      it('reportBeacon time affect increase sanity checks', async () => {
        const beginPooledEther = START_BALANCE
        let receipt = await app.reportBeacon(1, beginPooledEther, 1, { from: user1 })
        assertEvent(receipt, 'Completed', {
          expectedArgs: { epochId: 1, beaconBalance: beginPooledEther * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
        await assertExpectedEpochs(2, 0)

        const reward = Math.round((START_BALANCE * (768 / 365 / 24 / 3600) * 19) / 100) // annual increase by 19%
        const nextPooledEther = beginPooledEther + reward
        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 3) // 2 epochs later (timeElapsed = 768)

        // check fails
        await assertRevert(app.reportBeacon(3, nextPooledEther, 3, { from: user1 }), 'ALLOWED_BEACON_BALANCE_INCREASE')

        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 5) // 4 epochs later (timeElapsed = 768*2)
        // check OK because 4 epochs passed
        receipt = await app.reportBeacon(5, nextPooledEther, 3, { from: user1 })
        assertEvent(receipt, 'Completed', {
          expectedArgs: { epochId: 5, beaconBalance: nextPooledEther * DENOMINATION_OFFSET, beaconValidators: 3 }
        })
      })

      it('reportBeacon time does not affect decrease sanity checks', async () => {
        const beginPooledEther = START_BALANCE
        const receipt = await app.reportBeacon(1, beginPooledEther, 1, { from: user1 })
        assertEvent(receipt, 'Completed', {
          expectedArgs: { epochId: 1, beaconBalance: beginPooledEther * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
        await assertExpectedEpochs(2, 0)

        const reward = Math.round(START_BALANCE * (6 / 100)) // annual increase by 6%
        const nextPooledEther = beginPooledEther + reward
        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 3) // 2 epochs later (timeElapsed = 768)

        // check fails
        await assertRevert(app.reportBeacon(3, nextPooledEther, 3, { from: user1 }), 'ALLOWED_BEACON_BALANCE_INCREASE')

        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 5) // 4 epochs later (timeElapsed = 768*2)
        // check fails but 4 epochs passed
        await assertRevert(app.reportBeacon(5, nextPooledEther, 3, { from: user1 }), 'ALLOWED_BEACON_BALANCE_INCREASE')
      })

      it('setBeaconReportReceiver to 0x0', async () => {
        const receipt = await app.setBeaconReportReceiver(ZERO_ADDRESS, { from: voting })
        assertEvent(receipt, 'BeaconReportReceiverSet', { expectedArgs: { callback: ZERO_ADDRESS } })
        assert((await app.getBeaconReportReceiver()) === ZERO_ADDRESS)
      })

      it('setBeaconReportReceiver failed auth', async () => {
        await assertRevert(app.setBeaconReportReceiver(ZERO_ADDRESS, { from: user1 }), 'APP_AUTH_FAILED')
      })

      it('quorum receiver called with same arguments as getLastCompletedReportDelta', async () => {
        const badMock = await BeaconReportReceiverWithoutERC165.new()
        await assertRevert(app.setBeaconReportReceiver(badMock.address, { from: voting }), 'BAD_BEACON_REPORT_RECEIVER')

        const mock = await BeaconReportReceiver.new()
        let receipt = await app.setBeaconReportReceiver(mock.address, { from: voting })
        assertEvent(receipt, 'BeaconReportReceiverSet', { expectedArgs: { callback: mock.address } })
        assert((await app.getBeaconReportReceiver()) === mock.address)

        receipt = await app.reportBeacon(1, START_BALANCE + 35, 1, { from: user1 })
        assertEvent(receipt, 'Completed', {
          expectedArgs: { epochId: 1, beaconBalance: (START_BALANCE + 35) * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
        await assertExpectedEpochs(2, 0)

        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 2) // 1 epochs later
        receipt = await app.reportBeacon(2, START_BALANCE + 77, 3, { from: user1 })
        assertEvent(receipt, 'Completed', {
          expectedArgs: { epochId: 2, beaconBalance: (START_BALANCE + 77) * DENOMINATION_OFFSET, beaconValidators: 3 }
        })
        await assertExpectedEpochs(3, 2)

        assertBn(await mock.postTotalPooledEther(), toBN(START_BALANCE + 77).mul(toBN(DENOMINATION_OFFSET)))
        assertBn(await mock.preTotalPooledEther(), toBN(START_BALANCE + 35).mul(toBN(DENOMINATION_OFFSET)))
        assertBn(await mock.timeElapsed(), EPOCH_LENGTH)

        const res = await app.getLastCompletedReportDelta()
        assertBn(res.postTotalPooledEther, toBN(START_BALANCE + 77).mul(toBN(DENOMINATION_OFFSET)))
        assertBn(res.preTotalPooledEther, toBN(START_BALANCE + 35).mul(toBN(DENOMINATION_OFFSET)))
        assertBn(res.timeElapsed, EPOCH_LENGTH)
      })

      it('reverts when trying to report this epoch again', async () => {
        await app.reportBeacon(1, START_BALANCE, 1, { from: user1 }) // got quorum
        await assertExpectedEpochs(2, 0)
        await assertRevert(app.reportBeacon(1, START_BALANCE, 1, { from: user1 }), 'EPOCH_IS_TOO_OLD')
      })

      it('reverts when trying to report future epoch', async () => {
        await assertRevert(app.reportBeacon(2, 32, 1, { from: user1 }), 'UNEXPECTED_EPOCH')
      })
      describe(`current epoch: 5`, function () {
        beforeEach(async () => {
          await appLido.pretendTotalPooledEtherGweiForTest(32)
          await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 5)
          await assertExpectedEpochs(1, 5)
        })

        it('reverts when trying to report stale epoch', async () => {
          await assertRevert(app.reportBeacon(0, 32, 1, { from: user1 }), 'EPOCH_IS_TOO_OLD')
          await assertExpectedEpochs(1, 5)
        })

        it('reverts when trying to report this epoch again from the same user', async () => {
          await app.setQuorum(2, { from: voting })
          await app.reportBeacon(5, 32, 1, { from: user1 })
          await assertRevert(app.reportBeacon(5, 32, 1, { from: user1 }), 'ALREADY_SUBMITTED')
          await assertExpectedEpochs(5, 5)
        })

        it('reverts when trying to report future epoch', async () => {
          await assertRevert(app.reportBeacon(10, 32, 1, { from: user1 }), 'UNEXPECTED_EPOCH')
        })

        it('reportBeacon works and emits event', async () => {
          const receipt = await app.reportBeacon(5, 32, 1, { from: user1 })
          assertEvent(receipt, 'Completed', { expectedArgs: { epochId: 5, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 } })
          await assertExpectedEpochs(6, 5)
        })
      })
    })
  })
  describe('When there is multi-member setup (7 members, default quorum is 7)', function () {
    beforeEach(async () => {
      await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 1)
      await assertExpectedEpochs(1, 1)
      for (const account of [user1, user2, user3, user4, user5, user6, user7]) await app.addOracleMember(account, { from: voting })
      await app.setQuorum(7, { from: voting })
    })

    it('removeOracleMember updates expectedEpochId and clears current reporting', async () => {
      await app.reportBeacon(1, 0, 0, { from: user1 })
      await app.reportBeacon(1, 32, 1, { from: user2 })
      await assertExpectedEpochs(1, 1)
      assertBn(await app.getCurrentOraclesReportStatus(), 0b011)
      assertBn(await app.getCurrentReportVariantsSize(), 2)

      await app.removeOracleMember(user1, { from: voting })
      await assertExpectedEpochs(1, 1)
      assertBn(await app.getCurrentOraclesReportStatus(), 0b000)
      assertBn(await app.getCurrentReportVariantsSize(), 0)

      // user2 reports again the same epoch
      await app.reportBeacon(1, 32, 1, { from: user2 })
      await assertExpectedEpochs(1, 1)
      assertBn(await app.getCurrentOraclesReportStatus(), 0b010)
      assertBn(await app.getCurrentReportVariantsSize(), 1)
    })

    it('getCurrentOraclesReportStatus/VariantSize/Variant', async () => {
      assertBn(await app.getCurrentOraclesReportStatus(), 0b000)
      assertBn(await app.getCurrentReportVariantsSize(), 0)

      await app.reportBeacon(1, 32, 1, { from: user1 })
      assertBn(await app.getCurrentOraclesReportStatus(), 0b001)
      assertBn(await app.getCurrentReportVariantsSize(), 1)

      await app.reportBeacon(1, 101, 11, { from: user2 })
      assertBn(await app.getCurrentOraclesReportStatus(), 0b011)
      assertBn(await app.getCurrentReportVariantsSize(), 2)

      await app.reportBeacon(1, 32, 1, { from: user3 })
      assertBn(await app.getCurrentOraclesReportStatus(), 0b111)
      assertBn(await app.getCurrentReportVariantsSize(), 2)

      const firstKind = await app.getCurrentReportVariant(0)
      assertBn(firstKind.beaconBalance, 32)
      assertBn(firstKind.beaconValidators, 1)
      assertBn(firstKind.count, 2)
      const secondKind = await app.getCurrentReportVariant(1)
      assertBn(secondKind.beaconBalance, 101)
      assertBn(secondKind.beaconValidators, 11)
      assertBn(secondKind.count, 1)

      const receipt = await app.setQuorum(2, { from: voting })
      assertEvent(receipt, 'Completed', { expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 } })
      assertBn(await app.getCurrentOraclesReportStatus(), 0b000)
      assertBn(await app.getCurrentReportVariantsSize(), 0)
    })
    describe('reportBeacon reaches quorum', function () {
      it('reportBeacon works and emits event', async () => {
        for (const acc of [user1, user2, user3, user4, user5, user6]) {
          const receipt = await app.reportBeacon(1, 32, 1, { from: acc })
          await assertExpectedEpochs(1, 1)
          assertEvent(receipt, 'BeaconReported', {
            expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1, caller: acc }
          })
        }

        const receipt = await app.reportBeacon(1, 32, 1, { from: user7 })
        assertEvent(receipt, 'BeaconReported', {
          expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1, caller: user7 }
        })
        assertEvent(receipt, 'Completed', { expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 } })
      })

      it('reverts when trying to report this epoch again', async () => {
        for (const account of [user1, user2, user3, user4, user5, user6]) await app.reportBeacon(1, 32, 1, { from: account })
        await assertExpectedEpochs(1, 1)

        for (const account of [user1, user2, user3, user4, user5, user6])
          await assertRevert(app.reportBeacon(1, 32, 1, { from: account }), 'ALREADY_SUBMITTED')
        await assertExpectedEpochs(1, 1)
      })

      it('6 oracles push alike, 1 miss', async () => {
        for (const acc of [user1, user2, user3, user4, user5, user6]) {
          await app.reportBeacon(1, 32, 1, { from: acc })
          await assertExpectedEpochs(1, 1)
        }

        const receipt = await app.reportBeacon(1, 32, 1, { from: user7 })
        assertEvent(receipt, 'Completed', { expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 } })
      })

      it('oracles part 3+3, no quorum for 4', async () => {
        await app.setQuorum(4, { from: voting })
        await app.reportBeacon(1, 64, 2, { from: user1 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 64, 2, { from: user2 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 65, 3, { from: user3 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 65, 3, { from: user4 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 64, 2, { from: user5 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 65, 3, { from: user6 })
        await assertExpectedEpochs(1, 1)
      })

      it('oracles part 3+3, got quorum for 3', async () => {
        await app.setQuorum(3, { from: voting })
        await app.reportBeacon(1, 64, 2, { from: user1 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 32, 1, { from: user2 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 32, 1, { from: user3 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 64, 2, { from: user4 })
        await assertExpectedEpochs(1, 1)
        const receipt = await app.reportBeacon(1, 32, 1, { from: user5 })
        assertEvent(receipt, 'Completed', { expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 } })
      })

      it('oracles part 4+3, got quorum for 4', async () => {
        await app.setQuorum(4, { from: voting })
        await app.reportBeacon(1, 32, 1, { from: user1 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 32, 1, { from: user2 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 32, 1, { from: user3 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 65, 3, { from: user4 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 65, 3, { from: user5 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 65, 3, { from: user6 })
        await assertExpectedEpochs(1, 1)
        const receipt = await app.reportBeacon(1, 32, 1, { from: user7 })
        assertEvent(receipt, 'Completed', { expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 } })
      })

      it('oracles part 5+2, got quorum for 5', async () => {
        await app.setQuorum(5, { from: voting })
        await app.reportBeacon(1, 65, 2, { from: user1 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 32, 1, { from: user2 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 32, 1, { from: user3 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 32, 1, { from: user4 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 65, 3, { from: user5 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 32, 1, { from: user6 })
        await assertExpectedEpochs(1, 1)
        const receipt = await app.reportBeacon(1, 32, 1, { from: user7 })
        assertEvent(receipt, 'Completed', { expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 } })
      })

      it('only 1 report is enough in quorum l1', async () => {
        await app.setQuorum(1, { from: voting })
        const receipt = await app.reportBeacon(1, 32, 1, { from: user1 })
        assertEvent(receipt, 'Completed', { expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 } })
      })

      it('only 2 alike report is enough in quorum 2', async () => {
        await app.setQuorum(2, { from: voting })
        await app.reportBeacon(1, 32, 1, { from: user1 })
        await app.reportBeacon(1, 33, 2, { from: user2 })
        await app.reportBeacon(1, 34, 3, { from: user3 })
        await app.reportBeacon(1, 0, 0, { from: user4 })
        const receipt = await app.reportBeacon(1, 32, 1, { from: user5 })
        assertEvent(receipt, 'Completed', { expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 } })
      })
    })
    describe('setQuorum lowering reaches quorum', function () {
      it('6 oracles push alike, 1 miss', async () => {
        for (const acc of [user1, user2, user3, user4, user5, user6]) {
          await app.reportBeacon(1, 32, 1, { from: acc })
          await assertExpectedEpochs(1, 1)
        }

        await app.setQuorum(8, { from: voting }) // no quorum for 8
        await assertExpectedEpochs(1, 1)

        const receipt = await app.setQuorum(6, { from: voting })
        assertEvent(receipt, 'Completed', { expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 } })
      })

      it('oracles part 3+3, no quorum here at all', async () => {
        await app.reportBeacon(1, 64, 2, { from: user1 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 64, 2, { from: user2 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 64, 2, { from: user3 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 65, 3, { from: user4 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 65, 3, { from: user5 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 65, 3, { from: user6 })
        await assertExpectedEpochs(1, 1)

        // decreasing quorum does not help because colflicting parts are equal
        await app.setQuorum(3, { from: voting })
        await assertExpectedEpochs(1, 1)
        await app.setQuorum(1, { from: voting })
        await assertExpectedEpochs(1, 1)
      })

      it('oracles part 4+3, quorum lowers to 4', async () => {
        await app.reportBeacon(1, 32, 1, { from: user1 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 32, 1, { from: user2 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 32, 1, { from: user3 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 65, 3, { from: user4 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 65, 3, { from: user5 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 65, 3, { from: user6 })
        await assertExpectedEpochs(1, 1)
        await app.reportBeacon(1, 32, 1, { from: user7 })
        await assertExpectedEpochs(1, 1)

        // decreasing quorum to 5 does not help
        await app.setQuorum(5, { from: voting })
        await assertExpectedEpochs(1, 1)

        receipt = await app.setQuorum(4, { from: voting })
        assertEvent(receipt, 'Completed', { expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 } })
      })

      it('only 1 report is enough in quorum loweres to 1', async () => {
        await app.reportBeacon(1, 32, 1, { from: user1 })
        await assertExpectedEpochs(1, 1)

        const receipt = await app.setQuorum(1, { from: voting })
        assertEvent(receipt, 'Completed', { expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 } })
      })
    })
  })
})
