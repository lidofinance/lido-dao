const { artifacts, contract, ethers } = require('hardhat')

const { bn } = require('@aragon/contract-helpers-test')
const { EvmSnapshot, advanceChainTime, getCurrentBlockTimestamp } = require('../helpers/blockchain')
const { assert } = require('../helpers/assert')

const PausableUntil = artifacts.require('PausableUntilPrivateExposed')

contract('PausableUntil', ([deployer]) => {
  let pausable
  let PAUSE_INFINITELY
  let snapshot

  before('deploy lido with dao', async () => {
    pausable = await PausableUntil.new({ from: deployer })
    PAUSE_INFINITELY = await pausable.PAUSE_INFINITELY()

    snapshot = new EvmSnapshot(ethers.provider)
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  /// Check views, modifiers and capability to pause/resume
  async function assertPausedState(resumeSinceTimestamp = undefined) {
    assert.isTrue(await pausable.isPaused())
    assert.isTrue((await pausable.getResumeSinceTimestamp()) > (await getCurrentBlockTimestamp()))
    assert.equals(await pausable.stubUnderModifierWhenPaused(), bn(42))
    if (resumeSinceTimestamp !== undefined) {
      assert.equals(await pausable.getResumeSinceTimestamp(), resumeSinceTimestamp)
    }

    await assert.revertsWithCustomError(pausable.pauseFor(12345), `ResumedExpected()`)
    await assert.revertsWithCustomError(pausable.stubUnderModifierWhenResumed(), `ResumedExpected()`)
  }

  /// Check views, modifiers and capability to pause/resume
  async function assertResumedState() {
    assert.isFalse(await pausable.isPaused())
    assert.isTrue((await pausable.getResumeSinceTimestamp()) <= (await getCurrentBlockTimestamp()))
    assert.equals(await pausable.stubUnderModifierWhenResumed(), bn(42))
    await assert.revertsWithCustomError(pausable.stubUnderModifierWhenPaused(), `PausedExpected()`)
    await assert.revertsWithCustomError(pausable.resume(), `PausedExpected()`)
  }

  describe('Logic', () => {
    it(`state after deployment`, async () => {
      await assertResumedState()
      assert.equals(await pausable.getResumeSinceTimestamp(), bn(0))
    })

    it(`revert if pause for zero duration`, async () => {
      await assert.revertsWithCustomError(pausable.pauseFor(0), `ZeroPauseDuration()`)
    })

    it(`pause infinitely`, async () => {
      await assertResumedState()
      const MONTH_IN_SECS = 30 * 24 * 60 * 60

      await pausable.pauseFor(PAUSE_INFINITELY)
      await assertPausedState(PAUSE_INFINITELY)

      await advanceChainTime(MONTH_IN_SECS)
      await assertPausedState(PAUSE_INFINITELY)

      await advanceChainTime(12 * MONTH_IN_SECS)
      await assertPausedState(PAUSE_INFINITELY)
    })

    it(`pause for specific duration`, async () => {
      assert.isFalse(await pausable.isPaused())
      const pauseDuration = 3 * 60

      await pausable.pauseFor(pauseDuration)
      const resumeSinceTimestamp = (await getCurrentBlockTimestamp()) + pauseDuration
      await assertPausedState(resumeSinceTimestamp)

      await advanceChainTime(Math.floor(pauseDuration / 2))
      assert.isTrue(await pausable.isPaused())
      await advanceChainTime(resumeSinceTimestamp - 1 - (await getCurrentBlockTimestamp()))
      assert.equals(await getCurrentBlockTimestamp(), resumeSinceTimestamp - 1)
      // Check only view here because with reverted transactions chain can pass more than 1 seconds
      assert.isTrue(await pausable.isPaused())

      await advanceChainTime(1)
      assert.equals(await getCurrentBlockTimestamp(), resumeSinceTimestamp)
      await assertResumedState()
    })

    it(`pause until infinity`, async () => {
      await assertResumedState()
      const MONTH_IN_SECS = 30 * 24 * 60 * 60

      await pausable.pauseUntil(PAUSE_INFINITELY)
      await assertPausedState(PAUSE_INFINITELY)

      await advanceChainTime(MONTH_IN_SECS)
      await assertPausedState(PAUSE_INFINITELY)

      await advanceChainTime(12 * MONTH_IN_SECS)
      await assertPausedState(PAUSE_INFINITELY)
    })

    it(`pause until`, async () => {
      assert.isFalse(await pausable.isPaused())
      const pauseDuration = 3 * 60
      const pauseUntilInclusive = (await getCurrentBlockTimestamp()) + pauseDuration - 1
      const resumeSinceTimestamp = pauseUntilInclusive + 1

      await pausable.pauseUntil(pauseUntilInclusive)
      await assertPausedState(resumeSinceTimestamp)

      await advanceChainTime(Math.floor(pauseDuration / 2))
      assert.isTrue(await pausable.isPaused())
      await advanceChainTime(resumeSinceTimestamp - 1 - (await getCurrentBlockTimestamp()))
      assert.equals(await getCurrentBlockTimestamp(), resumeSinceTimestamp - 1)
      // Check only view here because with reverted transactions chain can pass more than 1 seconds
      assert.isTrue(await pausable.isPaused())

      await advanceChainTime(1)
      assert.equals(await getCurrentBlockTimestamp(), resumeSinceTimestamp)
      await assertResumedState()
    })

    it(`resume`, async () => {
      await pausable.pauseFor(PAUSE_INFINITELY)
      await pausable.resume()
      await assertResumedState()

      await pausable.pauseFor(123)
      await pausable.resume()
      await assertResumedState()
    })
  })
})
