const { contract, ethers } = require('hardhat')

const { assert } = require('../helpers/assert')
const { e18, e27, toBN, getFirstEventArgs } = require('../helpers/utils')
const { MAX_UINT256 } = require('../helpers/constants')
const { EvmSnapshot } = require('../helpers/blockchain')

const { deployWithdrawalQueue } = require('./withdrawal-queue-deploy.test')

contract('WithdrawalQueue', ([owner, daoAgent, finalizer, user, oracle]) => {
  const evmSnapshot = new EvmSnapshot(ethers.provider)
  const snapshot = () => evmSnapshot.make()
  const rollback = () => evmSnapshot.rollback()

  const TOTAL_SHARES = toBN(e18(10))

  let queue, steth

  let rebaseCounter = 0
  const setShareRate = async (rate) => {
    await queue.onOracleReport(false, rebaseCounter, ++rebaseCounter, { from: oracle })
    await steth.setTotalPooledEther(TOTAL_SHARES.mul(toBN(rate)))
  }

  before('deploy', async () => {
    const deployed = await deployWithdrawalQueue({
      stethOwner: owner,
      queueAdmin: daoAgent,
      queueFinalizer: finalizer,
      queueOracle: oracle,
    })

    steth = deployed.steth
    queue = deployed.withdrawalQueue

    const userShares = toBN(TOTAL_SHARES).sub(toBN(await steth.getTotalShares()))
    assert.bnAbove(userShares, 0)

    await steth.mintShares(user, userShares)
    await setShareRate(1)

    await steth.approve(queue.address, MAX_UINT256, { from: user })

    await snapshot()
  })

  context(`2 requests with diff share rate, maxShareRate == shareRate(1)`, () => {
    ///
    /// invariant 1: all requests in the same batch should be finalized using the same share rate
    ///
    /// invariant 2: a withdrawal request cannot be finalized using a lower share rate than the
    /// minimum share rate that was reported by the oracle since the last oracle report before
    /// the request was added to the queue
    ///
    after(rollback)

    const requestIds = [0, 0]

    it(`share rate 1.0: a user requests a withdrawal of 1 stETH (10**18 shares)`, async () => {
      const tx = await queue.requestWithdrawals([e18(1)], user, { from: user })
      requestIds[0] = +getFirstEventArgs(tx, 'WithdrawalRequested').requestId
      assert.equals(await queue.unfinalizedStETH(), e18(1))
    })

    it(`protocol receives rewards, changing share rate to 2.0`, async () => {
      await setShareRate(2)
    })

    it(`share rate 2.0: a user requests a withdrawal of 2 stETH (10**18 shares)`, async () => {
      const tx = await queue.requestWithdrawals([e18(2)], user, { from: user })
      requestIds[1] = +getFirstEventArgs(tx, 'WithdrawalRequested').requestId
      assert.equals(await queue.unfinalizedStETH(), e18(3))
    })

    it(`protocol receives slashing, changing share rate to 1.0`, async () => {
      await setShareRate(1)
    })

    let batches

    it(`both requests can be finalized with 2 ETH`, async () => {
      const result = await queue.calculateFinalizationBatches(e27(1), MAX_UINT256, 1000, [
        e18(2),
        false,
        Array(36).fill(0),
        0,
      ])
      assert.isTrue(result.finished)
      assert.equals(result.batchesLength, 2)
      batches = result.batches.slice(0, result.batchesLength)
      assert.equals(batches, [1, 2])

      const batch = await queue.prefinalize.call(batches, e27(1))
      assert.equals(batch.ethToLock, e18(2))
      assert.equals(batch.sharesToBurn, e18(2))
    })

    let claimableEther

    it(`requests get finalized`, async () => {
      await queue.finalize(batches[batches.length - 1], e27(1), { from: finalizer, value: e18(2) })
      assert.equals(await queue.getLastFinalizedRequestId(), requestIds[1])

      const hints = await queue.findCheckpointHints(requestIds, 1, await queue.getLastCheckpointIndex())
      claimableEther = await queue.getClaimableEther(requestIds, hints)
    })

    it(`first request is fullfilled with 1 ETH`, async () => {
      assert.isClose(claimableEther[0], e18(1), 10)
    })

    it(`second request is fullfilled with 1 ETH`, async () => {
      assert.isClose(claimableEther[1], e18(1), 10)
    })
  })

  context(`2 requests 2 batches, shareRate(2) > maxShareRate > shareRate(1)`, () => {
    ///
    /// invariant 1: all requests in the same batch should be finalized using the same share rate
    ///
    /// invariant 2: a withdrawal request cannot be finalized using a lower share rate than the
    /// minimum share rate that was reported by the oracle since the last oracle report before
    /// the request was added to the queue
    ///
    after(rollback)

    const requestIds = [0, 0]

    it(`share rate 1.0: a user requests a withdrawal of 1 stETH (10**18 shares)`, async () => {
      const tx = await queue.requestWithdrawals([e18(1)], user, { from: user })
      requestIds[0] = +getFirstEventArgs(tx, 'WithdrawalRequested').requestId
      assert.equals(await queue.unfinalizedStETH(), e18(1))
    })

    it(`protocol receives rewards, changing share rate to 2.0`, async () => {
      await setShareRate(2)
    })

    it(`share rate 2.0: a user requests a withdrawal of 2 stETH (10**18 shares)`, async () => {
      const tx = await queue.requestWithdrawals([e18(2)], user, { from: user })
      requestIds[1] = +getFirstEventArgs(tx, 'WithdrawalRequested').requestId
      assert.equals(await queue.unfinalizedStETH(), e18(3))
    })

    it(`protocol receives slashing, changing share rate to 1.0`, async () => {
      await setShareRate(1)
    })

    let batches
    const maxShareRate = e27(1.5)

    it(`both requests can be finalized with 2 ETH`, async () => {
      const result = await queue.calculateFinalizationBatches(maxShareRate, MAX_UINT256, 1000, [
        e18(2.5),
        false,
        Array(36).fill(0),
        0,
      ])
      assert.isTrue(result.finished)
      assert.equals(result.batchesLength, 2)
      batches = result.batches.slice(0, result.batchesLength)
      assert.equals(batches, [1, 2])

      const batch = await queue.prefinalize.call(batches, maxShareRate)
      assert.equals(batch.ethToLock, e18(2.5))
      assert.equals(batch.sharesToBurn, e18(2))
    })

    let claimableEther

    it(`requests get finalized`, async () => {
      await queue.finalize(batches[batches.length - 1], maxShareRate, { from: finalizer, value: e18(2.5) })
      assert.equals(await queue.getLastFinalizedRequestId(), requestIds[1])

      const hints = await queue.findCheckpointHints(requestIds, 1, await queue.getLastCheckpointIndex())
      claimableEther = await queue.getClaimableEther(requestIds, hints)
    })

    it(`first request is fullfilled with 1 ETH`, async () => {
      assert.isClose(claimableEther[0], e18(1), 10)
    })

    it(`second request is fullfilled with 1 ETH`, async () => {
      assert.isClose(claimableEther[1], e18(1.5), 10)
    })
  })
})
