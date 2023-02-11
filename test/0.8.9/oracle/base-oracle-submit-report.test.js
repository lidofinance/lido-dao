const { assert } = require('chai')
const { assertEvent, assertAmountOfEvents, assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { bn } = require('@aragon/contract-helpers-test')
const { assertRevert } = require('../../helpers/assertThrow')

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
        await assertRevert(
          baseOracle.submitConsensusReport(HASH_1, initialRefSlot, initialRefSlot + SLOTS_PER_FRAME),
          'OnlyConsensusContractCanSubmitReport()'
        )
      })

      it('initial report is submitted and _handleConsensusReport is called', async () => {
        assert.equal(+(await baseOracle.getConsensusReportLastCall()).callCount, 0)
        const tx = await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, initialRefSlot + SLOTS_PER_FRAME)
        assertEvent(tx, 'ReportSubmitted', {
          decodeForAbi: baseOracleAbi,
          expectedArgs: {
            refSlot: initialRefSlot,
            hash: HASH_1,
            processingDeadlineTime: initialRefSlot + SLOTS_PER_FRAME
          }
        })
        const { report, callCount } = await baseOracle.getConsensusReportLastCall()
        assert.equal(+callCount, 1)
        assert.equal(report.hash, HASH_1)
        assert.equal(+report.refSlot, initialRefSlot)
        assert.equal(+report.processingDeadlineTime, initialRefSlot + SLOTS_PER_FRAME)
      })

      it('older report cannot be submitted', async () => {
        await assertRevert(
          consensus.submitReportAsConsensus(HASH_1, initialRefSlot - 1, initialRefSlot + SLOTS_PER_FRAME),
          `RefSlotCannotDecrease(${initialRefSlot - 1}, ${initialRefSlot})`
        )
      })

      it('oracle starts processing last report', async () => {
        await baseOracle.startProcessing()
      })

      it('consensus cannot resubmit already processing report', async () => {
        await assertRevert(
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
        assert.equal(+(await baseOracle.getConsensusReportLastCall()).callCount, 2)
        assertEvent(tx1, 'ReportSubmitted', { decodeForAbi: baseOracleAbi })

        const tx2 = await consensus.submitReportAsConsensus(
          HASH_1,
          initialRefSlot + 20,
          initialRefSlot + SLOTS_PER_FRAME
        )
        assertEvent(tx2, 'WarnProcessingMissed', {
          decodeForAbi: baseOracleAbi,
          expectedArgs: { refSlot: initialRefSlot + 10 }
        })
        assert.equal(+(await baseOracle.getConsensusReportLastCall()).callCount, 3)
        assertEvent(tx2, 'ReportSubmitted', { decodeForAbi: baseOracleAbi })
      })
    })

    context('submitConsensusReport updates getConsensusReport', () => {
      before(deployContract)

      it('getConsensusReport at deploy returns empty state', async () => {
        const report = await baseOracle.getConsensusReport()
        assert.equal(report.hash, ZERO_HASH)
        assertBn(report.refSlot, bn(0))
        assertBn(report.processingDeadlineTime, bn(0))
        assert(!report.processingStarted)
      })

      it('initial report is submitted', async () => {
        await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, initialRefSlot + SLOTS_PER_FRAME)
        const report = await baseOracle.getConsensusReport()
        assert.equal(report.hash, HASH_1)
        assertBn(report.refSlot, bn(initialRefSlot))
        assertBn(report.processingDeadlineTime, bn(initialRefSlot + SLOTS_PER_FRAME))
        assert(!report.processingStarted)
      })

      it('next report is submitted, initial report is missed, warning event fired', async () => {
        const nextRefSlot = initialRefSlot + 1
        const tx = await consensus.submitReportAsConsensus(HASH_2, nextRefSlot, nextRefSlot + SLOTS_PER_FRAME)
        assertEvent(tx, 'WarnProcessingMissed', {
          decodeForAbi: baseOracleAbi,
          expectedArgs: { refSlot: initialRefSlot }
        })
        const report = await baseOracle.getConsensusReport()
        assert.equal(report.hash, HASH_2)
        assertBn(report.refSlot, bn(nextRefSlot))
        assertBn(report.processingDeadlineTime, bn(nextRefSlot + SLOTS_PER_FRAME))
        assert(!report.processingStarted)
      })

      it('next report is re-agreed, no missed warning', async () => {
        const nextRefSlot = initialRefSlot + 1
        const tx = await consensus.submitReportAsConsensus(HASH_3, nextRefSlot, nextRefSlot + SLOTS_PER_FRAME + 10)
        assertAmountOfEvents(tx, 'WarnProcessingMissed', {
          decodeForAbi: baseOracleAbi,
          expectedAmount: 0
        })
        const report = await baseOracle.getConsensusReport()
        assert.equal(report.hash, HASH_3)
        assertBn(report.refSlot, bn(nextRefSlot))
        assertBn(report.processingDeadlineTime, bn(nextRefSlot + SLOTS_PER_FRAME + 10))
        assert(!report.processingStarted)
      })

      it('report processing started for last report', async () => {
        const nextRefSlot = initialRefSlot + 1
        await baseOracle.startProcessing()
        const report = await baseOracle.getConsensusReport()
        assert.equal(report.hash, HASH_3)
        assertBn(report.refSlot, bn(nextRefSlot))
        assertBn(report.processingDeadlineTime, bn(nextRefSlot + SLOTS_PER_FRAME + 10))
        assert(report.processingStarted)
      })
    })
  })
})
