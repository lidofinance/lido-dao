const { contract } = require('hardhat')
const { assert } = require('../../helpers/assert')

const {
  SLOTS_PER_EPOCH,
  SECONDS_PER_SLOT,
  EPOCHS_PER_FRAME,
  SECONDS_PER_EPOCH,
  SECONDS_PER_FRAME,
  SLOTS_PER_FRAME,
  computeEpochFirstSlotAt,
  computeTimestampAtEpoch,
  computeTimestampAtSlot,
  ZERO_HASH,
  HASH_1,
  HASH_2,
  HASH_3,
  CONSENSUS_VERSION,
  deployHashConsensus,
} = require('./hash-consensus-deploy.test')

contract('HashConsensus', ([admin, member1, member2, member3, stranger]) => {
  let consensus
  let reportProcessor

  context('Happy path', () => {
    const INITIAL_EPOCH = 3

    it('deploying hash consensus', async () => {
      const deployed = await deployHashConsensus(admin, { initialEpoch: INITIAL_EPOCH })
      consensus = deployed.consensus
      reportProcessor = deployed.reportProcessor
    })

    it('adding members', async () => {
      await consensus.addMember(member1, 1, { from: admin })
      assert.equal(await consensus.getIsMember(member1), true)
      assert.equals(await consensus.getQuorum(), 1)

      await consensus.addMember(member2, 2, { from: admin })
      assert.equal(await consensus.getIsMember(member2), true)
      assert.equals(await consensus.getQuorum(), 2)

      await consensus.addMember(member3, 2, { from: admin })
      assert.equal(await consensus.getIsMember(member3), true)
      assert.equals(await consensus.getQuorum(), 2)
    })

    it('some fraction of the reporting frame passes', async () => {
      assert.equals(await consensus.getTime(), computeTimestampAtEpoch(INITIAL_EPOCH))
      await consensus.advanceTimeBySlots(3)
      assert.equals(await consensus.getTime(), computeTimestampAtEpoch(INITIAL_EPOCH) + 3 * SECONDS_PER_SLOT)
    })

    let frame

    it('reporting frame changes as more time passes', async () => {
      const frame1 = await consensus.getCurrentFrame()
      const time = +(await consensus.getTime())
      const expectedRefSlot = computeEpochFirstSlotAt(time) - 1
      const expectedDeadlineSlot = expectedRefSlot + EPOCHS_PER_FRAME * SLOTS_PER_EPOCH

      assert.equals(frame1.refSlot, expectedRefSlot)
      assert.equals(frame1.reportProcessingDeadlineSlot, expectedDeadlineSlot)

      await consensus.advanceTimeBy(SECONDS_PER_FRAME)
      const frame2 = await consensus.getCurrentFrame()

      assert.equals(frame2.refSlot, expectedRefSlot + SLOTS_PER_FRAME)
      assert.equals(frame2.reportProcessingDeadlineSlot, expectedDeadlineSlot + SLOTS_PER_FRAME)

      frame = frame2
    })

    it('first member votes for hash 3', async () => {
      assert.isTrue((await consensus.getConsensusStateForMember(member1)).canReport)

      const tx = await consensus.submitReport(frame.refSlot, HASH_3, CONSENSUS_VERSION, { from: member1 })

      assert.emits(tx, 'ReportReceived', { refSlot: frame.refSlot, member: member1, report: HASH_3 })
      assert.notEmits(tx, 'ConsensusReached')

      const memberInfo = await consensus.getConsensusStateForMember(member1)
      assert.isTrue(memberInfo.isMember)
      assert.equals(memberInfo.lastMemberReportRefSlot, +frame.refSlot)
      assert.equals(memberInfo.currentFrameRefSlot, +frame.refSlot)
      assert.equal(memberInfo.currentFrameMemberReport, HASH_3)
      assert.isTrue(memberInfo.canReport)
    })

    it('consensus is not reached', async () => {
      const consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, ZERO_HASH)
      assert.isFalse(consensusState.isReportProcessing)
      assert.equals((await reportProcessor.getLastCall_submitReport()).callCount, 0)
      assert.equals((await reportProcessor.getLastCall_discardReport()).callCount, 0)

      const memberInfo = await consensus.getConsensusStateForMember(member1)
      assert.equal(memberInfo.currentFrameConsensusReport, ZERO_HASH)
    })

    it('second member votes for hash 1', async () => {
      await consensus.advanceTimeBy(SECONDS_PER_EPOCH + 70)

      assert.isTrue((await consensus.getConsensusStateForMember(member2)).canReport)

      const tx = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })

      assert.emits(tx, 'ReportReceived', { refSlot: frame.refSlot, member: member2, report: HASH_1 })
      assert.notEmits(tx, 'ConsensusReached')

      const memberInfo = await consensus.getConsensusStateForMember(member2)
      assert.isTrue(memberInfo.isMember)
      assert.equals(memberInfo.lastMemberReportRefSlot, +frame.refSlot)
      assert.equals(memberInfo.currentFrameRefSlot, +frame.refSlot)
      assert.equal(memberInfo.currentFrameMemberReport, HASH_1)
      assert.isTrue(memberInfo.canReport)
    })

    it('consensus is not reached', async () => {
      const consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, ZERO_HASH)
      assert.isFalse(consensusState.isReportProcessing)
      assert.equals((await reportProcessor.getLastCall_submitReport()).callCount, 0)
      assert.equals((await reportProcessor.getLastCall_discardReport()).callCount, 0)

      const memberInfo = await consensus.getConsensusStateForMember(member1)
      assert.equal(memberInfo.currentFrameConsensusReport, ZERO_HASH)
    })

    it('third member votes for hash 3', async () => {
      await consensus.advanceTimeBy(SECONDS_PER_EPOCH + 5)

      assert.isTrue((await consensus.getConsensusStateForMember(member3)).canReport)

      const tx = await consensus.submitReport(frame.refSlot, HASH_3, CONSENSUS_VERSION, { from: member3 })

      assert.emits(tx, 'ReportReceived', { refSlot: frame.refSlot, member: member3, report: HASH_3 })
      assert.emits(tx, 'ConsensusReached', { refSlot: frame.refSlot, report: HASH_3, support: 2 })

      const memberInfo = await consensus.getConsensusStateForMember(member3)
      assert.isTrue(memberInfo.isMember)
      assert.equals(memberInfo.lastMemberReportRefSlot, +frame.refSlot)
      assert.equals(memberInfo.currentFrameRefSlot, +frame.refSlot)
      assert.equal(memberInfo.currentFrameMemberReport, HASH_3)
      assert.isTrue(memberInfo.canReport)
    })

    it('consensus is reached', async () => {
      const consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, HASH_3)
      assert.isFalse(consensusState.isReportProcessing)

      const memberInfo = await consensus.getConsensusStateForMember(member1)
      assert.equal(memberInfo.currentFrameConsensusReport, HASH_3)

      const submitReportLastCall = await reportProcessor.getLastCall_submitReport()
      assert.equals(submitReportLastCall.callCount, 1)
      assert.equal(submitReportLastCall.report, HASH_3)
      assert.equals(submitReportLastCall.refSlot, +frame.refSlot)
      assert.equals(submitReportLastCall.deadline, computeTimestampAtSlot(frame.reportProcessingDeadlineSlot))

      assert.equals((await reportProcessor.getLastCall_discardReport()).callCount, 0)
    })

    it('first member re-votes for hash 1', async () => {
      await consensus.advanceTimeBy(SECONDS_PER_EPOCH + 5)

      assert.isTrue((await consensus.getConsensusStateForMember(member1)).canReport)

      const tx = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })

      assert.emits(tx, 'ReportReceived', { refSlot: frame.refSlot, member: member1, report: HASH_1 })
      assert.emits(tx, 'ConsensusReached', { refSlot: frame.refSlot, report: HASH_1, support: 2 })

      const memberInfo = await consensus.getConsensusStateForMember(member1)
      assert.isTrue(memberInfo.isMember)
      assert.equals(memberInfo.lastMemberReportRefSlot, +frame.refSlot)
      assert.equals(memberInfo.currentFrameRefSlot, +frame.refSlot)
      assert.equal(memberInfo.currentFrameMemberReport, HASH_1)
      assert.isTrue(memberInfo.canReport)
    })

    it('new consensus is reached', async () => {
      const consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, HASH_1)
      assert.isFalse(consensusState.isReportProcessing)

      const memberInfo = await consensus.getConsensusStateForMember(member1)
      assert.equal(memberInfo.currentFrameConsensusReport, HASH_1)

      const submitReportLastCall = await reportProcessor.getLastCall_submitReport()
      assert.equals(submitReportLastCall.callCount, 2)
      assert.equal(submitReportLastCall.report, HASH_1)
      assert.equals(submitReportLastCall.refSlot, +frame.refSlot)
      assert.equals(submitReportLastCall.deadline, computeTimestampAtSlot(frame.reportProcessingDeadlineSlot))

      assert.equals((await reportProcessor.getLastCall_discardReport()).callCount, 0)
    })

    it('second member re-votes for hash 2', async () => {
      await consensus.advanceTimeBy(SECONDS_PER_EPOCH + 5)

      assert.isTrue((await consensus.getConsensusStateForMember(member2)).canReport)

      const tx = await consensus.submitReport(frame.refSlot, HASH_2, CONSENSUS_VERSION, { from: member2 })

      assert.emits(tx, 'ReportReceived', { refSlot: frame.refSlot, member: member2, report: HASH_2 })
      assert.emits(tx, 'ConsensusLost', { refSlot: frame.refSlot })

      const memberInfo = await consensus.getConsensusStateForMember(member2)
      assert.isTrue(memberInfo.isMember)
      assert.equals(memberInfo.lastMemberReportRefSlot, +frame.refSlot)
      assert.equals(memberInfo.currentFrameRefSlot, +frame.refSlot)
      assert.equal(memberInfo.currentFrameMemberReport, HASH_2)
      assert.isTrue(memberInfo.canReport)
    })

    it('consensus is lost', async () => {
      const consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, ZERO_HASH)
      assert.isFalse(consensusState.isReportProcessing)

      const memberInfo = await consensus.getConsensusStateForMember(member1)
      assert.equal(memberInfo.currentFrameConsensusReport, ZERO_HASH)

      const submitReportLastCall = await reportProcessor.getLastCall_submitReport()
      assert.equals(submitReportLastCall.callCount, 2)

      const discardReportLastCall = await reportProcessor.getLastCall_discardReport()
      assert.equals(discardReportLastCall.callCount, 1)
      assert.equals(discardReportLastCall.refSlot, +frame.refSlot)
    })

    it('second member re-votes for hash 1', async () => {
      await consensus.advanceTimeBy(SECONDS_PER_EPOCH + 5)

      assert.isTrue((await consensus.getConsensusStateForMember(member2)).canReport)

      const tx = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })

      assert.emits(tx, 'ReportReceived', { refSlot: frame.refSlot, member: member2, report: HASH_1 })
      assert.emits(tx, 'ConsensusReached', { refSlot: frame.refSlot, report: HASH_1, support: 2 })

      const memberInfo = await consensus.getConsensusStateForMember(member2)
      assert.isTrue(memberInfo.isMember)
      assert.equals(memberInfo.lastMemberReportRefSlot, +frame.refSlot)
      assert.equals(memberInfo.currentFrameRefSlot, +frame.refSlot)
      assert.equal(memberInfo.currentFrameMemberReport, HASH_1)
      assert.isTrue(memberInfo.canReport)
    })

    it('consensus is reached again', async () => {
      const consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, HASH_1)
      assert.isFalse(consensusState.isReportProcessing)

      const memberInfo = await consensus.getConsensusStateForMember(member1)
      assert.equal(memberInfo.currentFrameConsensusReport, HASH_1)

      const submitReportLastCall = await reportProcessor.getLastCall_submitReport()
      assert.equals(submitReportLastCall.callCount, 3)
      assert.equal(submitReportLastCall.report, HASH_1)
      assert.equals(submitReportLastCall.refSlot, +frame.refSlot)
      assert.equals(submitReportLastCall.deadline, computeTimestampAtSlot(frame.reportProcessingDeadlineSlot))

      assert.equals((await reportProcessor.getLastCall_discardReport()).callCount, 1)
    })

    it('report processor starts processing the report', async () => {
      await consensus.advanceTimeBy(SECONDS_PER_EPOCH + 33)

      await reportProcessor.startReportProcessing()

      const consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, HASH_1)
      assert.isTrue(consensusState.isReportProcessing)
    })

    it('second member cannot change their vote anymore', async () => {
      await consensus.advanceTimeBy(SECONDS_PER_EPOCH + 70)

      assert.isFalse((await consensus.getConsensusStateForMember(member2)).canReport)

      await assert.reverts(
        consensus.submitReport(frame.refSlot, HASH_3, CONSENSUS_VERSION, { from: member2 }),
        'ConsensusReportAlreadyProcessing()'
      )
    })

    let prevFrame
    let newFrame

    it('time passes, a new frame starts', async () => {
      await consensus.advanceTimeBy(SECONDS_PER_FRAME)

      prevFrame = frame
      newFrame = await consensus.getCurrentFrame()
      assert.equals(newFrame.refSlot, +prevFrame.refSlot + SLOTS_PER_FRAME)

      const consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, ZERO_HASH)
      assert.isFalse(consensusState.isReportProcessing)

      const checkMember = async (member) => {
        const memberInfo = await consensus.getConsensusStateForMember(member)
        assert.equals(memberInfo.currentFrameRefSlot, +newFrame.refSlot)
        assert.equal(memberInfo.currentFrameConsensusReport, ZERO_HASH)
        assert.isTrue(memberInfo.isMember)
        assert.equals(memberInfo.lastMemberReportRefSlot, +prevFrame.refSlot)
        assert.equal(memberInfo.currentFrameMemberReport, ZERO_HASH)
        assert.isTrue(memberInfo.canReport)
      }

      await checkMember(member1)
      await checkMember(member2)
      await checkMember(member3)

      assert.equals((await reportProcessor.getLastCall_submitReport()).callCount, 3)
      assert.equals((await reportProcessor.getLastCall_discardReport()).callCount, 1)
    })

    it('a member cannot submit report for the previous ref slot', async () => {
      await assert.reverts(
        consensus.submitReport(prevFrame.refSlot, HASH_2, CONSENSUS_VERSION, { from: member1 }),
        'InvalidSlot()'
      )
    })

    it('a member cannot submit report for a non-reference slot', async () => {
      await assert.reverts(
        consensus.submitReport(newFrame.refSlot - 1, HASH_2, CONSENSUS_VERSION, { from: member1 }),
        'InvalidSlot()'
      )
      await assert.reverts(
        consensus.submitReport(newFrame.refSlot + 1, HASH_2, CONSENSUS_VERSION, { from: member1 }),
        'InvalidSlot()'
      )
    })

    it('first member votes for hash 2', async () => {
      const tx = await consensus.submitReport(newFrame.refSlot, HASH_2, CONSENSUS_VERSION, { from: member1 })

      assert.emits(tx, 'ReportReceived', {
        refSlot: newFrame.refSlot,
        member: member1,
        report: HASH_2,
      })
      assert.notEmits(tx, 'ConsensusReached')

      const memberInfo = await consensus.getConsensusStateForMember(member1)
      assert.isTrue(memberInfo.isMember)
      assert.equals(memberInfo.lastMemberReportRefSlot, +newFrame.refSlot)
      assert.equals(memberInfo.currentFrameRefSlot, +newFrame.refSlot)
      assert.equal(memberInfo.currentFrameMemberReport, HASH_2)
      assert.isTrue(memberInfo.canReport)
    })

    it('consensus is not reached', async () => {
      const consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, ZERO_HASH)
      assert.isFalse(consensusState.isReportProcessing)
      assert.equals((await reportProcessor.getLastCall_submitReport()).callCount, 3)
      assert.equals((await reportProcessor.getLastCall_discardReport()).callCount, 1)

      const memberInfo = await consensus.getConsensusStateForMember(member1)
      assert.equal(memberInfo.currentFrameConsensusReport, ZERO_HASH)
    })
  })
})
