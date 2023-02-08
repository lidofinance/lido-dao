const { assert } = require('chai')
const { assertBn, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { assertRevert } = require('../../helpers/assertThrow')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const {
  SLOTS_PER_EPOCH, SECONDS_PER_SLOT, GENESIS_TIME, SECONDS_PER_EPOCH, SLOTS_PER_FRAME,
  computeSlotAt, computeEpochAt, computeEpochFirstSlotAt,
  computeEpochFirstSlot, computeTimestampAtSlot, computeTimestampAtEpoch,
  ZERO_HASH, HASH_1, HASH_2, HASH_3, HASH_4, HASH_5, CONSENSUS_VERSION,
  deployHashConsensus } = require('./hash-consensus-deploy.test')

const HashConsensus = artifacts.require('HashConsensusTimeTravellable')
const MockReportProcessor = artifacts.require('MockReportProcessor')


const getFrameIndex = (time, epochsPerFrame, initialEpoch) =>
  Math.floor((computeEpochAt(time) - initialEpoch) / epochsPerFrame)

const computeIthFrameStartSlot = (frameIndex, epochsPerFrame, initialEpoch) =>
  (initialEpoch + frameIndex * epochsPerFrame) * SLOTS_PER_EPOCH

const computeIthFrameStartTime = (frameIndex, epochsPerFrame, initialEpoch) =>
  computeTimestampAtSlot(computeIthFrameStartSlot(frameIndex, epochsPerFrame, initialEpoch))

const computeNextFrameStartSlot = (time, epochsPerFrame, initialEpoch) =>
  computeIthFrameStartSlot(getFrameIndex(time, epochsPerFrame, initialEpoch), epochsPerFrame, initialEpoch)


contract('HashConsensus', ([admin, member1, member2]) => {
  const INITIAL_EPOCH = 3

  context('State before initial epoch', () => {
    let consensus

    before(async () => {
      const deployed = await deployHashConsensus(admin, {initialEpoch: INITIAL_EPOCH})
      consensus = deployed.consensus
    })

    it('before the initial epoch arrives, members can be added and queried, and quorum increased',
      async () =>
    {
      await consensus.setTimeInEpochs(INITIAL_EPOCH - 1)

      await consensus.addMember(member1, 1, {from: admin})
      await consensus.addMember(member2, 2, {from: admin})
      await consensus.setQuorum(3, {from: admin})

      assert.equal(+await consensus.getQuorum(), 3)

      assert.isTrue(await consensus.getIsMember(member1))
      assert.isTrue(await consensus.getIsMember(member2))
      assert.isFalse(await consensus.getIsMember(admin))

      const {addresses, lastReportedRefSlots} = await consensus.getMembers()
      assert.sameOrderedMembers(addresses, [member1, member2])
      assert.sameOrderedMembers(lastReportedRefSlots.map(x => +x), [0, 0])
    })

    it('but otherwise, the contract is dysfunctional', async () => {
      await assertRevert(consensus.removeMember(member2, 2), 'InitialEpochIsYetToArrive()')
      await assertRevert(consensus.removeMember(member2, 1), 'InitialEpochIsYetToArrive()')
      await assertRevert(consensus.setQuorum(2), 'InitialEpochIsYetToArrive()')

      await assertRevert(consensus.getCurrentFrame(), 'InitialEpochIsYetToArrive()')
      await assertRevert(consensus.getConsensusState(), 'InitialEpochIsYetToArrive()')
      await assertRevert(consensus.getConsensusStateForMember(member1), 'InitialEpochIsYetToArrive()')

      const firstRefSlot = INITIAL_EPOCH * SLOTS_PER_EPOCH - 1
      await assertRevert(
        consensus.submitReport(firstRefSlot, HASH_1, CONSENSUS_VERSION, { from: member1 }),
        'InitialEpochIsYetToArrive()'
      )
    })

    it('after the initial epoch comes, the consensus contract becomes functional', async () => {
      await consensus.setTimeInEpochs(INITIAL_EPOCH)

      await consensus.setQuorum(2, {from: admin})
      assert.equal(+await consensus.getQuorum(), 2)

      const frame = await consensus.getCurrentFrame()
      assert.equal(+frame.refSlot, computeEpochFirstSlot(INITIAL_EPOCH) - 1)
      assert.equal(+frame.reportProcessingDeadlineSlot, computeEpochFirstSlot(INITIAL_EPOCH) + SLOTS_PER_FRAME - 1)

      const consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, ZERO_HASH)

      const memberInfo = await consensus.getConsensusStateForMember(member1)
      assert.isTrue(memberInfo.isMember)
      assert.equal(+memberInfo.currentFrameRefSlot, +frame.refSlot)
      assert.equal(+memberInfo.lastMemberReportRefSlot, 0)

      const tx = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, {from: member1})
      assertEvent(tx, 'ReportReceived', {expectedArgs: {refSlot: frame.refSlot, member: member1, report: HASH_1}})
    })
  })

  context('Reporting interval manipulation', () => {
    let consensus

    beforeEach(async () => {
      const deployed = await deployHashConsensus(admin, {initialEpoch: 1})
      consensus = deployed.consensus
      await consensus.addMember(member1, 1, {from: admin})
    })

    it(`crossing frame boundary time advances reference and deadline slots by the frame size`,
      async () =>
    {
      assert.equal(+await consensus.getTime(), computeTimestampAtEpoch(1))

      await consensus.setFrameConfig(5, 0)
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

      await consensus.setFrameConfig(5, 0)
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

      await consensus.setFrameConfig(7, 0)

      const newFrame = await consensus.getCurrentFrame()
      assert.equal(+newFrame.refSlot, computeEpochFirstSlot(6) - 1)
      assert.equal(+newFrame.reportProcessingDeadlineSlot, computeEpochFirstSlot(13) - 1)
    })

    it(`decreasing the frame size cannot decrease the current reference slot`, async () => {
      assert.equal(+await consensus.getTime(), computeTimestampAtEpoch(1))

      await consensus.setFrameConfig(5, 0)
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

      await consensus.setFrameConfig(4, 0)

      const newFrame = await consensus.getCurrentFrame()
      assert.equal(+newFrame.refSlot, computeEpochFirstSlot(6) - 1)
      assert.equal(+newFrame.reportProcessingDeadlineSlot, computeEpochFirstSlot(10) - 1)
    })

    it(`decreasing the frame size may advance the current reference slot, ` +
       `but at least by the new frame size`, async () =>
    {
      assert.equal(+await consensus.getTime(), computeTimestampAtEpoch(1))

      await consensus.setFrameConfig(5, 0)
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

      await consensus.setFrameConfig(4, 0)

      const newFrame = await consensus.getCurrentFrame()
      assert.equal(+newFrame.refSlot, computeEpochFirstSlot(10) - 1)
      assert.equal(+newFrame.reportProcessingDeadlineSlot, computeEpochFirstSlot(14) - 1)
    })
  })
})
