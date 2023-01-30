const { assert } = require('chai')
const { assertBn, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { assertRevert } = require('../../helpers/assertThrow')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const {
  SLOTS_PER_EPOCH, SECONDS_PER_SLOT, GENESIS_TIME, SECONDS_PER_EPOCH,
  computeSlotAt, computeEpochAt, computeEpochFirstSlotAt,
  computeEpochFirstSlot, computeTimestampAtSlot, computeTimestampAtEpoch,
  ZERO_HASH, HASH_1, HASH_2, HASH_3, HASH_4, HASH_5, CONSENSUS_VERSION,
  deployHashConsensus } = require('./hash-consensus-deploy.test')

const HashConsensus = artifacts.require('HashConsensusTimeTravellable')
const MockReportProcessor = artifacts.require('MockReportProcessor')


contract('HashConsensus', ([admin, member1]) => {
  context('Reporting interval manipulation', () => {
    let consensus
    let reportProcessor

    beforeEach(async () => {
      const deployed = await deployHashConsensus(admin)
      consensus = deployed.consensus
      reportProcessor = deployed.reportProcessor
      await consensus.addMember(member1, 1, { from: admin })
    })

    const computeIthFrameStartSlot = (frameIndex, epochsPerFrame, initialEpoch) =>
      (initialEpoch + frameIndex * epochsPerFrame) * SLOTS_PER_EPOCH

    const computeIthFrameStartTime = (frameIndex, epochsPerFrame, initialEpoch) =>
      computeTimestampAtSlot(computeIthFrameStartSlot(frameIndex, epochsPerFrame, initialEpoch))


    it(`crossing frame boundary time advances reference and deadline slots by the frame size`,
      async () =>
    {
      assert.equal(+await consensus.getTime(), computeTimestampAtEpoch(1))

      await consensus.setEpochsPerFrame(5)
      assert.equal(+(await consensus.getFrameConfig()).initialEpoch, 1)

      /// epochs  00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20
      /// before    |-------------r|-------------^|--------------|--------------|
      /// after     |--------------|-------------r|^-------------|--------------|
      ///
      /// notice: this timestamp cannot occur in reality since the time has the discreteness
      /// of SECONDS_PER_SLOT after the Merge; however, we're ignoring this to test the math
      await consensus.setTime(computeTimestampAtEpoch(11) - 1)

      const frame = await consensus.getCurrentFrame()
      assert.equal(+frame.refSlot, computeEpochFirstSlot(6) - 1)
      assert.equal(+frame.reportProcessingDeadlineSlot, computeEpochFirstSlot(11) - 1)

      await consensus.setTime(computeTimestampAtEpoch(11))

      const newFrame = await consensus.getCurrentFrame()
      assert.equal(+newFrame.refSlot, computeEpochFirstSlot(11) - 1)
      assert.equal(+newFrame.reportProcessingDeadlineSlot, computeEpochFirstSlot(16) - 1)
    })

    it('increasing frame size always keeps the current start slot', async () => {
      assert.equal(+await consensus.getTime(), computeTimestampAtEpoch(1))

      await consensus.setEpochsPerFrame(5)
      assert.equal(+(await consensus.getFrameConfig()).initialEpoch, 1)

      /// we're at the last slot of the frame 1 spanning epochs 6-10
      ///
      ///        epochs  00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20
      /// frames before    |-------------r|-------------^|--------------|--------------|
      ///  frames after    |-------------r|-------------^------|--------------------|---
      ///                  |
      /// NOT like this    |-------------------r|-------^-------------|-----------------
      ///
      await consensus.setTime(computeTimestampAtEpoch(11) - SECONDS_PER_SLOT)

      const frame = await consensus.getCurrentFrame()
      assert.equal(+frame.refSlot, computeEpochFirstSlot(6) - 1)
      assert.equal(+frame.reportProcessingDeadlineSlot, computeEpochFirstSlot(11) - 1)

      await consensus.setEpochsPerFrame(7)

      const newFrame = await consensus.getCurrentFrame()
      assert.equal(+newFrame.refSlot, computeEpochFirstSlot(6) - 1)
      assert.equal(+newFrame.reportProcessingDeadlineSlot, computeEpochFirstSlot(13) - 1)
    })

    it(`decreasing the frame size cannot decrease the current reference slot`, async () => {
      assert.equal(+await consensus.getTime(), computeTimestampAtEpoch(1))

      await consensus.setEpochsPerFrame(5)
      assert.equal(+(await consensus.getFrameConfig()).initialEpoch, 1)

      /// we're in the first half of the frame 1 spanning epochs 6-10
      ///
      ///        epochs  00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20
      /// frames before    |-------------r|---^----------|--------------|--------------|
      ///  frames after    |-------------r|---^-------|-----------|-----------|--------|
      ///                  |
      /// NOT like this    |----------r|------^----|-----------|-----------|-----------|
      ///
      await consensus.setTime(computeTimestampAtEpoch(7))

      const frame = await consensus.getCurrentFrame()
      assert.equal(+frame.refSlot, computeEpochFirstSlot(6) - 1)
      assert.equal(+frame.reportProcessingDeadlineSlot, computeEpochFirstSlot(11) - 1)

      await consensus.setEpochsPerFrame(4)

      const newFrame = await consensus.getCurrentFrame()
      assert.equal(+newFrame.refSlot, computeEpochFirstSlot(6) - 1)
      assert.equal(+newFrame.reportProcessingDeadlineSlot, computeEpochFirstSlot(10) - 1)
    })

    it(`decreasing the frame size may advance the current reference slot, ` +
       `but at least by the new frame size`, async () =>
    {
      assert.equal(+await consensus.getTime(), computeTimestampAtEpoch(1))

      await consensus.setEpochsPerFrame(5)
      assert.equal(+(await consensus.getFrameConfig()).initialEpoch, 1)

      /// we're at the end of the frame 1 spanning epochs 6-10
      ///
      ///        epochs  00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20
      /// frames before    |-------------r|------------^-|--------------|--------------|
      ///  frames after    |--------------|----------r|^----------|-----------|---------
      ///                  |
      /// NOT like this    |-----------|----------r|---^-------|-----------|-----------|
      ///
      await consensus.setTime(computeTimestampAtEpoch(10))

      const frame = await consensus.getCurrentFrame()
      assert.equal(+frame.refSlot, computeEpochFirstSlot(6) - 1)
      assert.equal(+frame.reportProcessingDeadlineSlot, computeEpochFirstSlot(11) - 1)

      await consensus.setEpochsPerFrame(4)

      const newFrame = await consensus.getCurrentFrame()
      assert.equal(+newFrame.refSlot, computeEpochFirstSlot(10) - 1)
      assert.equal(+newFrame.reportProcessingDeadlineSlot, computeEpochFirstSlot(14) - 1)
    })
  })
})
