const hre = require('hardhat')

const { bn, MAX_UINT64, ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const { EvmSnapshot } = require('../helpers/blockchain')
const { ETH } = require('../helpers/utils')
const { assert } = require('../helpers/assert')

const PositiveTokenRebaseLimiter = artifacts.require('PositiveTokenRebaseLimiterMock.sol')
const UNLIMITED_REBASE = bn(MAX_UINT64)

contract('PositiveTokenRebaseLimiter', ([account1]) => {
  let limiter, snapshot

  before('deploy mock', async () => {
    limiter = await PositiveTokenRebaseLimiter.new()

    snapshot = new EvmSnapshot(hre.ethers.provider)
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  it('check uninitialized state', async () => {
    const limiterValues = await limiter.getLimiterValues()

    assert.equals(limiterValues.totalPooledEther, 0)
    assert.equals(limiterValues.totalShares, 0)
    assert.equals(limiterValues.rebaseLimit, 0)
    assert.equals(limiterValues.accumulatedRebase, 0)

    assert.isTrue(await limiter.isLimitReached())
  })

  it('initialization check', async () => {
    const rebaseLimit = UNLIMITED_REBASE.div(bn(10))
    const totalPooledEther = ETH(101)
    const totalShares = ETH(75)
    await limiter.initLimiterState(rebaseLimit, totalPooledEther, totalShares)

    const limiterValues = await limiter.getLimiterValues()

    assert.equals(limiterValues.totalPooledEther, totalPooledEther)
    assert.equals(limiterValues.totalShares, totalShares)
    assert.equals(limiterValues.rebaseLimit, rebaseLimit)
    assert.equals(limiterValues.accumulatedRebase, bn(0))
    assert.isFalse(await limiter.isLimitReached())

    await assert.revertsWithCustomError(
      limiter.initLimiterState(ETH(0), totalPooledEther, totalShares),
      'TooLowTokenRebaseLimit()'
    )
    await assert.revertsWithCustomError(
      limiter.initLimiterState(UNLIMITED_REBASE.add(bn(1)), totalPooledEther, totalShares),
      'TooHighTokenRebaseLimit()'
    )

    await limiter.initLimiterState(UNLIMITED_REBASE, totalPooledEther, totalShares)
  })

  it('raise limit', async () => {
    const rebaseLimit = bn('7500')
    const totalPooledEther = ETH(101)
    const totalShares = ETH(75)
    await limiter.initLimiterState(rebaseLimit, totalPooledEther, totalShares)

    await limiter.raiseLimit(ETH(0))
    const limiterValues0 = await limiter.getLimiterValues()
    assert.equals(limiterValues0.totalPooledEther, totalPooledEther)
    assert.equals(limiterValues0.totalShares, totalShares)
    assert.equals(limiterValues0.rebaseLimit, rebaseLimit)
    assert.equals(limiterValues0.accumulatedRebase, bn(0))
    assert.isFalse(await limiter.isLimitReached())

    await limiter.raiseLimit(ETH(1))
    const limiterValuesNeg = await limiter.getLimiterValues()
    assert.equals(limiterValuesNeg.totalPooledEther, totalPooledEther)
    assert.equals(limiterValuesNeg.totalShares, totalShares)
    assert.equals(limiterValuesNeg.rebaseLimit, bn(9908490))
    assert.equals(limiterValuesNeg.accumulatedRebase, bn(0))
    assert.isFalse(await limiter.isLimitReached())
  })

  it('consume limit', async () => {
    const rebaseLimit = bn('7500')
    const totalPooledEther = ETH(1000000)
    const totalShares = ETH(750)
    await limiter.initLimiterState(rebaseLimit, totalPooledEther, totalShares)

    await limiter.consumeLimit(ETH(1))
    assert.isFalse(await limiter.isLimitReached())

    const limiterValues = await limiter.getLimiterValues()
    assert.equals(limiterValues.totalPooledEther, totalPooledEther)
    assert.equals(limiterValues.totalShares, totalShares)
    assert.equals(limiterValues.rebaseLimit, rebaseLimit)
    assert.equals(limiterValues.accumulatedRebase, bn(1000))
    assert.isFalse(await limiter.isLimitReached())

    const tx = await limiter.consumeLimit(ETH(2))
    assert.emits(tx, 'ReturnValue', { retValue: ETH(2) })
    assert.isFalse(await limiter.isLimitReached())

    const tx2 = await limiter.consumeLimit(ETH(4))
    assert.emits(tx2, 'ReturnValue', { retValue: ETH(4) })
    assert.isFalse(await limiter.isLimitReached())

    const tx3 = await limiter.consumeLimit(ETH(1))
    assert.emits(tx3, 'ReturnValue', { retValue: ETH(0.5) })
    assert.isTrue(await limiter.isLimitReached())
    assert.equals(await limiter.getSharesToBurnLimit(), 0)
  })

  it('raise and consume', async () => {
    const rebaseLimit = bn('5000')
    const totalPooledEther = ETH(2000000)
    const totalShares = ETH(1000000)
    await limiter.initLimiterState(rebaseLimit, totalPooledEther, totalShares)

    await limiter.raiseLimit(ETH(1))
    assert.isFalse(await limiter.isLimitReached())

    const tx = await limiter.consumeLimit(ETH(2))
    assert.emits(tx, 'ReturnValue', { retValue: ETH(2) })

    assert.isFalse(await limiter.isLimitReached())
    const limiterValues = await limiter.getLimiterValues()

    assert.equals(limiterValues.totalPooledEther, totalPooledEther)
    assert.equals(limiterValues.totalShares, totalShares)
    assert.equals(limiterValues.rebaseLimit, rebaseLimit.add(bn(500)))
    assert.equals(limiterValues.accumulatedRebase, bn(1000))

    assert.equals(await limiter.getSharesToBurnLimit(), bn('4499979750091124589'))
  })

  it('raise, consume, and raise again', async () => {
    const rebaseLimit = bn('5000')
    const totalPooledEther = ETH(2000000)
    const totalShares = ETH(1000000)
    await limiter.initLimiterState(rebaseLimit, totalPooledEther, totalShares)

    await limiter.raiseLimit(ETH(1))
    assert.isFalse(await limiter.isLimitReached())

    const tx = await limiter.consumeLimit(ETH(2))
    assert.emits(tx, 'ReturnValue', { retValue: ETH(2) })

    assert.isFalse(await limiter.isLimitReached())
    const limiterValues = await limiter.getLimiterValues()

    assert.equals(limiterValues.totalPooledEther, totalPooledEther)
    assert.equals(limiterValues.totalShares, totalShares)
    assert.equals(limiterValues.rebaseLimit, rebaseLimit.add(bn(500)))
    assert.equals(limiterValues.accumulatedRebase, bn(1000))

    await limiter.raiseLimit(ETH(1))
    assert.isFalse(await limiter.isLimitReached())

    assert.equals(limiterValues.totalPooledEther, totalPooledEther)
    assert.equals(limiterValues.totalShares, totalShares)
    assert.equals(limiterValues.rebaseLimit, rebaseLimit.add(bn(500)))
    assert.equals(limiterValues.accumulatedRebase, bn(1000))

    assert.equals(await limiter.getSharesToBurnLimit(), bn('4999975000124999375'))
  })

  it('zero tvl no reverts (means unlimited)', async () => {
    const rebaseLimit = bn('5000')
    const totalPooledEther = ETH(0)
    const totalShares = ETH(0)

    await limiter.initLimiterState(rebaseLimit, totalPooledEther, totalShares)

    await limiter.raiseLimit(ETH(0))
    assert.isFalse(await limiter.isLimitReached())
    await limiter.consumeLimit(ETH(0))
    assert.isFalse(await limiter.isLimitReached())

    await limiter.raiseLimit(ETH(1))
    assert.isFalse(await limiter.isLimitReached())
    await limiter.consumeLimit(ETH(1))
    assert.isFalse(await limiter.isLimitReached())

    const ethTx = await limiter.consumeLimit(ETH(2))
    assert.isFalse(await limiter.isLimitReached())
    assert.emits(ethTx, 'ReturnValue', { retValue: ETH(2) })

    const maxSharesToBurn = await limiter.getSharesToBurnLimit()
    assert.equals(maxSharesToBurn, 0)
  })
})
