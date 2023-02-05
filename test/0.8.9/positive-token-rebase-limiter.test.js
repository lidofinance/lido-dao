const { assert } = require('chai')
const { assertBn, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { assertRevert } = require('../helpers/assertThrow')
const { bn, MAX_UINT256 } = require('@aragon/contract-helpers-test')
const { toBN } = require('../helpers/utils')

const PositiveTokenRebaseLimiter = artifacts.require('PositiveTokenRebaseLimiterMock.sol')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')

//TODO(DZhon): fix tests
contract.skip('PositiveTokenRebaseLimiter', ([account1]) => {
  let limiter

  before('deploy mock', async () => {
    limiter = await PositiveTokenRebaseLimiter.new()
  })

  it('check uninitialized state', async () => {
    const limiterValues = await limiter.getLimiterValues()

    assertBn(limiterValues.totalPooledEther, 0)
    assertBn(limiterValues.totalShares, 0)
    assertBn(limiterValues.rebaseLimit, 0)
    assertBn(limiterValues.accumulatedRebase, 0)

    assert.isTrue(await limiter.isLimitReached())
  })

  it('initialization check', async () => {
    const rebaseLimit = bn('10000000')
    const totalPooledEther = ETH(101)
    const totalShares = ETH(75)
    await limiter.initLimiterState(rebaseLimit, totalPooledEther, totalShares)

    const limiterValues = await limiter.getLimiterValues()
    assertBn(limiterValues.totalPooledEther, totalPooledEther)
    assertBn(limiterValues.totalShares, totalShares)
    assertBn(limiterValues.rebaseLimit, rebaseLimit)
    assertBn(limiterValues.accumulatedRebase, bn(0))
    assert.isFalse(await limiter.isLimitReached())

    assertRevert(
      limiter.initLimiterState(ETH(1), totalPooledEther, totalShares),
      'TOO_LARGE_LIMITER_MAX'
    )
    assertRevert(
      limiter.initLimiterState(bn(0), totalPooledEther, totalShares),
      'TOO_LOW_LIMITER_MAX'
    )
  })

  it('apply cl balance update', async () => {
    const rebaseLimit = bn('7500')
    const totalPooledEther = ETH(101)
    const totalShares = ETH(75)
    await limiter.initLimiterState(rebaseLimit, totalPooledEther, totalShares)

    await limiter.applyCLBalanceUpdate(ETH(0))
    const limiterValues0 = await limiter.getLimiterValues()
    assertBn(limiterValues0.totalPooledEther, totalPooledEther)
    assertBn(limiterValues0.totalShares, totalShares)
    assertBn(limiterValues0.rebaseLimit, rebaseLimit)
    assertBn(limiterValues0.accumulatedRebase, bn(0))
    assert.isFalse(await limiter.isLimitReached())

    await limiter.applyCLBalanceUpdate(bn(ETH(1)).neg())
    const limiterValuesNeg = await limiter.getLimiterValues()
    assertBn(limiterValuesNeg.totalPooledEther, totalPooledEther)
    assertBn(limiterValuesNeg.totalShares, totalShares)
    assertBn(limiterValuesNeg.rebaseLimit, bn(9908490))
    assertBn(limiterValuesNeg.accumulatedRebase, bn(0))
    assert.isFalse(await limiter.isLimitReached())

    await limiter.applyCLBalanceUpdate(bn(ETH(3)))
    const limiterValuesPos = await limiter.getLimiterValues()
    assertBn(limiterValuesPos.totalPooledEther, totalPooledEther)
    assertBn(limiterValuesPos.totalShares, totalShares)
    assertBn(limiterValuesPos.rebaseLimit, bn(9908490))
    assertBn(limiterValuesPos.accumulatedRebase, bn(9908490))
    assert.isTrue(await limiter.isLimitReached())
  })

  it('appendEther', async () => {
    const rebaseLimit = bn('7500')
    const totalPooledEther = ETH(1000000)
    const totalShares = ETH(750)
    await limiter.initLimiterState(rebaseLimit, totalPooledEther, totalShares)

    await limiter.applyCLBalanceUpdate(ETH(1))
    assert.isFalse(await limiter.isLimitReached())
    const limiterValues = await limiter.getLimiterValues()
    assertBn(limiterValues.totalPooledEther, totalPooledEther)
    assertBn(limiterValues.totalShares, totalShares)
    assertBn(limiterValues.rebaseLimit, rebaseLimit)
    assertBn(limiterValues.accumulatedRebase, bn(1000))
    assert.isFalse(await limiter.isLimitReached())

    const tx = await limiter.appendEther(ETH(2))
    assertEvent(tx, 'ReturnValue', { expectedArgs: { retValue: ETH(2) } })
    assert.isFalse(await limiter.isLimitReached())

    const tx2 = await limiter.appendEther(ETH(4))
    assertEvent(tx2, 'ReturnValue', { expectedArgs: { retValue: ETH(4) } })
    assert.isFalse(await limiter.isLimitReached())

    const tx3 = await limiter.appendEther(ETH(1))
    assertEvent(tx3, 'ReturnValue', { expectedArgs: { retValue: ETH(0.5) } })
    assert.isTrue(await limiter.isLimitReached())
  })

  it('deductShares', async () => {
    const rebaseLimit = bn('5000')
    const totalPooledEther = ETH(2000000)
    const totalShares = ETH(1000000)
    await limiter.initLimiterState(rebaseLimit, totalPooledEther, totalShares)

    await limiter.applyCLBalanceUpdate(ETH(1))
    assert.isFalse(await limiter.isLimitReached())

    const tx = await limiter.deductShares(ETH(2))
    assertEvent(tx, 'ReturnValue', { expectedArgs: { retValue: ETH(2) } })
    assert.isFalse(await limiter.isLimitReached())
    const limiterValues = await limiter.getLimiterValues()
    assertBn(limiterValues.totalPooledEther, totalPooledEther)
    assertBn(limiterValues.totalShares, totalShares)
    assertBn(limiterValues.rebaseLimit, rebaseLimit)
    assertBn(limiterValues.accumulatedRebase, bn(2500))

    const tx2 = await limiter.deductShares(ETH(4))
    assertEvent(tx2, 'ReturnValue', { expectedArgs: { retValue: bn('2499993750015624960') } })
    assert.isTrue(await limiter.isLimitReached())
  })

  it('zero tvl no reverts', async () => {
    const rebaseLimit = bn('5000')
    const totalPooledEther = ETH(0)
    const totalShares = ETH(0)

    await limiter.initLimiterState(rebaseLimit, totalPooledEther, totalShares)

    await limiter.applyCLBalanceUpdate(ETH(0))
    assert.isTrue(await limiter.isLimitReached())

    const ethTx = await limiter.appendEther(ETH(2))
    assert.isTrue(await limiter.isLimitReached())
    assertEvent(ethTx, 'ReturnValue', { expectedArgs: { retValue: ETH(0) } })


    const sharesTx = await limiter.deductShares(ETH(1))
    assert.isTrue(await limiter.isLimitReached())
    assertEvent(sharesTx, 'ReturnValue', { expectedArgs: { retValue: ETH(0) } })
  })
})
