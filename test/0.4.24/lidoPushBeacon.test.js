const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn, assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')

const Lido = artifacts.require('LidoPushableMock.sol')
const OracleMock = artifacts.require('OracleMock.sol')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')

contract('Lido pushBeacon', ([appManager, voting, user1, user2, user3, nobody]) => {
  let appBase, app, oracle

  before('deploy base app', async () => {
    appBase = await Lido.new()
    oracle = await OracleMock.new()
  })

  beforeEach('deploy dao and app', async () => {
    const { dao, acl } = await newDao(appManager)

    proxyAddress = await newApp(dao, 'lido', appBase.address, appManager)
    app = await Lido.at(proxyAddress)

    //await acl.createPermission(voting, app.address, await app.PAUSE_ROLE(), appManager, { from: appManager })

    await app.initialize(oracle.address)
    await oracle.setPool(app.address)
  })

  const checkStat = async ({ depositedValidators, beaconValidators, beaconBalance }) => {
    const stat = await app.getBeaconStat()
    assertBn(stat.depositedValidators, depositedValidators, 'depositedValidators check')
    assertBn(stat.beaconValidators, beaconValidators, 'beaconValidators check')
    assertBn(stat.beaconBalance, beaconBalance, 'beaconBalance check')
  }

  it('reportBeacon access control', async () => {
    let fakeOracle
    fakeOracle = await OracleMock.new()
    await fakeOracle.setPool(app.address)
    await assertRevert(fakeOracle.reportBeacon(110, 0, ETH(0), { from: user2 }), 'APP_AUTH_FAILED')
  })

  it('reportBeacon works', async () => {
    await oracle.reportBeacon(110, 0, ETH(0), { from: user1 })
    checkStat({depositedValidators: 0, beaconValidators: 0, beaconBalance: 0})
    assertBn(await app.totalRewards(), 0)
    assert.equal(await app.distributeRewardsCalled(), false)
  })
})
