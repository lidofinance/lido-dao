const { assert, getAccessControlMessage } = require('../../helpers/assert')
const { assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { assertRevert } = require('../../helpers/assertThrow')
const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

const {
  HASH_1,
  HASH_2,
  CONSENSUS_VERSION,
  deployHashConsensus,
  computeTimestampAtEpoch
} = require('./hash-consensus-deploy.test')
const { toNum } = require('../../helpers/utils')

const HashConsensus = artifacts.require('HashConsensusTimeTravellable')
const MockReportProcessor = artifacts.require('MockReportProcessor')

contract('HashConsensus', ([admin, member1, member2, stranger]) => {
  context('Report Processor', () => {
    let consensus
    let reportProcessor1
    let reportProcessor2

    const deploy = async (options = undefined) => {
      const deployed = await deployHashConsensus(admin, options)
      consensus = deployed.consensus
      reportProcessor1 = deployed.reportProcessor
      reportProcessor2 = await MockReportProcessor.new(CONSENSUS_VERSION, { from: admin })
    }

    context('initial setup', () => {
      beforeEach(deploy)

      it('properly set initial report processor', async () => {
        assert.addressEqual(await consensus.getReportProcessor(), reportProcessor1.address, 'processor address differs')
      })
    })

    context('method setReportProcessor', () => {
      beforeEach(deploy)

      it('checks next processor is not zero', async () => {
        await assertRevert(consensus.setReportProcessor(ZERO_ADDRESS), 'ReportProcessorCannotBeZero()')
      })

      it('checks next processor is not the same as previous', async () => {
        await assertRevert(consensus.setReportProcessor(reportProcessor1.address), 'NewProcessorCannotBeTheSame()')
      })

      it('checks tx sender for MANAGE_REPORT_PROCESSOR_ROLE', async () => {
        await assertRevert(
          consensus.setReportProcessor(reportProcessor2.address, { from: stranger }),
          getAccessControlMessage(stranger.toLowerCase(), await consensus.MANAGE_REPORT_PROCESSOR_ROLE())
        )
      })

      it('emits ReportProcessorSet event', async () => {
        const tx = await consensus.setReportProcessor(reportProcessor2.address)
        assertEvent(tx, 'ReportProcessorSet', {
          expectedArgs: { processor: reportProcessor2.address, prevProcessor: reportProcessor1.address }
        })
      })

      it('prev did not processed last report yet — do submit report to next', async () => {
        const frame = await consensus.getCurrentFrame()

        await consensus.addMember(member1, 1, { from: admin })
        await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })

        // There is no `processor.startReportProcessing()`
        // to simulate situation when processing still in progress

        await consensus.setReportProcessor(reportProcessor2.address, { from: admin })
        assert.equal(+(await reportProcessor2.getLastCall_submitReport()).callCount, 1)
      })

      it('prev did processed current frame report — do not submit report to next', async () => {
        const frame = await consensus.getCurrentFrame()

        await consensus.addMember(member1, 1, { from: admin })
        await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })

        await reportProcessor1.startReportProcessing()

        await consensus.setReportProcessor(reportProcessor2.address, { from: admin })
        assert.equal(+(await reportProcessor2.getLastCall_submitReport()).callCount, 0)
      })

      it('next processor already have processed report for current frame', async () => {
        const frame = await consensus.getCurrentFrame()

        // 1 — Make up state of unfinished processing for reportProcessor1
        await consensus.addMember(member1, 1, { from: admin })
        await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })

        // 2 — Make up state of finished processing for reportProcessor2
        await reportProcessor2.setLastProcessingStartedRefSlot(frame.refSlot)

        // 3 — Check call count of report submits
        await consensus.setReportProcessor(reportProcessor2.address, { from: admin })
        assert.equal(+(await reportProcessor2.getLastCall_submitReport()).callCount, 0)
      })

      it('do not submit report to next processor if there was no conensus', async () => {
        const frame = await consensus.getCurrentFrame()

        await consensus.addMember(member1, 1, { from: admin })
        await consensus.addMember(member2, 2, { from: admin })

        await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
        await reportProcessor1.startReportProcessing()

        await consensus.setReportProcessor(reportProcessor2.address, { from: admin })
        assert.equal(
          +(await reportProcessor2.getLastCall_submitReport()).callCount,
          0,
          'processor reported but there was no quorum'
        )
      })
    })

    context('consensus version', () => {
      beforeEach(deploy)

      it('equals to version of initial processor', async () => {
        assert.equal(await consensus.getConsensusVersion(), CONSENSUS_VERSION)
      })

      it('equals to new processor version after it was changed', async () => {
        const CONSENSUS_VERSION_2 = 2
        const reportProcessor_v2 = await MockReportProcessor.new(CONSENSUS_VERSION_2, { from: admin })
        await consensus.setReportProcessor(reportProcessor_v2.address)
        assert.equal(await consensus.getConsensusVersion(), CONSENSUS_VERSION_2)
      })
    })

    context('method getReportVariants', () => {
      beforeEach(deploy)

      it(`returns empty data if lastReportRefSlot != currentFrame.refSlot`, async () => {
        const { refSlot } = await consensus.getCurrentFrame()
        await consensus.addMember(member1, 1, { from: admin })

        await consensus.submitReport(refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
        const reportVariants1 = await consensus.getReportVariants()
        assert.sameOrderedMembers(reportVariants1.variants, [HASH_1])
        assert.sameOrderedMembers(reportVariants1.support.map(toNum), [1])

        await consensus.advanceTimeToNextFrameStart()
        const reportVariants2 = await consensus.getReportVariants()
        assert.sameOrderedMembers(reportVariants2.variants, [])
        assert.sameOrderedMembers(reportVariants2.support.map(toNum), [])
      })
    })
  })
})
