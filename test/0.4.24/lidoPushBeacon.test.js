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

  context('with depositedVals=0, beaconVals=0, bcnBal=0, bufferedEth=0', async () => {
    beforeEach(async function () {
      await app.setDepositedValidators(0)
      await app.setBeaconBalance(0)
      await app.setBeaconValidators(0)
    })

    it('report BcnValidators:0 BcnBalance:0 = no rewards', async () => {
      await oracle.reportBeacon(100, 0, ETH(0), { from: user1 })
      checkStat({depositedValidators: 0, beaconValidators: 0, beaconBalance: ETH(0)})
      assertBn(await app.getBufferedEther(), ETH(0))
      assertBn(await app.getTotalPooledEther(), ETH(0))
      assert.equal(await app.distributeRewardsCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:1 = revert', async () => {
      await assertRevert(oracle.reportBeacon(110, 1, ETH(0), { from: user2 }), 'REPORTED_MORE_DEPOSITED')
      checkStat({depositedValidators: 0, beaconValidators: 0, beaconBalance: ETH(0)})
      assertBn(await app.getBufferedEther(), ETH(0))
      assertBn(await app.getTotalPooledEther(), ETH(0))
      assert.equal(await app.distributeRewardsCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })
  })

  context('with depositedVals=0, beaconVals=0, bcnBal=0, bufferedEth=12', async () => {
    beforeEach(async function () {
      await app.setDepositedValidators(0)
      await app.setBeaconBalance(0)
      await app.setBufferedEther({from: user1, value: ETH(12)})
      await app.setBeaconValidators(0)
    })

    it('report BcnValidators:0 BcnBalance:0 = no rewards', async () => {
      await oracle.reportBeacon(100, 0, ETH(0), { from: user1 })
      checkStat({depositedValidators: 0, beaconValidators: 0, beaconBalance: ETH(0)})
      assertBn(await app.getBufferedEther(), ETH(12))
      assertBn(await app.getTotalPooledEther(), ETH(12))
      assert.equal(await app.distributeRewardsCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:1 = revert', async () => {
      await assertRevert(oracle.reportBeacon(110, 1, ETH(0), { from: user2 }), 'REPORTED_MORE_DEPOSITED')
      checkStat({depositedValidators: 0, beaconValidators: 0, beaconBalance: ETH(0)})
      assertBn(await app.getBufferedEther(), ETH(12))
      assertBn(await app.getTotalPooledEther(), ETH(12))
      assert.equal(await app.distributeRewardsCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })
  })

  context('with depositedVals=1, beaconVals=0, bcnBal=0, bufferedEth=3', async () => {
    beforeEach(async function () {
      await app.setDepositedValidators(1)
      await app.setBeaconBalance(0)
      await app.setBufferedEther({from: user1, value: ETH(3)})
      await app.setBeaconValidators(0)
    })

    it('initial state before report', async () => {
      checkStat({depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0)})
      assertBn(await app.getBufferedEther(), ETH(3))
      assertBn(await app.getTotalPooledEther(), ETH(35))
    })

    it('report BcnValidators:0 BcnBalance:0 = no rewards', async () => {
      await oracle.reportBeacon(100, 0, ETH(0), { from: user1 })
      checkStat({depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0)})
      assertBn(await app.getBufferedEther(), ETH(3))
      assertBn(await app.getTotalPooledEther(), ETH(35))
      assert.equal(await app.distributeRewardsCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:2 = revert', async () => {
      await assertRevert(oracle.reportBeacon(110, 2, ETH(65), { from: user2 }), 'REPORTED_MORE_DEPOSITED')
      checkStat({depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0)})
      assertBn(await app.getBufferedEther(), ETH(3))
      assertBn(await app.getTotalPooledEther(), ETH(35))
      assert.equal(await app.distributeRewardsCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:1 BcnBalance:31 = no rewards', async () => {
      await oracle.reportBeacon(100, 1, ETH(31), { from: user1 })
      checkStat({depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(31)})
      assertBn(await app.getBufferedEther(), ETH(3))
      assertBn(await app.getTotalPooledEther(), ETH(34))
      assert.equal(await app.distributeRewardsCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:1 BcnBalance:32 = no rewards', async () => {
      await oracle.reportBeacon(100, 1, ETH(32), { from: user1 })
      checkStat({depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(32)})
      assertBn(await app.getBufferedEther(), ETH(3))
      assertBn(await app.getTotalPooledEther(), ETH(35))
      assert.equal(await app.distributeRewardsCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })
  })

  context('with depositedVals=2, beaconVals=1, bcnBal=30, bufferedEth=3', async () => {
    beforeEach(async function () {
      await app.setDepositedValidators(2)
      await app.setBeaconBalance(ETH(30))
      await app.setBufferedEther({from: user1, value: ETH(5)})
      await app.setBeaconValidators(1)
    })

    it('initial state before report', async () => {
      checkStat({depositedValidators:2, beaconValidators: 1, beaconBalance: ETH(30)})
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(67))
    })

    it('report BcnValidators:1 BcnBalance:0 = no rewards', async () => {
      await oracle.reportBeacon(100, 1, ETH(0), { from: user1 })
      checkStat({depositedValidators: 2, beaconValidators: 1, beaconBalance: ETH(0)})
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(37))
      assert.equal(await app.distributeRewardsCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })
    
    it('report BcnValidators:1 BcnBalance:1 = no rewards', async () => {
      await oracle.reportBeacon(100, 1, ETH(1), { from: user1 })
      checkStat({depositedValidators: 2, beaconValidators: 1, beaconBalance: ETH(1)})
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(38))
      assert.equal(await app.distributeRewardsCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:2 BcnBalance:62 = no reward', async () => {
      await oracle.reportBeacon(100, 2, ETH(62), { from: user1 })
      checkStat({depositedValidators: 2, beaconValidators: 2, beaconBalance: ETH(62)})
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(67))
      assert.equal(await app.distributeRewardsCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:1 BcnBalance:31 = reward:1', async () => {
      await oracle.reportBeacon(100, 1, ETH(31), { from: user1 })
      checkStat({depositedValidators: 2, beaconValidators: 1, beaconBalance: ETH(31)})
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(68))
      assert.equal(await app.distributeRewardsCalled(), true)
      assertBn(await app.totalRewards(), ETH(1))
    })

    it('report BcnValidators:2 BcnBalance:63 = reward:1', async () => {
      await oracle.reportBeacon(100, 2, ETH(63), { from: user1 })
      checkStat({depositedValidators: 2, beaconValidators: 2, beaconBalance: ETH(63)})
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(68))
      assert.equal(await app.distributeRewardsCalled(), true)
      assertBn(await app.totalRewards(), ETH(1))
    })

    it('report BcnValidators:3 = revert', async () => {
      await assertRevert(oracle.reportBeacon(110, 3, ETH(65), { from: user2 }), 'REPORTED_MORE_DEPOSITED')
      checkStat({depositedValidators: 2, beaconValidators: 1, beaconBalance: ETH(30)})
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(67))
      assert.equal(await app.distributeRewardsCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })
    
  })
})
