const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { assertRevert } = require('../helpers/assertThrow')

const LidoPushableMock = artifacts.require('LidoPushableMock.sol')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')

contract('Lido: handleOracleReport', ([appManager, oracle, stranger]) => {
  let appBase, app, elRewardsVault

  before('deploy base app', async () => {
    appBase = await LidoPushableMock.new()
  })

  ///
  ///  TODO: proper tests for the new accounting
  ///

  async function pushOracleReport({epochId, clValidators, clBalance}, options = null) {
    const elRewardsVaultBalance = await web3.eth.getBalance(elRewardsVault)
    return await app.handleOracleReport(
        clValidators,
        clBalance,
        0,
        elRewardsVaultBalance,
        0,
        0,
        options || {from: oracle}
    )
  }

  beforeEach('deploy dao and app', async () => {
    const { dao } = await newDao(appManager)

    const proxyAddress = await newApp(dao, 'lido', appBase.address, appManager)
    app = await LidoPushableMock.at(proxyAddress)

    await app.initialize(oracle)
    elRewardsVault = await app.getELRewardsVault()
  })

  const checkStat = async ({ depositedValidators, beaconValidators, beaconBalance }) => {
    const stat = await app.getBeaconStat()
    assertBn(stat.depositedValidators, depositedValidators, 'depositedValidators check')
    assertBn(stat.beaconValidators, beaconValidators, 'beaconValidators check')
    assertBn(stat.beaconBalance, beaconBalance, 'beaconBalance check')
  }

  it('reportBeacon access control', async () => {
    await assertRevert(
      pushOracleReport({epochId: 110, clValidators: 0, clBalance: ETH(0)},  {from: stranger}),
      'APP_AUTH_FAILED'
    )
  })

  context('with depositedVals=0, beaconVals=0, bcnBal=0, bufferedEth=0', async () => {
    beforeEach(async function () {
      await app.setDepositedValidators(0)
      await app.setBeaconBalance(0)
      await app.setBeaconValidators(0)
    })

    it('report BcnValidators:0 BcnBalance:0 = no rewards', async () => {
      await pushOracleReport({epochId: 100, clValidators: 0, clBalance: ETH(0)})
      checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: ETH(0) })
      assertBn(await app.getBufferedEther(), ETH(0))
      assertBn(await app.getTotalPooledEther(), ETH(0))
      assert.equal(await app.distributeFeeCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:1 = revert', async () => {
      await assertRevert(
        pushOracleReport({epochId: 110, clValidators: 1, clBalance: ETH(0)}),
        'REPORTED_MORE_DEPOSITED'
      )
      checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: ETH(0) })
      assertBn(await app.getBufferedEther(), ETH(0))
      assertBn(await app.getTotalPooledEther(), ETH(0))
      assert.equal(await app.distributeFeeCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })
  })

  context('with depositedVals=0, beaconVals=0, bcnBal=0, bufferedEth=12', async () => {
    beforeEach(async function () {
      await app.setDepositedValidators(0)
      await app.setBeaconBalance(0)
      await app.setBufferedEther({ from: stranger, value: ETH(12) })
      await app.setBeaconValidators(0)
    })

    it('report BcnValidators:0 BcnBalance:0 = no rewards', async () => {
      await pushOracleReport({epochId: 100, clValidators: 0, clBalance: ETH(0)})
      checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: ETH(0) })
      assertBn(await app.getBufferedEther(), ETH(12))
      assertBn(await app.getTotalPooledEther(), ETH(12))
      assert.equal(await app.distributeFeeCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:1 = revert', async () => {
      await assertRevert(
        pushOracleReport({epochId: 110, clValidators: 1, clBalance: ETH(0)}),
        'REPORTED_MORE_DEPOSITED'
      )
      checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: ETH(0) })
      assertBn(await app.getBufferedEther(), ETH(12))
      assertBn(await app.getTotalPooledEther(), ETH(12))
      assert.equal(await app.distributeFeeCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })
  })

  context('with depositedVals=1, beaconVals=0, bcnBal=0, bufferedEth=3', async () => {
    beforeEach(async function () {
      await app.setDepositedValidators(1)
      await app.setBeaconBalance(0)
      await app.setBufferedEther({ from: stranger, value: ETH(3) })
      await app.setBeaconValidators(0)
    })

    it('initial state before report', async () => {
      checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
      assertBn(await app.getBufferedEther(), ETH(3))
      assertBn(await app.getTotalPooledEther(), ETH(35))
    })

    it('report BcnValidators:0 BcnBalance:0 = no rewards', async () => {
      await pushOracleReport({epochId: 100, clValidators: 0, clBalance: ETH(0)})
      checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
      assertBn(await app.getBufferedEther(), ETH(3))
      assertBn(await app.getTotalPooledEther(), ETH(35))
      assert.equal(await app.distributeFeeCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:2 = revert', async () => {
      await assertRevert(
        pushOracleReport({epochId: 110, clValidators: 2, clBalance: ETH(65)}),
        'REPORTED_MORE_DEPOSITED'
      )
      checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
      assertBn(await app.getBufferedEther(), ETH(3))
      assertBn(await app.getTotalPooledEther(), ETH(35))
      assert.equal(await app.distributeFeeCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:1 BcnBalance:31 = no rewards', async () => {
      await pushOracleReport({epochId: 100, clValidators: 1, clBalance: ETH(31)})
      checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(31) })
      assertBn(await app.getBufferedEther(), ETH(3))
      assertBn(await app.getTotalPooledEther(), ETH(34))
      assert.equal(await app.distributeFeeCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:1 BcnBalance:32 = no rewards', async () => {
      await pushOracleReport({epochId: 100, clValidators: 1, clBalance: ETH(32)})
      checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(32) })
      assertBn(await app.getBufferedEther(), ETH(3))
      assertBn(await app.getTotalPooledEther(), ETH(35))
      assert.equal(await app.distributeFeeCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })
  })

  context('with depositedVals=2, beaconVals=1, bcnBal=30, bufferedEth=5', async () => {
    beforeEach(async function () {
      await app.setDepositedValidators(2)
      await app.setBeaconBalance(ETH(30))
      await app.setBufferedEther({ from: stranger, value: ETH(5) })
      await app.setBeaconValidators(1)
      await app.setTotalShares(ETH(67))
    })

    it('initial state before report', async () => {
      checkStat({ depositedValidators: 2, beaconValidators: 1, beaconBalance: ETH(30) })
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(67))
    })

    it('report BcnValidators:1 BcnBalance:0 = no rewards', async () => {
      await pushOracleReport({epochId: 100, clValidators: 1, clBalance: ETH(0)})
      checkStat({ depositedValidators: 2, beaconValidators: 1, beaconBalance: ETH(0) })
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(37))
      assert.equal(await app.distributeFeeCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:1 BcnBalance:1 = no rewards', async () => {
      await pushOracleReport({epochId: 100, clValidators: 1, clBalance: ETH(1)})
      checkStat({ depositedValidators: 2, beaconValidators: 1, beaconBalance: ETH(1) })
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(38))
      assert.equal(await app.distributeFeeCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:2 BcnBalance:62 = no reward', async () => {
      await pushOracleReport({epochId: 100, clValidators: 2, clBalance: ETH(62)})
      checkStat({ depositedValidators: 2, beaconValidators: 2, beaconBalance: ETH(62) })
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(67))
      assert.equal(await app.distributeFeeCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:1 BcnBalance:31 = reward:1', async () => {
      await pushOracleReport({epochId: 100, clValidators: 2, clBalance: ETH(63)})
      checkStat({ depositedValidators: 2, beaconValidators: 2, beaconBalance: ETH(63) })
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(68))
      assert.equal(await app.distributeFeeCalled(), true)
      assertBn(await app.totalRewards(), ETH(1)) // rounding error
    })

    it('report BcnValidators:2 BcnBalance:63 = reward:1', async () => {
      await pushOracleReport({epochId: 100, clValidators: 2, clBalance: ETH(63)})
      checkStat({ depositedValidators: 2, beaconValidators: 2, beaconBalance: ETH(63) })
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(68))
      assert.equal(await app.distributeFeeCalled(), true)
      assertBn(await app.totalRewards(), ETH(1)) // rounding error
    })

    it('report BcnValidators:3 = revert with REPORTED_MORE_DEPOSITED', async () => {
      await assertRevert(
        pushOracleReport({epochId: 110, clValidators: 3, clBalance: ETH(65)}),
        'REPORTED_MORE_DEPOSITED'
      )
      checkStat({ depositedValidators: 2, beaconValidators: 1, beaconBalance: ETH(30) })
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(67))
      assert.equal(await app.distributeFeeCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })
  })

  context('with depositedVals=5, beaconVals=4, bcnBal=1, bufferedEth=0', async () => {
    beforeEach(async function () {
      await app.setDepositedValidators(5)
      await app.setBeaconBalance(ETH(1))
      await app.setBufferedEther({ from: stranger, value: ETH(0) })
      await app.setBeaconValidators(4)
    })

    // See LIP-1 for explanation
    // https://github.com/lidofinance/lido-improvement-proposals/blob/develop/LIPS/lip-1.md
    it('report decreased BcnValidators:3 = revert with REPORTED_LESS_VALIDATORS', async () => {
      await assertRevert(
        pushOracleReport({epochId: 123, clValidators: 3, clBalance: ETH(1)}),
        'REPORTED_LESS_VALIDATORS'
      )
      await assertRevert(
        pushOracleReport({epochId: 321, clValidators: 2, clBalance: ETH(10)}),
        'REPORTED_LESS_VALIDATORS'
      )
      await assertRevert(
        pushOracleReport({epochId: 12345, clValidators: 1, clBalance: ETH(123)}),
        'REPORTED_LESS_VALIDATORS'
      )
      // values stay intact
      checkStat({ depositedValidators: 5, beaconValidators: 4, beaconBalance: ETH(1) })
      assertBn(await app.getBufferedEther(), ETH(0))
      assertBn(await app.getTotalPooledEther(), ETH(33))
      assert.equal(await app.distributeFeeCalled(), false)
      assertBn(await app.totalRewards(), 0)
    })
  })
})
