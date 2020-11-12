const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn, assertRevert } = require('@aragon/contract-helpers-test/src/asserts')
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

  const assertData = async (reportInterval, eth) => {
    const r = await app.getLatestData()
    assertBn(r.reportInterval, reportInterval)
    assertBn(r.eth2balance, eth)
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

    // setBeaconSpec
    await app.setBeaconSpec(32, 12, 1606824000, { from: appManager })

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.MANAGE_MEMBERS(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.MANAGE_QUORUM(), appManager, { from: appManager })

    // Initialize the app's proxy.
    await app.initialize('0x0000000000000000000000000000000000000000')
  })

  it('beaconSpec is correct', async () => {
    const beaconSpec = await app.beaconSpec()
    assertBn(beaconSpec.slotsPerEpoch, 32)
    assertBn(beaconSpec.secondsPerSlot, 12)
    assertBn(beaconSpec.genesisTime, 1606824000)
  })

  describe('Test utility functions:', function () {
    it('', async () => {
      
    })

    it('reportBeacon', async () => {
      await app.setTime(1607824001)
      await app.addOracleMember(user1, { from: voting })
      await app.addOracleMember(user2, { from: voting })
      await app.addOracleMember(user3, { from: voting })
      await app.addOracleMember(user4, { from: voting })

      await app.setQuorum(3, { from: voting })

      await app.reportBeacon(5, 1000, 1, { from: user1 })
      await app.reportBeacon(5, 1000, 1, { from: user2 })
      await app.reportBeacon(5, 1000, 1, { from: user3 })

      assertBn(await app.lastPushedEpoch(), 5)
    })
    
    /*
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

    it('getReportIntervalDurationSeconds works', async () => {
      assertBn(await app.getReportIntervalDurationSeconds(), 86400)
    })

    it('getReportIntervalForTimestamp works', async () => {
      assertBn(await app.getReportIntervalForTimestamp(1597849493), 18493)
      assertBn(await app.getReportIntervalForTimestamp(86400000), 1000)
      assertBn(await app.getReportIntervalForTimestamp(86400000 - 1), 1000 - 1)
      assertBn(await app.getReportIntervalForTimestamp(86400001), 1000)
    })

    it('getCurrentReportInterval works', async () => {
      await app.setTime(1597849493)
      assertBn(await app.getCurrentReportInterval(), 18493)
      await app.setTime(86400000)
      assertBn(await app.getCurrentReportInterval(), 1000)
      await app.setTime(86400000 - 1)
      assertBn(await app.getCurrentReportInterval(), 1000 - 1)
      await app.setTime(86400001)
      assertBn(await app.getCurrentReportInterval(), 1000)
    })
  })

  describe('When there is single-member setup', function () {
    beforeEach('add single member', async () => {
      await app.setTime(86400000)
      await app.addOracleMember(user1, { from: voting })
      await assertData(0, 0)
    })

    it('single-member oracle works', async () => {
      await assertRevert(app.pushData(1000, 100, { from: user2 }), 'MEMBER_NOT_FOUND')
      await assertRevert(app.pushData(10900, 100, { from: user1 }), 'REPORT_INTERVAL_HAS_NOT_YET_BEGUN')

      await app.pushData(1000, 100, { from: user1 })
      await assertData(1000, 100)

      await app.setTime(86400000 + 86400)
      await app.pushData(1001, 101, { from: user1 })
      await assertData(1001, 101)

      await app.setTime(86400000 + 86400 * 4)
      await assertRevert(app.pushData(1005, 105, { from: user1 }), 'REPORT_INTERVAL_HAS_NOT_YET_BEGUN')
      await app.pushData(1004, 104, { from: user1 })
      await assertData(1004, 104)

      await app.addOracleMember(user2, { from: voting })
      await assertData(1004, 104)
    })
  })

  describe('When there is multi-member setup', function () {
    beforeEach('add several members', async () => {
      await app.setTime(86400000)
      await app.addOracleMember(user1, { from: voting })
      await app.addOracleMember(user2, { from: voting })
      await app.addOracleMember(user3, { from: voting })
      await app.addOracleMember(user4, { from: voting })
      await assertData(0, 0)
    })

    it('multi-member oracle works', async () => {
      await app.setQuorum(3, { from: voting })
      await assertData(0, 0)

      await assertRevert(app.pushData(1000, 100, { from: nobody }), 'MEMBER_NOT_FOUND')
      await assertRevert(app.pushData(10900, 100, { from: user1 }), 'REPORT_INTERVAL_HAS_NOT_YET_BEGUN')

      // reportInterval 1000, quorum 3
      await app.pushData(1000, 100, { from: user1 })
      await assertRevert(app.pushData(1000, 101, { from: user1 }), 'ALREADY_SUBMITTED')
      await assertData(0, 0)
      await app.pushData(1000, 100, { from: user3 })
      await assertData(0, 0)
      await app.pushData(1000, 110, { from: user4 })
      await assertData(1000, 100) // exact mode of recieved values
      await assertRevert(app.pushData(1000, 100, { from: user2 }), 'REPORT_INTERVAL_IS_TOO_OLD')

      // reportInterval 1001, quorum 3
      await app.setTime(86400000 + 86400)
      await app.pushData(1001, 110, { from: user1 })
      await assertData(1000, 100)
      await app.pushData(1001, 120, { from: user2 })
      await assertData(1000, 100)
      await app.pushData(1001, 120, { from: user3 })
      await assertData(1001, 120)

      // reportInterval 1004, quorum 4
      await app.setQuorum(4, { from: voting })
      await app.setTime(86400000 + 86400 * 4)
      await assertRevert(app.pushData(1005, 105, { from: user1 }), 'REPORT_INTERVAL_HAS_NOT_YET_BEGUN')
      await app.pushData(1004, 120, { from: user1 })
      await app.pushData(1004, 120, { from: user2 })
      await app.pushData(1004, 120, { from: user3 })
      await app.pushData(1004, 110, { from: user4 })
      await assertData(1004, 120)
    })

    it('reportInterval can be unfinished', async () => {
      await app.setQuorum(2, { from: voting })

      // reportInterval 1000
      await app.pushData(1000, 100, { from: user1 })
      await assertData(0, 0)

      // reportInterval 1001
      await app.setTime(86400000 + 86400)
      await app.pushData(1001, 110, { from: user2 })
      await assertData(0, 0)
      await assertRevert(app.pushData(1000, 100, { from: user3 }), 'REPORT_INTERVAL_IS_TOO_OLD')
      await app.pushData(1001, 110, { from: user3 })
      await assertData(1001, 110)
    })

    it("member removal dont affect other members' data", async () => {
      await app.setQuorum(2, { from: voting })

      // reportInterval 1000
      await app.pushData(1000, 105, { from: user1 })
      await app.pushData(1000, 105, { from: user3 })

      // reportInterval 1001
      await app.setQuorum(3, { from: voting })
      await app.setTime(86400000 + 86400)
      await app.pushData(1001, 140, { from: user4 })
      await app.pushData(1001, 130, { from: user2 })
      await assertData(1000, 105)

      await app.removeOracleMember(user1, { from: voting })
      await assertRevert(app.pushData(1001, 100, { from: user1 }), 'MEMBER_NOT_FOUND')
      await app.pushData(1001, 130, { from: user3 })
      await assertData(1001, 130)
    })

    it('member removal removes their data', async () => {
      await app.setQuorum(2, { from: voting })

      // reportInterval 1000
      await app.pushData(1000, 105, { from: user1 })
      await app.pushData(1000, 105, { from: user3 })

      // reportInterval 1001
      await app.setQuorum(3, { from: voting })
      await app.setTime(86400000 + 86400)
      await app.pushData(1001, 110, { from: user1 })
      await app.pushData(1001, 120, { from: user2 }) // this should be intact
      await assertData(1000, 105)

      await app.removeOracleMember(user1, { from: voting })
      await app.pushData(1001, 120, { from: user3 })
      await assertData(1000, 105)
      await app.pushData(1001, 120, { from: user4 })
      await assertData(1001, 120)
    })

    it('tail member removal works', async () => {
      await app.setQuorum(2, { from: voting })

      // reportInterval 1000
      await app.pushData(1000, 105, { from: user1 })
      await app.pushData(1000, 105, { from: user3 })

      // reportInterval 1001
      await app.setQuorum(3, { from: voting })
      await app.setTime(86400000 + 86400)
      await app.pushData(1001, 110, { from: user4 })
      await app.pushData(1001, 130, { from: user2 }) // this should be intact
      await assertData(1000, 105)

      await app.removeOracleMember(user4, { from: voting })
      await app.pushData(1001, 130, { from: user1 })
      await assertData(1000, 105)
      await app.pushData(1001, 140, { from: user3 })
      await assertData(1001, 130)
    })

    it('quorum change triggers finalization', async () => {
      await app.setQuorum(3, { from: voting })

      // reportInterval 1000
      await app.pushData(1000, 100, { from: user1 })
      await app.pushData(1000, 110, { from: user2 })
      await app.pushData(1000, 110, { from: user3 })
      await assertData(1000, 110)

      // reportInterval 1001
      await app.setTime(86400000 + 86400)
      await app.pushData(1001, 110, { from: user4 })
      await app.pushData(1001, 110, { from: user2 })
      await assertData(1000, 110)

      await app.setQuorum(2, { from: voting })
      await assertData(1001, 110)
    })

    it('can push to previous intervals until more recent data came', async () => {
      await app.setQuorum(2, { from: voting })

      // reportInterval 1000
      await app.pushData(1000, 100, { from: user1 })
      await app.pushData(1000, 100, { from: user2 })
      await assertData(1000, 100)

      // reportInterval 1005
      await app.setTime(86400000 + 5 * 86400)
      await assertData(1000, 100)

      // report past intervals
      await app.pushData(1002, 120, { from: user1 })
      await app.pushData(1002, 120, { from: user2 })
      await assertData(1002, 120)

      await app.pushData(1003, 130, { from: user1 })
      await app.pushData(1003, 130, { from: user2 })
      await assertData(1003, 130)
    })

    it("can't push to previous intervals if more recent data came", async () => {
      await app.setQuorum(2, { from: voting })

      // reportInterval 1000
      await app.pushData(1000, 100, { from: user1 })
      await assertData(0, 0)

      // reportInterval 1001
      await app.setTime(86400000 + 86400)
      await app.pushData(1001, 100, { from: user1 })
      await assertData(0, 0)

      // report past interval
      await assertRevert(app.pushData(1000, 100, { from: user2 }), 'REPORT_INTERVAL_IS_TOO_OLD')
      await assertData(0, 0)
    })

    it('report interval finalizes only if data is unimodal', async () => {
      await app.setQuorum(3, { from: voting })

      // reportInterval 1000
      await app.pushData(1000, 100, { from: user1 })
      await app.pushData(1000, 110, { from: user2 })
      await app.pushData(1000, 120, { from: user3 })
      await assertData(0, 0) // because all reported values are different
      await app.pushData(1000, 120, { from: user4 })
      await assertData(1000, 120)

      // reportInterval 1001
      await app.setTime(86400000 + 86400)
      await app.setQuorum(2, { from: voting })
      await app.pushData(1001, 110, { from: user1 })
      await app.pushData(1001, 120, { from: user2 })
      await app.pushData(1001, 130, { from: user3 })
      await app.pushData(1001, 140, { from: user4 })
      await assertData(1000, 120) // quorum is not reached because all reported values are different

      // reportInterval 1002
      await app.setTime(86400000 + 2 * 86400)
      await app.setQuorum(1, { from: voting })
      await app.pushData(1002, 100, { from: user1 })
      await assertData(1002, 100)
    })
    */
  })
})
