const hre = require('hardhat')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { assert } = require('../helpers/assert')
const { assertRevert } = require('../helpers/assertThrow')
const { deployProtocol } = require('../helpers/protocol')
const { pushOracleReport } = require('../helpers/oracle')
const { EvmSnapshot } = require('../helpers/blockchain')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')

contract.skip('Lido: handleOracleReport', ([appManager, stranger, depositor]) => {
  let app, consensus, oracle, snapshot

  before('deploy base app', async () => {
    const deployed = await deployProtocol({
      depositSecurityModuleFactory: async () => {
        return { address: depositor }
      }
    })

    app = deployed.pool
    consensus = deployed.consensusContract
    oracle = deployed.oracle

    snapshot = new EvmSnapshot(hre.ethers.provider)
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  ///
  ///  TODO: proper tests for the new accounting
  ///

  const checkStat = async ({ depositedValidators, beaconValidators, beaconBalance }) => {
    const stat = await app.getBeaconStat()
    assertBn(stat.depositedValidators, depositedValidators, 'depositedValidators check')
    assertBn(stat.beaconValidators, beaconValidators, 'beaconValidators check')
    assertBn(stat.beaconBalance, beaconBalance, 'beaconBalance check')
  }

  it('reportBeacon access control', async () => {
    await assertRevert(app.handleOracleReport(0, 0, 0, 0, 0, 0, 0, false, { from: stranger }), 'APP_AUTH_FAILED')
  })

  context('with depositedVals=0, beaconVals=0, bcnBal=0, bufferedEth=0', async () => {
    it('report BcnValidators:0 BcnBalance:0 = no rewards', async () => {
      console.log(consensus.address, oracle.address)
      await pushOracleReport(consensus, oracle, 0, 0)
      await checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: ETH(0) })
      assertBn(await app.getBufferedEther(), ETH(0))
      assertBn(await app.getTotalPooledEther(), ETH(0))
      // assert.equal(await app.distributeFeeCalled(), false)
      // assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:1 = revert', async () => {
      await assertRevert(pushOracleReport(consensus, oracle, 1, 0), 'REPORTED_MORE_DEPOSITED')
      await checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: ETH(0) })
      assertBn(await app.getBufferedEther(), ETH(0))
      assertBn(await app.getTotalPooledEther(), ETH(0))
      // assert.equal(await app.distributeFeeCalled(), false)
      // assertBn(await app.totalRewards(), 0)
    })
  })

  context('with depositedVals=0, beaconVals=0, bcnBal=0, bufferedEth=12', async () => {
    it('report BcnValidators:0 BcnBalance:0 = no rewards', async () => {
      await pushOracleReport(consensus, oracle, 0, 0)
      await checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: ETH(0) })
      assertBn(await app.getBufferedEther(), ETH(12))
      assertBn(await app.getTotalPooledEther(), ETH(12))
      // assert.equal(await app.distributeFeeCalled(), false)
      // assertBn(await app.totalRewards(), 0)

      await assertRevert(pushOracleReport(consensus, oracle, 1, 0), 'REPORTED_MORE_DEPOSITED')
      await checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: ETH(0) })
      assertBn(await app.getBufferedEther(), ETH(12))
      assertBn(await app.getTotalPooledEther(), ETH(12))
      // assert.equal(await app.distributeFeeCalled(), false)
      // assertBn(await app.totalRewards(), 0)
    })
  })

  context('with depositedVals=1, beaconVals=0, bcnBal=0, bufferedEth=3', async () => {
    it('initial state before report', async () => {
      await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
      assertBn(await app.getBufferedEther(), ETH(3))
      assertBn(await app.getTotalPooledEther(), ETH(35))
    })

    it('report BcnValidators:0 BcnBalance:0 = no rewards', async () => {
      await pushOracleReport(consensus, oracle, 0, 0)
      await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
      assertBn(await app.getBufferedEther(), ETH(3))
      assertBn(await app.getTotalPooledEther(), ETH(35))
      // assert.equal(await app.distributeFeeCalled(), false)
      // assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:2 = revert', async () => {
      await assertRevert(
        pushOracleReport(consensus, oracle, 2, ETH(65)),
        'REPORTED_MORE_DEPOSITED'
      )
      await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
      assertBn(await app.getBufferedEther(), ETH(3))
      assertBn(await app.getTotalPooledEther(), ETH(35))
      // assert.equal(await app.distributeFeeCalled(), false)
      // assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:1 BcnBalance:31 = no rewards', async () => {
      await pushOracleReport(consensus, oracle, 1, ETH(31))
      await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(31) })
      assertBn(await app.getBufferedEther(), ETH(3))
      assertBn(await app.getTotalPooledEther(), ETH(34))
      // assert.equal(await app.distributeFeeCalled(), false)
      // assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:1 BcnBalance:32 = no rewards', async () => {
      await pushOracleReport(consensus, oracle, 1, ETH(32))
      await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(32) })
      assertBn(await app.getBufferedEther(), ETH(3))
      assertBn(await app.getTotalPooledEther(), ETH(35))
      // assert.equal(await app.distributeFeeCalled(), false)
      // assertBn(await app.totalRewards(), 0)
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
      await checkStat({ depositedValidators: 2, beaconValidators: 1, beaconBalance: ETH(30) })
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(67))
    })

    it('report BcnValidators:1 BcnBalance:0 = no rewards', async () => {
      await pushOracleReport(consensus, oracle, 1, 0)
      await checkStat({ depositedValidators: 2, beaconValidators: 1, beaconBalance: ETH(0) })
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(37))
      // assert.equal(await app.distributeFeeCalled(), false)
      // assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:1 BcnBalance:1 = no rewards', async () => {
      await pushOracleReport({epochId: 100, clValidators: 1, clBalance: ETH(1)})
      await checkStat({ depositedValidators: 2, beaconValidators: 1, beaconBalance: ETH(1) })
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(38))
      // assert.equal(await app.distributeFeeCalled(), false)
      // assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:2 BcnBalance:62 = no reward', async () => {
      await pushOracleReport({epochId: 100, clValidators: 2, clBalance: ETH(62)})
      await checkStat({ depositedValidators: 2, beaconValidators: 2, beaconBalance: ETH(62) })
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(67))
      // assert.equal(await app.distributeFeeCalled(), false)
      // assertBn(await app.totalRewards(), 0)
    })

    it('report BcnValidators:1 BcnBalance:31 = reward:1', async () => {
      await pushOracleReport({epochId: 100, clValidators: 2, clBalance: ETH(63)})
      await checkStat({ depositedValidators: 2, beaconValidators: 2, beaconBalance: ETH(63) })
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(68))
      // assert.equal(await app.distributeFeeCalled(), true)
      // assertBn(await app.totalRewards(), ETH(1)) // rounding error
    })

    it('report BcnValidators:2 BcnBalance:63 = reward:1', async () => {
      await pushOracleReport({epochId: 100, clValidators: 2, clBalance: ETH(63)})
      await checkStat({ depositedValidators: 2, beaconValidators: 2, beaconBalance: ETH(63) })
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(68))
      // assert.equal(await app.distributeFeeCalled(), true)
      // assertBn(await app.totalRewards(), ETH(1)) // rounding error
    })

    it('report BcnValidators:3 = revert with REPORTED_MORE_DEPOSITED', async () => {
      await assertRevert(
        pushOracleReport({epochId: 110, clValidators: 3, clBalance: ETH(65)}),
        'REPORTED_MORE_DEPOSITED'
      )
      await checkStat({ depositedValidators: 2, beaconValidators: 1, beaconBalance: ETH(30) })
      assertBn(await app.getBufferedEther(), ETH(5))
      assertBn(await app.getTotalPooledEther(), ETH(67))
      // assert.equal(await app.distributeFeeCalled(), false)
      // assertBn(await app.totalRewards(), 0)
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
        pushOracleReport(consensus, oracle, 3, ETH(1)),
        'REPORTED_LESS_VALIDATORS'
      )
      await assertRevert(
        pushOracleReport(consensus, oracle, 2, ETH(10)),
        'REPORTED_LESS_VALIDATORS'
      )
      await assertRevert(
        pushOracleReport(consensus, oracle, 1, ETH(123)),
        'REPORTED_LESS_VALIDATORS'
      )
      // values stay intact
      await checkStat({ depositedValidators: 5, beaconValidators: 4, beaconBalance: ETH(1) })
      assertBn(await app.getBufferedEther(), ETH(0))
      assertBn(await app.getTotalPooledEther(), ETH(33))
      // assert.equal(await app.distributeFeeCalled(), false)
      // assertBn(await app.totalRewards(), 0)
    })
  })
})
