const { contract, ethers } = require('hardhat')
const { assert } = require('../../helpers/assert')
const { EvmSnapshot } = require('../../helpers/blockchain')

const baseOracleAbi = require('../../../lib/abi/BaseOracle.json')

const {
  ZERO_HASH,
  HASH_1,
  HASH_2,
  HASH_3,
  deployBaseOracle,
  computeDeadlineFromRefSlot,
  computeNextRefSlotFromRefSlot,
  computeEpochFirstSlotAt,
  SECONDS_PER_SLOT,
} = require('./base-oracle-deploy.test')

contract('BaseOracle', ([admin]) => {
  const evmSnapshot = new EvmSnapshot(ethers.provider)
  let consensus
  let baseOracle
  let initialRefSlot

  const deployContract = async () => {
    const deployed = await deployBaseOracle(admin, { initialEpoch: 1 })
    consensus = deployed.consensusContract
    baseOracle = deployed.oracle
    const time = (await baseOracle.getTime()).toNumber()
    initialRefSlot = computeEpochFirstSlotAt(time)
    await evmSnapshot.make()
  }

  before(deployContract)

  describe('submitConsensusReport is called and changes the contract state', () => {
    context('submitConsensusReport rejects a report whose deadline has already passed', () => {
      before(async () => {
        await evmSnapshot.rollback()
      })

      it('the report is rejected', async () => {
        const deadline = computeDeadlineFromRefSlot(initialRefSlot)
        await baseOracle.setTime(deadline + 1)
        await assert.revertsWithCustomError(
          consensus.submitReportAsConsensus(HASH_1, initialRefSlot, deadline),
          `ProcessingDeadlineMissed(${deadline})`
        )
      })
    })

    context('submitConsensusReport checks pre-conditions', () => {
      before(async () => {
        await evmSnapshot.rollback()
      })

      it('only setConsensus contract can call submitConsensusReport', async () => {
        await assert.revertsWithCustomError(
          baseOracle.submitConsensusReport(HASH_1, initialRefSlot, computeDeadlineFromRefSlot(initialRefSlot)),
          'SenderIsNotTheConsensusContract()'
        )
      })

      it('zero hash cannot be submitted as a report', async () => {
        await assert.revertsWithCustomError(
          consensus.submitReportAsConsensus(ZERO_HASH, initialRefSlot, computeDeadlineFromRefSlot(initialRefSlot)),
          'HashCannotBeZero()'
        )
      })

      it('initial report is submitted and _handleConsensusReport is called', async () => {
        assert.equals((await baseOracle.getConsensusReportLastCall()).callCount, 0)
        const tx = await consensus.submitReportAsConsensus(
          HASH_1,
          initialRefSlot,
          computeDeadlineFromRefSlot(initialRefSlot)
        )
        assert.emits(
          tx,
          'ReportSubmitted',
          {
            refSlot: initialRefSlot,
            hash: HASH_1,
            processingDeadlineTime: computeDeadlineFromRefSlot(initialRefSlot),
          },
          { abi: baseOracleAbi }
        )
        const { report, callCount } = await baseOracle.getConsensusReportLastCall()
        assert.equals(callCount, 1)
        assert.equal(report.hash, HASH_1)
        assert.equals(report.refSlot, initialRefSlot)
        assert.equals(report.processingDeadlineTime, computeDeadlineFromRefSlot(initialRefSlot))
      })

      it('older report cannot be submitted', async () => {
        await assert.revertsWithCustomError(
          consensus.submitReportAsConsensus(HASH_1, initialRefSlot - 1, computeDeadlineFromRefSlot(initialRefSlot)),
          `RefSlotCannotDecrease(${initialRefSlot - 1}, ${initialRefSlot})`
        )
      })

      it('oracle starts processing last report', async () => {
        await baseOracle.startProcessing()
      })

      it('consensus cannot resubmit already processing report', async () => {
        await assert.revertsWithCustomError(
          consensus.submitReportAsConsensus(HASH_1, initialRefSlot, computeDeadlineFromRefSlot(initialRefSlot)),
          `RefSlotMustBeGreaterThanProcessingOne(${initialRefSlot}, ${initialRefSlot})`
        )
      })

      it('warning event is emitted when newer report is submitted and prev has not started processing yet', async () => {
        const RefSlot2 = computeNextRefSlotFromRefSlot(initialRefSlot)
        const RefSlot3 = computeNextRefSlotFromRefSlot(RefSlot2)

        const tx1 = await consensus.submitReportAsConsensus(HASH_1, RefSlot2, computeDeadlineFromRefSlot(RefSlot2))
        assert.equals((await baseOracle.getConsensusReportLastCall()).callCount, 2)
        assert.emits(tx1, 'ReportSubmitted', {}, { abi: baseOracleAbi })

        const tx2 = await consensus.submitReportAsConsensus(HASH_1, RefSlot3, computeDeadlineFromRefSlot(RefSlot3))
        assert.emits(
          tx2,
          'WarnProcessingMissed',
          { refSlot: RefSlot2 },
          {
            abi: baseOracleAbi,
          }
        )
        assert.equals((await baseOracle.getConsensusReportLastCall()).callCount, 3)
        assert.emits(tx2, 'ReportSubmitted', {}, { abi: baseOracleAbi })
      })
    })

    context('submitConsensusReport updates getConsensusReport', () => {
      let nextRefSlot, nextRefSlotDeadline
      before(async () => {
        nextRefSlot = computeNextRefSlotFromRefSlot(initialRefSlot)
        nextRefSlotDeadline = computeDeadlineFromRefSlot(nextRefSlot)
        await evmSnapshot.rollback()
      })

      it('getConsensusReport at deploy returns empty state', async () => {
        const report = await baseOracle.getConsensusReport()
        assert.equal(report.hash, ZERO_HASH)
        assert.equals(report.refSlot, 0)
        assert.equals(report.processingDeadlineTime, 0)
        assert(!report.processingStarted)
      })

      it('cannot start processing on empty state', async () => {
        await assert.reverts(baseOracle.startProcessing(), 'NoConsensusReportToProcess()')
      })

      it('initial report is submitted', async () => {
        await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, computeDeadlineFromRefSlot(initialRefSlot))
        const report = await baseOracle.getConsensusReport()
        assert.equal(report.hash, HASH_1)
        assert.equals(report.refSlot, initialRefSlot)
        assert.equals(report.processingDeadlineTime, computeDeadlineFromRefSlot(initialRefSlot))
        assert(!report.processingStarted)
      })

      it('next report is submitted, initial report is missed, warning event fired', async () => {
        const tx = await consensus.submitReportAsConsensus(HASH_2, nextRefSlot, nextRefSlotDeadline)
        assert.emits(
          tx,
          'WarnProcessingMissed',
          {
            refSlot: initialRefSlot,
          },
          { abi: baseOracleAbi }
        )
        const report = await baseOracle.getConsensusReport()
        assert.equal(report.hash, HASH_2)
        assert.equals(report.refSlot, nextRefSlot)
        assert.equals(report.processingDeadlineTime, nextRefSlotDeadline)
        assert(!report.processingStarted)
      })

      it('next report is re-agreed, no missed warning', async () => {
        const tx = await consensus.submitReportAsConsensus(HASH_3, nextRefSlot, nextRefSlotDeadline)
        assert.emitsNumberOfEvents(tx, 'WarnProcessingMissed', 0, {
          abi: baseOracleAbi,
        })
        const report = await baseOracle.getConsensusReport()
        assert.equal(report.hash, HASH_3)
        assert.equals(report.refSlot, nextRefSlot)
        assert.equals(report.processingDeadlineTime, nextRefSlotDeadline)
        assert(!report.processingStarted)
      })

      it('report processing started for last report', async () => {
        await baseOracle.startProcessing()
        const report = await baseOracle.getConsensusReport()
        assert.equal(report.hash, HASH_3)
        assert.equals(report.refSlot, nextRefSlot)
        assert.equals(report.processingDeadlineTime, nextRefSlotDeadline)
        assert(report.processingStarted)
      })
    })
  })

  describe('_startProcessing safely advances processing state', () => {
    let refSlot1, refSlot2
    let refSlot1Deadline, refSlot2Deadline
    before(async () => {
      await evmSnapshot.rollback()
      refSlot1 = computeNextRefSlotFromRefSlot(initialRefSlot)
      refSlot1Deadline = computeDeadlineFromRefSlot(refSlot1)

      refSlot2 = computeNextRefSlotFromRefSlot(refSlot1)
      refSlot2Deadline = computeDeadlineFromRefSlot(refSlot2)
    })

    it('initial contract state, no reports, cannot startProcessing', async () => {
      await assert.revertsWithCustomError(baseOracle.startProcessing(), 'NoConsensusReportToProcess()')
    })

    it('submit first report for initial slot', async () => {
      await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, computeDeadlineFromRefSlot(initialRefSlot))
      const tx = await baseOracle.startProcessing()
      assert.emits(tx, 'ProcessingStarted', { refSlot: initialRefSlot, hash: HASH_1 })
      assert.emits(tx, 'MockStartProcessingResult', { prevProcessingRefSlot: '0' })
    })

    it('trying to start processing the same slot again reverts', async () => {
      await assert.reverts(baseOracle.startProcessing(), 'RefSlotAlreadyProcessing()')
    })

    it('next report comes in, start processing, state advances', async () => {
      await consensus.submitReportAsConsensus(HASH_2, refSlot1, refSlot1Deadline)
      const tx = await baseOracle.startProcessing()
      assert.emits(tx, 'ProcessingStarted', { refSlot: refSlot1, hash: HASH_2 })
      assert.emits(tx, 'MockStartProcessingResult', { prevProcessingRefSlot: String(initialRefSlot) })
      const processingSlot = await baseOracle.getLastProcessingRefSlot()
      assert.equals(processingSlot, refSlot1)
    })

    it('another report but deadline is missed, reverts', async () => {
      await consensus.submitReportAsConsensus(HASH_3, refSlot2, refSlot2Deadline)
      await baseOracle.setTime(refSlot2Deadline + SECONDS_PER_SLOT * 10)
      await assert.revertsWithCustomError(baseOracle.startProcessing(), `ProcessingDeadlineMissed(${refSlot2Deadline})`)
    })
  })

  describe('discardConsensusReport', () => {
    let nextRefSlot

    before(async () => {
      await evmSnapshot.rollback()
      nextRefSlot = computeNextRefSlotFromRefSlot(initialRefSlot)
    })

    it('noop if no report for this frame', async () => {
      const tx = await consensus.discardReportAsConsensus(initialRefSlot)
      assert.emitsNumberOfEvents(tx, 'ReportDiscarded', 0, { abi: baseOracleAbi })
    })

    it('initial report', async () => {
      await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, computeDeadlineFromRefSlot(initialRefSlot))
    })

    it('noop if discarding future report', async () => {
      const tx = await consensus.discardReportAsConsensus(nextRefSlot)
      assert.notEmits(tx, 'ReportDiscarded', { abi: baseOracleAbi })
    })

    it('reverts for invalid slot', async () => {
      await assert.revertsWithCustomError(
        consensus.discardReportAsConsensus(initialRefSlot - 1),
        `RefSlotCannotDecrease(${initialRefSlot - 1}, ${initialRefSlot})`
      )
    })

    it('discards report and throws events', async () => {
      const tx = await consensus.discardReportAsConsensus(initialRefSlot)
      assert.emits(tx, 'ReportDiscarded', { refSlot: initialRefSlot, hash: HASH_1 }, { abi: baseOracleAbi })
      const currentReport = await baseOracle.getConsensusReport()
      assert.equals(currentReport.hash, ZERO_HASH)
      assert.equals(currentReport.refSlot, initialRefSlot)
      assert.equals(currentReport.processingDeadlineTime, computeDeadlineFromRefSlot(initialRefSlot))
      assert.equals(currentReport.processingStarted, false)
    })

    it('internal _handleConsensusReportDiscarded was called during discard', async () => {
      const discardedReport = await baseOracle.lastDiscardedReport()
      assert.equals(discardedReport.hash, HASH_1)
      assert.equals(discardedReport.refSlot, initialRefSlot)
      assert.equals(discardedReport.processingDeadlineTime, computeDeadlineFromRefSlot(initialRefSlot))
    })

    it('cannot start processing on zero report', async () => {
      await assert.reverts(baseOracle.startProcessing(), 'NoConsensusReportToProcess()')
    })

    it('report can be resubmitted after discard', async () => {
      await consensus.submitReportAsConsensus(HASH_2, initialRefSlot, computeDeadlineFromRefSlot(initialRefSlot))
      const currentReport = await baseOracle.getConsensusReport()
      assert.equals(currentReport.hash, HASH_2)
      assert.equals(currentReport.refSlot, initialRefSlot)
      assert.equals(currentReport.processingDeadlineTime, computeDeadlineFromRefSlot(initialRefSlot))
      assert.equals(currentReport.processingStarted, false)
      await baseOracle.startProcessing()
    })

    it('reverts if processing started', async () => {
      await assert.revertsWithCustomError(
        consensus.discardReportAsConsensus(initialRefSlot),
        `RefSlotAlreadyProcessing()`
      )
    })
  })
})
