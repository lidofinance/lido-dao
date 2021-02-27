const { newDao, newApp } = require('../0.4.24/helpers/dao')
const { assertBn, assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')

const LidoOracle = artifacts.require('LidoOracleMock.sol')
const Lido = artifacts.require('LidoMockForOracle.sol')

contract('LidoOracle', ([appManager, voting, malicious1, malicious2, user1, user2, user3]) => {
  let appBase, appLido, app
  const BAD_DATA = [42, 42]
  const GOOD_DATA = [32, 1]

  const assertReportableEpochs = async (startEpoch, endEpoch) => {
    const result = await app.getCurrentReportableEpochs()
    assertBn(result.minReportableEpochId, startEpoch)
    assertBn(result.maxReportableEpochId, endEpoch)
  }

  before('Deploy and init Lido and oracle', async () => {
    // Deploy the app's base contract.
    appBase = await LidoOracle.new()
    appLido = await Lido.new()

    const { dao, acl } = await newDao(appManager)

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    const proxyAddress = await newApp(dao, 'lidooracle', appBase.address, appManager)
    app = await LidoOracle.at(proxyAddress)

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.MANAGE_MEMBERS(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.MANAGE_QUORUM(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_BEACON_SPEC(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_REPORT_BOUNDARIES(), appManager, { from: appManager })

    // Initialize the app's proxy.
    await app.initialize(appLido.address, 225, 32, 12, 1606824000)

    // Initialize the oracle time, quorum and basic oracles
    await app.setTime(1606824000)
    await app.setQuorum(4, { from: voting })
    await app.addOracleMember(user1, { from: voting })
    await app.addOracleMember(user2, { from: voting })
  })

  it('oracle conract handles changing the oracles during epoch', async () => {
    await app.addOracleMember(malicious1, { from: voting })
    await app.addOracleMember(malicious2, { from: voting })

    await app.reportBeacon(0, BAD_DATA[0], BAD_DATA[1], { from: malicious1 })
    await app.reportBeacon(0, BAD_DATA[0], BAD_DATA[1], { from: malicious2 })
    await app.reportBeacon(0, GOOD_DATA[0], GOOD_DATA[1], { from: user1 })
    await app.reportBeacon(0, GOOD_DATA[0], GOOD_DATA[1], { from: user2 })

    await app.setQuorum(3, { from: voting })

    await app.removeOracleMember(malicious1, { from: voting })
    await app.removeOracleMember(malicious2, { from: voting })

    await app.reportBeacon(0, GOOD_DATA[0], GOOD_DATA[1], { from: user1 }) // user1 reports again
    await app.reportBeacon(0, GOOD_DATA[0], GOOD_DATA[1], { from: user2 }) // user2 reports again

    await app.addOracleMember(user3, { from: voting })
    const receipt = await app.reportBeacon(0, GOOD_DATA[0], GOOD_DATA[1], { from: user3 })

    assertEvent(receipt, 'Completed', { expectedArgs: { epochId: 0, beaconBalance: GOOD_DATA[0], beaconValidators: GOOD_DATA[1] } })
    await assertReportableEpochs(225, 0)
  })

  it('report in odd epoch reverts', async () => {
    await app.setTime(1606824000 + 225 * 32 * 12)
    await assertReportableEpochs(225, 225)
    await app.reportBeacon(225, BAD_DATA[0], BAD_DATA[1], { from: user1 })
    await app.reportBeacon(225, BAD_DATA[0], BAD_DATA[1], { from: user2 })

    await app.setTime(1606824000 + 226 * 32 * 12)
    await assertReportableEpochs(225, 226)
    await assertRevert(app.reportBeacon(226, BAD_DATA[0], BAD_DATA[1], { from: user1 }), 'UNEXPECTED_EPOCH')

    await app.setTime(1606824000 + 449 * 32 * 12)
    await assertReportableEpochs(225, 449)
    await assertRevert(app.reportBeacon(449, BAD_DATA[0], BAD_DATA[1], { from: user2 }), 'UNEXPECTED_EPOCH')

    await app.setTime(1606824000 + 450 * 32 * 12)
    await assertReportableEpochs(225, 450)
    await app.reportBeacon(450, BAD_DATA[0], BAD_DATA[1], { from: user1 })
    await app.reportBeacon(450, BAD_DATA[0], BAD_DATA[1], { from: user2 })
  })
})
