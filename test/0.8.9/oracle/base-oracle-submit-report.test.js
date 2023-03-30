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
          'OnlyConsensusContractCanSubmitReport()'
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
      await assert.revertsWithCustomError(baseOracle.startProcessing(), 'ProcessingDeadlineMissed(0)')
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
})
