const { newDao, newApp } = require('../0.4.24/helpers/dao')
const { assertBn, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')

const LidoOracle = artifacts.require('LidoOracleMock.sol')

contract('LidoOracle', ([appManager, voting, malicious1, malicious2, user1, user2, user3]) => {
  let appBase, app

  const assertReportableEpochs = async (startEpoch, endEpoch) => {
    const result = await app.getCurrentReportableEpochs()
    assertBn(result.minReportableEpochId, startEpoch)
    assertBn(result.maxReportableEpochId, endEpoch)
  }

  before('Deploy and init Lido and oracle', async () => {
    // Deploy the app's base contract.
    appBase = await LidoOracle.new()

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

    // Initialize the oracle time
    await app.setTime(1606824000)
  })

  it('oracle conract handles changing the oracles during epoch', async () => {
    const BAD_DATA = [42, 42]
    const GOOD_DATA = [32, 1]

    await app.addOracleMember(malicious1, { from: voting })
    await app.addOracleMember(malicious2, { from: voting })
    await app.addOracleMember(user1, { from: voting })
    await app.addOracleMember(user2, { from: voting })

    await app.setQuorum(4, { from: voting })

    await app.reportBeacon(0, BAD_DATA[0], BAD_DATA[1], { from: malicious1 })
    await app.reportBeacon(0, BAD_DATA[0], BAD_DATA[1], { from: malicious2 })
    await app.reportBeacon(0, GOOD_DATA[0], GOOD_DATA[1], { from: user1 })
    await app.reportBeacon(0, GOOD_DATA[0], GOOD_DATA[1], { from: user2 })

    await app.setQuorum(2, { from: voting })

    await app.removeOracleMember(malicious1, { from: voting })
    await app.removeOracleMember(malicious2, { from: voting })

    await app.addOracleMember(user3, { from: voting })

    const receipt = await app.reportBeacon(0, GOOD_DATA[0], GOOD_DATA[1], { from: user3 })

    assertEvent(receipt, 'Completed', { expectedArgs: { epochId: 0, beaconBalance: GOOD_DATA[0], beaconValidators: GOOD_DATA[1] } })

    await assertReportableEpochs(1, 0)
  })
})
