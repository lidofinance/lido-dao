const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn, assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { bn } = require('@aragon/contract-helpers-test')

const LidoOracle = artifacts.require('TestLidoOracle.sol')
const Algorithm = artifacts.require('TestAlgorithm.sol')

contract('Algorithm', ([testUser]) => {
  let algorithm

  before('deploy base app', async () => {
    algorithm = await Algorithm.new()
  })

  it('mode function works', async () => {
    let r

    r = await algorithm.modeTest(['1', '2', '3', '1'], { from: testUser })
    assert(r.isUnimodal === true)
    assertBn(r.mode, bn(1))

    r = await algorithm.modeTest(['1', '1', '2', '2'], { from: testUser })
    assert(r.isUnimodal === false)
    assertBn(r.mode, bn(0))

    r = await algorithm.modeTest(['1', '2', '2', '2'], { from: testUser })
    assert(r.isUnimodal === true)
    assertBn(r.mode, bn(2))
  })
})

contract('LidoOracle', ([appManager, voting, user1, user2, user3, user4, nobody]) => {
  let appBase, app

  const assertReportableEpochs = async (startEpoch, endEpoch) => {
    const result = await app.getCurrentReportableEpochs()
    assertBn(result.firstReportableEpochId, startEpoch)
    assertBn(result.lastReportableEpochId, endEpoch)
  }

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await LidoOracle.new()
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

    // Initialize the app's proxy.
    await app.initialize('0x0000000000000000000000000000000000000000', 1, 32, 12, 1606824000)
  })

  it('beaconSpec is correct', async () => {
    const beaconSpec = await app.beaconSpec()
    assertBn(beaconSpec.slotsPerEpoch, 32)
    assertBn(beaconSpec.secondsPerSlot, 12)
    assertBn(beaconSpec.genesisTime, 1606824000)
  })

  describe('Test utility functions:', function () {
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

    it('removeOracleMember works', async () => {
      await app.addOracleMember(user1, { from: voting })

      await assertRevert(app.removeOracleMember(user1, { from: user1 }), 'APP_AUTH_FAILED')
      await assertRevert(app.removeOracleMember(user1, { from: voting }), 'QUORUM_WONT_BE_MADE')

      await app.addOracleMember(user2, { from: voting })
      await app.addOracleMember(user3, { from: voting })

      await assertRevert(app.removeOracleMember(nobody, { from: voting }), 'MEMBER_NOT_FOUND')

      await app.removeOracleMember(user1, { from: voting })
      await app.removeOracleMember(user2, { from: voting })

      await assertRevert(app.removeOracleMember(user2, { from: user1 }), 'APP_AUTH_FAILED')
      await assertRevert(app.removeOracleMember(user3, { from: voting }), 'QUORUM_WONT_BE_MADE')

      assert.deepStrictEqual(await app.getOracleMembers(), [user3])
    })

    it('setQuorum works', async () => {
      await app.setTime(1606824000)

      await app.addOracleMember(user1, { from: voting })
      await app.addOracleMember(user2, { from: voting })
      await app.addOracleMember(user3, { from: voting })

      await assertRevert(app.setQuorum(2, { from: user1 }), 'APP_AUTH_FAILED')
      await assertRevert(app.setQuorum(0, { from: voting }), 'QUORUM_WONT_BE_MADE')
      await assertRevert(app.setQuorum(4, { from: voting }), 'QUORUM_WONT_BE_MADE')

      await app.setQuorum(3, { from: voting })
      assertBn(await app.getQuorum(), 3)
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
      await app.setTime(1606824000)
      assertBn(await app.getCurrentEpochId(), 0)
      await app.setTime(1606824000 + 32 * 12 - 1)
      assertBn(await app.getCurrentEpochId(), 0)
      await app.setTime(1606824000 + 32 * 12 * 123 + 1)
      assertBn(await app.getCurrentEpochId(), 123)
    })

    it('getCurrentReportableEpochs works', async () => {
      let result

      await app.setTime(1606824000)
      result = await app.getCurrentReportableEpochs()
      assertBn(result.firstReportableEpochId, 0)
      assertBn(result.lastReportableEpochId, 0)

      await app.setTime(1606824000 + 32 * 12 - 1)
      result = await app.getCurrentReportableEpochs()
      assertBn(result.firstReportableEpochId, 0)
      assertBn(result.lastReportableEpochId, 0)

      await app.setTime(1606824000 + 32 * 12 * 123 + 1)
      result = await app.getCurrentReportableEpochs()
      assertBn(result.firstReportableEpochId, 0)
      assertBn(result.lastReportableEpochId, 123)
    })

    it('getCurrentFrame works', async () => {
      await app.setBeaconSpec(10, 32, 12, 1606824000, { from: voting })

      let result

      await app.setTime(1606824000)
      result = await app.getCurrentFrame()
      assertBn(result.frameEpochId, 0)
      assertBn(result.frameStartTime, 1606824000)
      assertBn(result.frameEndTime, 1606824000 + 32 * 12 * 10 - 1)

      await app.setTime(1606824000 + 32 * 12 * 10 - 1)
      result = await app.getCurrentFrame()
      assertBn(result.frameEpochId, 0)
      assertBn(result.frameStartTime, 1606824000)
      assertBn(result.frameEndTime, 1606824000 + 32 * 12 * 10 - 1)

      await app.setTime(1606824000 + 32 * 12 * 123)
      result = await app.getCurrentFrame()
      assertBn(result.frameEpochId, 120)
      assertBn(result.frameStartTime, 1606824000 + 32 * 12 * 120)
      assertBn(result.frameEndTime, 1606824000 + 32 * 12 * 130 - 1)
    })
  })

  describe('When there is single-member setup', function () {
    describe('current time: 1606824000 , current epoch: 0', function () {
      beforeEach(async () => {
        await app.setTime(1606824000)
        await app.addOracleMember(user1, { from: voting })
        assertBn(await app.getQuorum(), 1)
      })

      it('reverts when trying to report from non-member', async () => {
        for (const account of [user2, user3, user4, nobody])
          await assertRevert(app.reportBeacon(0, 32, 1, { from: account }), 'MEMBER_NOT_FOUND')
      })

      it('reportBeacon works and emits event', async () => {
        const receipt = await app.reportBeacon(0, 32, 1, { from: user1 })
        assertEvent(receipt, "Completed", { expectedArgs: { epochId: 0, beaconBalance: 32, beaconValidators: 1 }})
        await assertReportableEpochs(1, 0)
      })

      it('reverts when trying to report this epoch again', async () => {
        await app.reportBeacon(0, 32, 1, { from: user1 })
        await assertRevert(app.reportBeacon(0, 32, 1, { from: user1 }), 'EPOCH_IS_TOO_OLD')
        await assertReportableEpochs(1, 0)
      })

      it('reverts when trying to report future epoch', async () => {
        await assertRevert(app.reportBeacon(1, 32, 1, { from: user1 }), 'EPOCH_HAS_NOT_YET_BEGUN')
      })

      describe(`current time: ${1606824000 + 32 * 12 * 5}, current epoch: 5`, function () {
        beforeEach(async () => {
          await app.reportBeacon(0, 32, 1, { from: user1 })
          await app.setTime(1606824000 + 32 * 12 * 5)
          await assertReportableEpochs(1, 5)
        })

        it('reverts when trying to report stale epoch', async () => {
          await assertRevert(app.reportBeacon(0, 32, 1, { from: user1 }), 'EPOCH_IS_TOO_OLD')
          await assertReportableEpochs(1, 5)
        })

        it('reportBeacon works and emits event', async () => {
          const receipt = await app.reportBeacon(5, 32, 1, { from: user1 })
          assertEvent(receipt, "Completed", { expectedArgs: { epochId: 5, beaconBalance: 32, beaconValidators: 1 }})
          await assertReportableEpochs(6, 5)
        })
      })
    })
  })

  describe('When there is multi-member setup (4 members)', function () {
    beforeEach(async () => {
      await app.addOracleMember(user1, { from: voting })
      await app.addOracleMember(user2, { from: voting })
      await app.addOracleMember(user3, { from: voting })
      await app.addOracleMember(user4, { from: voting })
    })

    describe('current time: 1606824000 , current epoch: 0', function () {
      beforeEach(async () => {
        await app.setTime(1606824000)
        await app.setQuorum(3, { from: voting })
        assertBn(await app.getQuorum(), 3)
      })

      it('reverts when trying to report from non-member', async () => {
        await assertRevert(app.reportBeacon(0, 32, 1, { from: nobody }), 'MEMBER_NOT_FOUND')
      })

      it('reportBeacon works and emits event', async () => {
        await app.reportBeacon(0, 32, 1, { from: user1 })
        await assertReportableEpochs(0, 0)
        await app.reportBeacon(0, 32, 1, { from: user2 })
        await assertReportableEpochs(0, 0)
        const receipt = await app.reportBeacon(0, 32, 1, { from: user3 })
        assertEvent(receipt, "Completed", { expectedArgs: { epochId: 0, beaconBalance: 32, beaconValidators: 1 }})
        await assertReportableEpochs(1, 0)
      })

      it('reportBeacon completes only if data is unimodal', async () => {
        let receipt

        await app.reportBeacon(0, 32, 1, { from: user1 })
        await assertReportableEpochs(0, 0)
        await app.reportBeacon(0, 33, 1, { from: user2 })
        await assertReportableEpochs(0, 0)
        await app.reportBeacon(0, 65, 2, { from: user3 }) // data is not unimodal, quorum is not reached
        await assertReportableEpochs(0, 0)
        receipt = await app.reportBeacon(0, 65, 2, { from: user4 }) // data is unimodal, quorum is reached
        assertEvent(receipt, "Completed", { expectedArgs: { epochId: 0, beaconBalance: 65, beaconValidators: 2 }})
        await assertReportableEpochs(1, 0)

        await app.setTime(1606824000 + 32 * 12)
        await app.setQuorum(4, { from: voting})
        await assertReportableEpochs(1, 1)

        await app.reportBeacon(1, 64, 2, { from: user1 })
        await assertReportableEpochs(1, 1)
        await app.reportBeacon(1, 65, 2, { from: user2 })
        await assertReportableEpochs(1, 1)
        await app.reportBeacon(1, 97, 3, { from: user3 })
        await assertReportableEpochs(1, 1)
        await app.reportBeacon(1, 98, 3, { from: user4 }) // data is not unimodal, quorum is not reached
        await assertReportableEpochs(1, 1)

        await app.setTime(1606824000 + 32 * 12 * 2)
        await assertReportableEpochs(1, 2)

        await app.reportBeacon(2, 99, 3, { from: user1 })
        await assertReportableEpochs(1, 2)
        receipt = await await app.setQuorum(1, { from: voting})
        assertEvent(receipt, "Completed", { expectedArgs: { epochId: 2, beaconBalance: 99, beaconValidators: 3 }})
        await assertReportableEpochs(3, 2)
      })

      it('reverts when trying to report this epoch again', async () => {
        await app.reportBeacon(0, 32, 1, { from: user1 })
        await app.reportBeacon(0, 32, 1, { from: user2 })
        await app.reportBeacon(0, 32, 1, { from: user3 })

        for (const account of [user1, user2, user3, user4])
          await assertRevert(app.reportBeacon(0, 32, 1, { from: account }), 'EPOCH_IS_TOO_OLD')

        await assertReportableEpochs(1, 0)
      })

      it('reverts when trying to report this epoch again from the same user', async () => {
        await app.reportBeacon(0, 32, 1, { from: user1 })

        await assertRevert(app.reportBeacon(0, 32, 1, { from: user1 }), 'ALREADY_SUBMITTED')
        await assertReportableEpochs(0, 0)
      })

      it('reverts when trying to report future epoch', async () => {
        await assertRevert(app.reportBeacon(1, 32, 1, { from: user1 }), 'EPOCH_HAS_NOT_YET_BEGUN')
      })

      describe(`current time: ${1606824000 + 32 * 12 * 5}, current epoch: 5`, function () {
        beforeEach(async () => {
          await app.reportBeacon(0, 32, 1, { from: user1 })
          await app.reportBeacon(0, 32, 1, { from: user2 })
          await app.reportBeacon(0, 32, 1, { from: user3 })

          await app.setTime(1606824000 + 32 * 12 * 5)

          await assertReportableEpochs(1, 5)
        })

        it('members can reports to all reportable epochs, the earliest reportable epoch is the last completed, the latest is current', async () => {
          for (let epoch = 1; epoch < 6; epoch++)
            await app.reportBeacon(epoch, 32, 1, { from: user1 })
          await assertReportableEpochs(1, 5)

          for (let epoch = 1; epoch < 6; epoch++)
            await app.reportBeacon(epoch, 32, 1, { from: user2 })
          await assertReportableEpochs(1, 5)

          await app.reportBeacon(3, 32, 1, { from: user3 })
          await assertReportableEpochs(4, 5)

          await assertRevert(app.reportBeacon(2, 32, 1, { from: user3 }), 'EPOCH_IS_TOO_OLD')
        })

        it("member removal dont affect other members' data in last reportable epoch, all other reportable epochs will be staled", async () => {
          for (let epoch = 1; epoch < 6; epoch++)
            await app.reportBeacon(epoch, 32, 1, { from: user1 })
          await assertReportableEpochs(1, 5)

          for (let epoch = 1; epoch < 6; epoch++)
            await app.reportBeacon(epoch, 32, 1, { from: user2 })
          await assertReportableEpochs(1, 5)

          await app.removeOracleMember(user3, { from: voting })
          await assertReportableEpochs(5, 5)

          await assertRevert(app.reportBeacon(5, 32, 1, { from: user3 }), 'MEMBER_NOT_FOUND')

          await app.reportBeacon(5, 32, 1, { from: user4 })
          await assertReportableEpochs(6, 5)
        })

        it('member removal removes their data', async () => {
          for (let epoch = 1; epoch < 6; epoch++)
            await app.reportBeacon(epoch, 32, 1, { from: user1 }) // this should be removed
          await assertReportableEpochs(1, 5)

          for (let epoch = 1; epoch < 6; epoch++)
            await app.reportBeacon(epoch, 64, 2, { from: user2 }) // this should be intact
          await assertReportableEpochs(1, 5)

          await app.removeOracleMember(user1, { from: voting })
          await assertReportableEpochs(5, 5)

          await app.reportBeacon(5, 64, 2, { from: user3 })
          await assertReportableEpochs(5, 5)

          await app.reportBeacon(5, 65, 2, { from: user4 })
          await assertReportableEpochs(6, 5)
        })

        it('tail member removal works', async () => {
          for (let epoch = 1; epoch < 6; epoch++)
            await app.reportBeacon(epoch, 32, 1, { from: user1 }) // this should be intact
          await assertReportableEpochs(1, 5)

          for (let epoch = 1; epoch < 6; epoch++)
            await app.reportBeacon(epoch, 64, 2, { from: user4 }) // this should be removed
          await assertReportableEpochs(1, 5)

          await app.removeOracleMember(user4, { from: voting })
          await assertReportableEpochs(5, 5)

          await app.reportBeacon(5, 32, 1, { from: user2 })
          await assertReportableEpochs(5, 5)

          await app.reportBeacon(5, 32, 1, { from: user3 })
          await assertReportableEpochs(6, 5)
        })

        it('quorum change triggers finalization of last reported epoch, all other reportable epochs will be staled', async () => {
          for (let epoch = 1; epoch < 5; epoch++)
            await app.reportBeacon(epoch, 32, 1, { from: user1 })
          await assertReportableEpochs(1, 5)

          for (let epoch = 1; epoch < 5; epoch++)
            await app.reportBeacon(epoch, 32, 1, { from: user2 }) // this should be intact
          await assertReportableEpochs(1, 5)

          await app.setQuorum(2, { from: voting })
          await assertReportableEpochs(5, 5)
        })
      })
    })
  })
})
