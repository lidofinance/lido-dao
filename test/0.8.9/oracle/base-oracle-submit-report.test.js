const { contract } = require('hardhat')
const { assert } = require('../../helpers/assert')

const baseOracleAbi = require('../../../lib/abi/BaseOracle.json')

const { SLOTS_PER_FRAME, ZERO_HASH, HASH_1, HASH_2, HASH_3, deployBaseOracle } = require('./base-oracle-deploy.test')

contract('BaseOracle', ([admin]) => {
  let consensus
  let baseOracle
  let initialRefSlot

  const deployContract = async () => {
    const deployed = await deployBaseOracle(admin, { initialEpoch: 1 })
    consensus = deployed.consensusContract
    baseOracle = deployed.oracle
    initialRefSlot = +(await baseOracle.getTime())
  }

  describe('submitConsensusReport is called and changes the contract state', () => {
    context('submitConsensusReport passes pre-conditions', () => {
      before(deployContract)

      it('only setConsensus contract can call submitConsensusReport', async () => {
        await assert.revertsWithCustomError(
          baseOracle.submitConsensusReport(HASH_1, initialRefSlot, initialRefSlot + SLOTS_PER_FRAME),
          'OnlyConsensusContractCanSubmitReport()'
        )
      })

      it('initial report is submitted and _handleConsensusReport is called', async () => {
        assert.equals((await baseOracle.getConsensusReportLastCall()).callCount, 0)
        const tx = await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, initialRefSlot + SLOTS_PER_FRAME)
        assert.emits(
          tx,
          'ReportSubmitted',
          {
            refSlot: initialRefSlot,
            hash: HASH_1,
            processingDeadlineTime: initialRefSlot + SLOTS_PER_FRAME,
          },
          { abi: baseOracleAbi }
        )
        const { report, callCount } = await baseOracle.getConsensusReportLastCall()
        assert.equals(callCount, 1)
        assert.equal(report.hash, HASH_1)
        assert.equals(report.refSlot, initialRefSlot)
        assert.equals(report.processingDeadlineTime, initialRefSlot + SLOTS_PER_FRAME)
      })

      it('older report cannot be submitted', async () => {
        await assert.revertsWithCustomError(
          consensus.submitReportAsConsensus(HASH_1, initialRefSlot - 1, initialRefSlot + SLOTS_PER_FRAME),
          `RefSlotCannotDecrease(${initialRefSlot - 1}, ${initialRefSlot})`
        )
      })

      it('oracle starts processing last report', async () => {
        await baseOracle.startProcessing()
      })

      it('consensus cannot resubmit already processing report', async () => {
        await assert.revertsWithCustomError(
          consensus.submitReportAsConsensus(HASH_1, initialRefSlot, initialRefSlot + SLOTS_PER_FRAME),
          `RefSlotMustBeGreaterThanProcessingOne(${initialRefSlot}, ${initialRefSlot})`
        )
      })

      it('warning event is emitted when newer report is submitted and prev has not started processing yet', async () => {
        const tx1 = await consensus.submitReportAsConsensus(
          HASH_1,
          initialRefSlot + 10,
          initialRefSlot + SLOTS_PER_FRAME
        )
        assert.equals((await baseOracle.getConsensusReportLastCall()).callCount, 2)
        assert.emits(tx1, 'ReportSubmitted', {}, { abi: baseOracleAbi })

        const tx2 = await consensus.submitReportAsConsensus(
          HASH_1,
          initialRefSlot + 20,
          initialRefSlot + SLOTS_PER_FRAME
        )
        assert.emits(
          tx2,
          'WarnProcessingMissed',
          { refSlot: initialRefSlot + 10 },
          {
            abi: baseOracleAbi,
          }
        )
        assert.equals((await baseOracle.getConsensusReportLastCall()).callCount, 3)
        assert.emits(tx2, 'ReportSubmitted', {}, { abi: baseOracleAbi })
      })
    })

    context('submitConsensusReport updates getConsensusReport', () => {
      before(deployContract)

      it('getConsensusReport at deploy returns empty state', async () => {
        const report = await baseOracle.getConsensusReport()
        assert.equal(report.hash, ZERO_HASH)
        assert.equals(report.refSlot, 0)
        assert.equals(report.processingDeadlineTime, 0)
        assert(!report.processingStarted)
      })

      it('initial report is submitted', async () => {
        await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, initialRefSlot + SLOTS_PER_FRAME)
        const report = await baseOracle.getConsensusReport()
        assert.equal(report.hash, HASH_1)
        assert.equals(report.refSlot, initialRefSlot)
        assert.equals(report.processingDeadlineTime, initialRefSlot + SLOTS_PER_FRAME)
        assert(!report.processingStarted)
      })

      it('next report is submitted, initial report is missed, warning event fired', async () => {
        const nextRefSlot = initialRefSlot + 1
        const tx = await consensus.submitReportAsConsensus(HASH_2, nextRefSlot, nextRefSlot + SLOTS_PER_FRAME)
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
        assert.equals(report.processingDeadlineTime, nextRefSlot + SLOTS_PER_FRAME)
        assert(!report.processingStarted)
      })

      it('next report is re-agreed, no missed warning', async () => {
        const nextRefSlot = initialRefSlot + 1
        const tx = await consensus.submitReportAsConsensus(HASH_3, nextRefSlot, nextRefSlot + SLOTS_PER_FRAME + 10)
        assert.emitsNumberOfEvents(tx, 'WarnProcessingMissed', 0, {
          abi: baseOracleAbi,
        })
        const report = await baseOracle.getConsensusReport()
        assert.equal(report.hash, HASH_3)
        assert.equals(report.refSlot, nextRefSlot)
        assert.equals(report.processingDeadlineTime, nextRefSlot + SLOTS_PER_FRAME + 10)
        assert(!report.processingStarted)
      })

      it('report processing started for last report', async () => {
        const nextRefSlot = initialRefSlot + 1
        await baseOracle.startProcessing()
        const report = await baseOracle.getConsensusReport()
        assert.equal(report.hash, HASH_3)
        assert.equals(report.refSlot, nextRefSlot)
        assert.equals(report.processingDeadlineTime, nextRefSlot + SLOTS_PER_FRAME + 10)
        assert(report.processingStarted)
      })
    })
  })

  describe('_startProcessing safely advances processing state', () => {
    before(deployContract)

    it('initial contract state, no reports, cannot startProcessing', async () => {
      await assert.revertsWithCustomError(baseOracle.startProcessing(), 'ProcessingDeadlineMissed(0)')
    })

    it('submit first report for initial slot', async () => {
      await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, initialRefSlot + 20)
      const tx = await baseOracle.startProcessing()
      assert.emits(tx, 'ProcessingStarted', { refSlot: initialRefSlot, hash: HASH_1 })
      assert.emits(tx, 'MockStartProcessingResult', { prevProcessingRefSlot: '0' })
    })

    it('trying to start processing the same slot again reverts', async () => {
      await assert.reverts(baseOracle.startProcessing(), 'RefSlotAlreadyProcessing()')
    })

    it('next report comes in, start processing, state advances', async () => {
      await consensus.submitReportAsConsensus(HASH_2, initialRefSlot + 10, initialRefSlot + 20)
      const tx = await baseOracle.startProcessing()
      assert.emits(tx, 'ProcessingStarted', { refSlot: initialRefSlot + 10, hash: HASH_2 })
      assert.emits(tx, 'MockStartProcessingResult', { prevProcessingRefSlot: String(initialRefSlot) })
      const processingSlot = await baseOracle.getLastProcessingRefSlot()
      assert.equals(processingSlot, initialRefSlot + 10)
    })

    it('another report but deadline is missed, reverts', async () => {
      const nextSlot = initialRefSlot + 20
      await consensus.submitReportAsConsensus(HASH_3, nextSlot, nextSlot + 30)
      await baseOracle.setTime(nextSlot + 40)
      await assert.revertsWithCustomError(baseOracle.startProcessing(), `ProcessingDeadlineMissed(${nextSlot + 30})`)
    })
  })
})
