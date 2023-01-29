const { assert } = require('chai')
const { assertBn, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { assertRevert } = require('../../helpers/assertThrow')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const {
  SLOTS_PER_EPOCH, SECONDS_PER_SLOT, GENESIS_TIME, EPOCHS_PER_FRAME,
  SECONDS_PER_EPOCH, SECONDS_PER_FRAME, SLOTS_PER_FRAME,
  computeSlotAt, computeEpochAt, computeEpochFirstSlotAt, computeTimestampAtSlot,
  ZERO_HASH, HASH_1, HASH_2, HASH_3, HASH_4, HASH_5, CONSENSUS_VERSION,
  deployHashConsensus } = require('./hash-consensus-deploy.test')

const HashConsensus = artifacts.require('HashConsensusTimeTravellable')
const MockReportProcessor = artifacts.require('MockReportProcessor')

contract('HashConsensus', ([admin, member1, member2, member3, stranger]) => {
  let consensus
  let reportProcessor

  context('Happy path', () => {

    it('deploying hash consensus', async () => {
      const deployed = await deployHashConsensus(admin)
      consensus = deployed.consensus
      reportProcessor = deployed.reportProcessor
    })

    it('adding members', async () => {
      await consensus.addMember(member1, 1, { from: admin })
      assert.equal(await consensus.getIsMember(member1), true)
      assert.equal(+await consensus.getQuorum(), 1)

      await consensus.addMember(member2, 2, { from: admin })
      assert.equal(await consensus.getIsMember(member2), true)
      assert.equal(+await consensus.getQuorum(), 2)

      await consensus.addMember(member3, 2, { from: admin })
      assert.equal(await consensus.getIsMember(member3), true)
      assert.equal(+await consensus.getQuorum(), 2)
    })

    let frame

    it('reporting frame changes as time passes', async () => {
      const frame1 = await consensus.getCurrentFrame()
      const time = +await consensus.getTime()
      const expectedRefSlot = computeEpochFirstSlotAt(time) - 1
      const expectedDeadlineSlot = expectedRefSlot + EPOCHS_PER_FRAME * SLOTS_PER_EPOCH

      assert.equal(+frame1.refSlot, expectedRefSlot)
      assert.equal(+frame1.reportProcessingDeadlineSlot, expectedDeadlineSlot)

      await consensus.advanceTimeBy(SECONDS_PER_FRAME)
      const frame2 = await consensus.getCurrentFrame()

      assert.equal(+frame2.refSlot, expectedRefSlot + SLOTS_PER_FRAME)
      assert.equal(+frame2.reportProcessingDeadlineSlot, expectedDeadlineSlot + SLOTS_PER_FRAME)

      frame = frame2
    })

    it('first member votes for hash 3', async () => {
      const tx = await consensus.submitReport(frame.refSlot, HASH_3, CONSENSUS_VERSION, { from: member1 })

      assertEvent(tx, 'ReportReceived', { expectedArgs: { refSlot: frame.refSlot, member: member1, report: HASH_3 } })
      assertAmountOfEvents(tx, 'ConsensusReached', { expectedAmount: 0 })

      const memberInfo = await consensus.getMemberInfo(member1)
      assert.isTrue(memberInfo.isMember)
      assert.equal(+memberInfo.lastReportRefSlot, +frame.refSlot)
      assert.equal(+memberInfo.currentRefSlot, +frame.refSlot)
      assert.equal(memberInfo.memberReportForCurrentRefSlot, HASH_3)
    })

    it('consensus is not reached', async () => {
      const consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, ZERO_HASH)
      assert.isFalse(consensusState.isReportProcessing)
      assert.equal(+(await reportProcessor.getLastCall_submitReport()).callCount, 0)
    })

    it('second member votes for hash 1', async () => {
      await consensus.advanceTimeBy(SECONDS_PER_EPOCH + 70)

      const tx = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })

      assertEvent(tx, 'ReportReceived', { expectedArgs: { refSlot: frame.refSlot, member: member2, report: HASH_1 } })
      assertAmountOfEvents(tx, 'ConsensusReached', { expectedAmount: 0 })

      const memberInfo = await consensus.getMemberInfo(member2)
      assert.isTrue(memberInfo.isMember)
      assert.equal(+memberInfo.lastReportRefSlot, +frame.refSlot)
      assert.equal(+memberInfo.currentRefSlot, +frame.refSlot)
      assert.equal(memberInfo.memberReportForCurrentRefSlot, HASH_1)
    })

    it('consensus is not reached', async () => {
      const consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, ZERO_HASH)
      assert.isFalse(consensusState.isReportProcessing)
      assert.equal(+(await reportProcessor.getLastCall_submitReport()).callCount, 0)
    })

    it('third member votes for hash 3', async () => {
      await consensus.advanceTimeBy(SECONDS_PER_EPOCH + 5)

      const tx = await consensus.submitReport(frame.refSlot, HASH_3, CONSENSUS_VERSION, { from: member3 })

      assertEvent(tx, 'ReportReceived', { expectedArgs: { refSlot: frame.refSlot, member: member3, report: HASH_3 } })
      assertEvent(tx, 'ConsensusReached', { expectedArgs: { refSlot: frame.refSlot, report: HASH_3, support: 2 } })

      const memberInfo = await consensus.getMemberInfo(member3)
      assert.isTrue(memberInfo.isMember)
      assert.equal(+memberInfo.lastReportRefSlot, +frame.refSlot)
      assert.equal(+memberInfo.currentRefSlot, +frame.refSlot)
      assert.equal(memberInfo.memberReportForCurrentRefSlot, HASH_3)
    })

    it('consensus is reached', async () => {
      const consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, HASH_3)
      assert.isFalse(consensusState.isReportProcessing)

      const submitReportLastCall = await reportProcessor.getLastCall_submitReport()
      assert.equal(+submitReportLastCall.callCount, 1)
      assert.equal(submitReportLastCall.report, HASH_3)
      assert.equal(+submitReportLastCall.refSlot, +frame.refSlot)
      assert.equal(+submitReportLastCall.deadline, computeTimestampAtSlot(frame.reportProcessingDeadlineSlot))
    })

    it('first member votes for hash 1', async () => {
      await consensus.advanceTimeBy(SECONDS_PER_EPOCH + 5)

      const tx = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })

      assertEvent(tx, 'ReportReceived', { expectedArgs: { refSlot: frame.refSlot, member: member1, report: HASH_1 } })
      assertEvent(tx, 'ConsensusReached', { expectedArgs: { refSlot: frame.refSlot, report: HASH_1, support: 2 } })

      const memberInfo = await consensus.getMemberInfo(member1)
      assert.isTrue(memberInfo.isMember)
      assert.equal(+memberInfo.lastReportRefSlot, +frame.refSlot)
      assert.equal(+memberInfo.currentRefSlot, +frame.refSlot)
      assert.equal(memberInfo.memberReportForCurrentRefSlot, HASH_1)
    })

    it('new consensus is reached', async () => {
      const consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, HASH_1)
      assert.isFalse(consensusState.isReportProcessing)

      const submitReportLastCall = await reportProcessor.getLastCall_submitReport()
      assert.equal(+submitReportLastCall.callCount, 2)
      assert.equal(submitReportLastCall.report, HASH_1)
      assert.equal(+submitReportLastCall.refSlot, +frame.refSlot)
      assert.equal(+submitReportLastCall.deadline, computeTimestampAtSlot(frame.reportProcessingDeadlineSlot))
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

      await assertRevert(
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
      assert.equal(+newFrame.refSlot, +prevFrame.refSlot + SLOTS_PER_FRAME)

      const consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, ZERO_HASH)
      assert.isFalse(consensusState.isReportProcessing)

      let checkMember = async (member) => {
        const memberInfo = await consensus.getMemberInfo(member)
        assert.isTrue(memberInfo.isMember)
        assert.equal(+memberInfo.lastReportRefSlot, +prevFrame.refSlot)
        assert.equal(+memberInfo.currentRefSlot, +newFrame.refSlot)
        assert.equal(memberInfo.memberReportForCurrentRefSlot, ZERO_HASH)
      }

      await checkMember(member1)
      await checkMember(member2)
      await checkMember(member3)

      assert.equal(+(await reportProcessor.getLastCall_submitReport()).callCount, 2)
    })

    it('a member cannot submit report for the previous ref slot', async () => {
      await assertRevert(
        consensus.submitReport(prevFrame.refSlot, HASH_2, CONSENSUS_VERSION, { from: member1 }),
        'InvalidSlot()'
      )
    })

    it('a member cannot submit report for a non-reference slot', async () => {
      await assertRevert(
        consensus.submitReport(newFrame.refSlot - 1, HASH_2, CONSENSUS_VERSION, { from: member1 }),
        'InvalidSlot()'
      )
      await assertRevert(
        consensus.submitReport(newFrame.refSlot + 1, HASH_2, CONSENSUS_VERSION, { from: member1 }),
        'InvalidSlot()'
      )
    })

    it('first member votes for hash 2', async () => {
      const tx = await consensus.submitReport(newFrame.refSlot, HASH_2, CONSENSUS_VERSION, { from: member1 })

      assertEvent(tx, 'ReportReceived', { expectedArgs: { refSlot: newFrame.refSlot, member: member1, report: HASH_2 } })
      assertAmountOfEvents(tx, 'ConsensusReached', { expectedAmount: 0 })

      const memberInfo = await consensus.getMemberInfo(member1)
      assert.isTrue(memberInfo.isMember)
      assert.equal(+memberInfo.lastReportRefSlot, +newFrame.refSlot)
      assert.equal(+memberInfo.currentRefSlot, +newFrame.refSlot)
      assert.equal(memberInfo.memberReportForCurrentRefSlot, HASH_2)
    })

    it('consensus is not reached', async () => {
      const consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, ZERO_HASH)
      assert.isFalse(consensusState.isReportProcessing)
      assert.equal(+(await reportProcessor.getLastCall_submitReport()).callCount, 2)
    })
  })
})
