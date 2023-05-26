const { contract } = require('hardhat')
const { assert } = require('../../helpers/assert')
const { toBN } = require('../../helpers/utils')

const {
  INITIAL_FAST_LANE_LENGTH_SLOTS,
  INITIAL_EPOCH,
  GENESIS_TIME,
  EPOCHS_PER_FRAME,
  SLOTS_PER_EPOCH,
  SECONDS_PER_SLOT,
  SLOTS_PER_FRAME,
  computeEpochFirstSlot,
  computeTimestampAtEpoch,
  ZERO_HASH,
  HASH_1,
  CONSENSUS_VERSION,
  deployHashConsensus,
} = require('./hash-consensus-deploy.test')

contract('HashConsensus', ([admin, member1, member2, member3]) => {
  const TEST_INITIAL_EPOCH = 3

  context('Frame methods', () => {
    let consensus = null
    const deploy = async (options = undefined) => {
      const deployed = await deployHashConsensus(admin, options)
      consensus = deployed.consensus
    }

    context('getFrameConfig', () => {
      before(deploy)
      it('should return initial data', async () => {
        assert.equals((await consensus.getFrameConfig()).epochsPerFrame, EPOCHS_PER_FRAME)
        assert.equals((await consensus.getFrameConfig()).initialEpoch, INITIAL_EPOCH)
        assert.equals((await consensus.getFrameConfig()).fastLaneLengthSlots, INITIAL_FAST_LANE_LENGTH_SLOTS)
      })

      it('should return new data', async () => {
        await consensus.setFrameConfig(100, 50)

        assert.equals((await consensus.getFrameConfig()).epochsPerFrame, 100)
        assert.equals((await consensus.getFrameConfig()).fastLaneLengthSlots, 50)
        assert.equals((await consensus.getFrameConfig()).initialEpoch, INITIAL_EPOCH)
      })
    })
    context('setFrameConfig', () => {
      beforeEach(deploy)

      it('should set data', async () => {
        await consensus.setFrameConfig(100, 50)

        assert.equals((await consensus.getFrameConfig()).epochsPerFrame, 100)
        assert.equals((await consensus.getFrameConfig()).fastLaneLengthSlots, 50)
        assert.equals((await consensus.getFrameConfig()).initialEpoch, INITIAL_EPOCH)
      })

      it('should set first epoch in next frame', async () => {
        await consensus.setTimeInEpochs(INITIAL_EPOCH + EPOCHS_PER_FRAME)
        await consensus.setFrameConfig(100, 50)

        assert.equals((await consensus.getFrameConfig()).epochsPerFrame, 100)
        assert.equals((await consensus.getFrameConfig()).fastLaneLengthSlots, 50)
        assert.equals((await consensus.getFrameConfig()).initialEpoch, EPOCHS_PER_FRAME + 1)
      })

      it('should revert if epochsPerFrame == 0', async () => {
        await assert.revertsWithCustomError(consensus.setFrameConfig(0, 50), 'EpochsPerFrameCannotBeZero()')
      })

      it('should revert if fastLaneLengthSlots > epochsPerFrame * SLOTS_PER_EPOCH', async () => {
        await assert.revertsWithCustomError(consensus.setFrameConfig(1, 50), 'FastLanePeriodCannotBeLongerThanFrame()')
      })

      it('should revert if epoch < config.initialEpoc', async () => {
        await consensus.setTimeInEpochs(INITIAL_EPOCH - 1)

        await assert.revertsWithCustomError(consensus.setFrameConfig(1, 50), 'InitialEpochIsYetToArrive()')
      })

      it('should emit FrameConfigSet & FastLaneConfigSet event', async () => {
        const tx = await consensus.setFrameConfig(100, 50)

        assert.emits(tx, 'FrameConfigSet', { newInitialEpoch: 1, newEpochsPerFrame: 100 })
        assert.emits(tx, 'FastLaneConfigSet', { fastLaneLengthSlots: 50 })
      })

      it('should not emit FrameConfigSet & FastLaneConfigSet event', async () => {
        const tx = await consensus.setFrameConfig(EPOCHS_PER_FRAME, 0)

        assert.notEmits(tx, 'FrameConfigSet')
        assert.notEmits(tx, 'FastLaneConfigSet')
      })
    })
  })

  context('State before initial epoch', () => {
    let consensus, reportProcessor

    before(async () => {
      const deployed = await deployHashConsensus(admin, { initialEpoch: null })
      consensus = deployed.consensus
      reportProcessor = deployed.reportProcessor
    })

    it(`after deploy, the initial epoch is far in the future`, async () => {
      const maxTimestamp = toBN(2).pow(toBN(64)).subn(1)
      const maxEpoch = maxTimestamp.subn(GENESIS_TIME).divn(SECONDS_PER_SLOT).divn(SLOTS_PER_EPOCH)
      assert.equals((await consensus.getFrameConfig()).initialEpoch, maxEpoch)

      const initialRefSlot = await consensus.getInitialRefSlot()
      assert.equals(initialRefSlot, maxEpoch.muln(SLOTS_PER_EPOCH).subn(1))
    })

    it(`after deploy, one can update initial epoch`, async () => {
      const tx = await consensus.updateInitialEpoch(TEST_INITIAL_EPOCH, { from: admin })

      assert.emits(tx, 'FrameConfigSet', {
        newEpochsPerFrame: EPOCHS_PER_FRAME,
        newInitialEpoch: TEST_INITIAL_EPOCH,
      })

      const frameConfig = await consensus.getFrameConfig()
      assert.equals(frameConfig.initialEpoch, TEST_INITIAL_EPOCH)
      assert.equals(frameConfig.epochsPerFrame, EPOCHS_PER_FRAME)
      assert.equals(frameConfig.fastLaneLengthSlots, INITIAL_FAST_LANE_LENGTH_SLOTS)

      const initialRefSlot = await consensus.getInitialRefSlot()
      assert.equals(initialRefSlot, +frameConfig.initialEpoch * SLOTS_PER_EPOCH - 1)
    })

    it(`one cannot update initial epoch so that initial ref slot is less than processed one`, async () => {
      await consensus.setTimeInEpochs(TEST_INITIAL_EPOCH - 2)

      const initialRefSlot = TEST_INITIAL_EPOCH * SLOTS_PER_EPOCH - 1
      await reportProcessor.setLastProcessingStartedRefSlot(initialRefSlot + 1)

      assert.reverts(
        consensus.updateInitialEpoch(TEST_INITIAL_EPOCH, { from: admin }),
        'InitialEpochRefSlotCannotBeEarlierThanProcessingSlot()'
      )

      await reportProcessor.setLastProcessingStartedRefSlot(0)
    })

    it(`before the initial epoch arrives, one can update it freely`, async () => {
      await consensus.setTimeInEpochs(TEST_INITIAL_EPOCH - 2)

      await consensus.updateInitialEpoch(TEST_INITIAL_EPOCH - 1, { from: admin })
      assert.equals((await consensus.getFrameConfig()).initialEpoch, TEST_INITIAL_EPOCH - 1)

      await consensus.updateInitialEpoch(TEST_INITIAL_EPOCH, { from: admin })
      assert.equals((await consensus.getFrameConfig()).initialEpoch, TEST_INITIAL_EPOCH)

      const initialRefSlot = await consensus.getInitialRefSlot()
      assert.equals(initialRefSlot, TEST_INITIAL_EPOCH * SLOTS_PER_EPOCH - 1)
    })

    it('before the initial epoch arrives, members can be added and queried, and quorum changed', async () => {
      await consensus.setTimeInEpochs(TEST_INITIAL_EPOCH - 1)

      await consensus.addMember(member3, 1, { from: admin })
      assert.isTrue(await consensus.getIsMember(member3))
      assert.equals(await consensus.getQuorum(), 1)

      await consensus.removeMember(member3, 2)
      assert.isFalse(await consensus.getIsMember(member3))
      assert.equals(await consensus.getQuorum(), 2)

      await consensus.addMember(member1, 1, { from: admin })
      await consensus.addMember(member2, 2, { from: admin })
      await consensus.addMember(member3, 2, { from: admin })
      assert.equals(await consensus.getQuorum(), 2)

      await consensus.setQuorum(4, { from: admin })
      assert.equals(await consensus.getQuorum(), 4)

      await consensus.setQuorum(3, { from: admin })
      assert.equals(await consensus.getQuorum(), 3)

      await consensus.removeMember(member3, 3)

      assert.isTrue(await consensus.getIsMember(member1))
      assert.isTrue(await consensus.getIsMember(member2))
      assert.isFalse(await consensus.getIsMember(member3))
      assert.equals(await consensus.getQuorum(), 3)

      assert.isFalse(await consensus.getIsMember(admin))

      const { addresses, lastReportedRefSlots } = await consensus.getMembers()
      assert.sameOrderedMembers(addresses, [member1, member2])
      assert.sameOrderedMembers(
        lastReportedRefSlots.map((x) => +x),
        [0, 0]
      )
    })

    it('but otherwise, the contract is dysfunctional', async () => {
      await assert.reverts(consensus.getCurrentFrame(), 'InitialEpochIsYetToArrive()')
      await assert.reverts(consensus.getConsensusState(), 'InitialEpochIsYetToArrive()')
      await assert.reverts(consensus.getConsensusStateForMember(member1), 'InitialEpochIsYetToArrive()')

      const firstRefSlot = TEST_INITIAL_EPOCH * SLOTS_PER_EPOCH - 1
      await assert.reverts(
        consensus.submitReport(firstRefSlot, HASH_1, CONSENSUS_VERSION, { from: member1 }),
        'InitialEpochIsYetToArrive()'
      )
    })

    it('after the initial epoch comes, the consensus contract becomes functional', async () => {
      await consensus.setTimeInEpochs(TEST_INITIAL_EPOCH)

      await consensus.setQuorum(2, { from: admin })
      assert.equals(await consensus.getQuorum(), 2)

      const frame = await consensus.getCurrentFrame()
      assert.equals(frame.refSlot, computeEpochFirstSlot(TEST_INITIAL_EPOCH) - 1)
      assert.equals(frame.reportProcessingDeadlineSlot, computeEpochFirstSlot(TEST_INITIAL_EPOCH) + SLOTS_PER_FRAME - 1)

      const consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, ZERO_HASH)

      const memberInfo = await consensus.getConsensusStateForMember(member1)
      assert.isTrue(memberInfo.isMember)
      assert.equals(memberInfo.currentFrameRefSlot, +frame.refSlot)
      assert.equals(memberInfo.lastMemberReportRefSlot, 0)

      const tx = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
      assert.emits(tx, 'ReportReceived', { refSlot: frame.refSlot, member: member1, report: HASH_1 })
    })

    it('after the initial epoch comes, updating it via updateInitialEpoch is not possible anymore', async () => {
      await assert.reverts(
        consensus.updateInitialEpoch(TEST_INITIAL_EPOCH + 1, { from: admin }),
        'InitialEpochAlreadyArrived()'
      )
      await assert.reverts(
        consensus.updateInitialEpoch(TEST_INITIAL_EPOCH - 1, { from: admin }),
        'InitialEpochAlreadyArrived()'
      )
    })
  })

  context('Reporting interval manipulation', () => {
    let consensus

    beforeEach(async () => {
      const deployed = await deployHashConsensus(admin, { initialEpoch: 1 })
      consensus = deployed.consensus
      await consensus.addMember(member1, 1, { from: admin })
    })

    it(`crossing frame boundary time advances reference and deadline slots by the frame size`, async () => {
      assert.equals(await consensus.getTime(), computeTimestampAtEpoch(1))

      await consensus.setFrameConfig(5, 0)
      assert.equals((await consensus.getFrameConfig()).initialEpoch, 1)

      /// epochs  00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20
      /// before    |-------------r|-------------^|--------------|--------------|
      /// after     |--------------|-------------r|^-------------|--------------|
      ///
      /// notice: this timestamp cannot occur in reality since the time has the discreteness
      /// of SECONDS_PER_SLOT after the Merge; however, we're ignoring this to test the math
      await consensus.setTime(computeTimestampAtEpoch(11) - 1)

      const frame = await consensus.getCurrentFrame()
      assert.equals(frame.refSlot, computeEpochFirstSlot(6) - 1)
      assert.equals(frame.reportProcessingDeadlineSlot, computeEpochFirstSlot(11) - 1)

      await consensus.setTime(computeTimestampAtEpoch(11))

      const newFrame = await consensus.getCurrentFrame()
      assert.equals(newFrame.refSlot, computeEpochFirstSlot(11) - 1)
      assert.equals(newFrame.reportProcessingDeadlineSlot, computeEpochFirstSlot(16) - 1)
    })

    it('increasing frame size always keeps the current start slot', async () => {
      assert.equals(await consensus.getTime(), computeTimestampAtEpoch(1))

      await consensus.setFrameConfig(5, 0)
      assert.equals((await consensus.getFrameConfig()).initialEpoch, 1)

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
      assert.equals(frame.refSlot, computeEpochFirstSlot(6) - 1)
      assert.equals(frame.reportProcessingDeadlineSlot, computeEpochFirstSlot(11) - 1)

      await consensus.setFrameConfig(7, 0)

      const newFrame = await consensus.getCurrentFrame()
      assert.equals(newFrame.refSlot, computeEpochFirstSlot(6) - 1)
      assert.equals(newFrame.reportProcessingDeadlineSlot, computeEpochFirstSlot(13) - 1)
    })

    it(`decreasing the frame size cannot decrease the current reference slot`, async () => {
      assert.equals(await consensus.getTime(), computeTimestampAtEpoch(1))

      await consensus.setFrameConfig(5, 0)
      assert.equals((await consensus.getFrameConfig()).initialEpoch, 1)

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
      assert.equals(frame.refSlot, computeEpochFirstSlot(6) - 1)
      assert.equals(frame.reportProcessingDeadlineSlot, computeEpochFirstSlot(11) - 1)

      await consensus.setFrameConfig(4, 0)

      const newFrame = await consensus.getCurrentFrame()
      assert.equals(newFrame.refSlot, computeEpochFirstSlot(6) - 1)
      assert.equals(newFrame.reportProcessingDeadlineSlot, computeEpochFirstSlot(10) - 1)
    })

    it('decreasing the frame size may advance the current reference slot, but at least by the new frame size', async () => {
      assert.equals(await consensus.getTime(), computeTimestampAtEpoch(1))

      await consensus.setFrameConfig(5, 0)
      assert.equals((await consensus.getFrameConfig()).initialEpoch, 1)

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
      assert.equals(frame.refSlot, computeEpochFirstSlot(6) - 1)
      assert.equals(frame.reportProcessingDeadlineSlot, computeEpochFirstSlot(11) - 1)

      await consensus.setFrameConfig(4, 0)

      const newFrame = await consensus.getCurrentFrame()
      assert.equals(newFrame.refSlot, computeEpochFirstSlot(10) - 1)
      assert.equals(newFrame.reportProcessingDeadlineSlot, computeEpochFirstSlot(14) - 1)
    })
  })
})
