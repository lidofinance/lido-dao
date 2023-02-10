const { assert } = require('chai')
const { assertEvent, assertAmountOfEvents, assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { assertRevert } = require('../../helpers/assertThrow')

const baseOracleAbi = require('../../../lib/abi/BaseOracle.json')

const {
  INITIAL_FAST_LANE_LENGHT_SLOTS,
  INITIAL_EPOCH,
  SLOTS_PER_EPOCH,
  SECONDS_PER_SLOT,
  GENESIS_TIME,
  EPOCHS_PER_FRAME,
  SECONDS_PER_EPOCH,
  SECONDS_PER_FRAME,
  SLOTS_PER_FRAME,
  computeSlotAt,
  computeEpochAt,
  computeEpochFirstSlot,
  computeEpochFirstSlotAt,
  computeTimestampAtSlot,
  computeTimestampAtEpoch,
  ZERO_HASH,
  HASH_1,
  HASH_2,
  HASH_3,
  HASH_4,
  HASH_5,
  CONSENSUS_VERSION,
  UNREACHABLE_QUORUM,
  deployBaseOracle
} = require('./base-oracle-deploy.test')

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
        assertRevert(
          baseOracle.submitConsensusReport(HASH_1, initialRefSlot, initialRefSlot + SLOTS_PER_FRAME),
          'OnlyConsensusContractCanSubmitReport()'
        )
      })

      it('initial report is submitted and virtual handle is called', async () => {
        const tx = await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, initialRefSlot + SLOTS_PER_FRAME)
        assert.equal(+(await baseOracle.getConsensusReportLastCall()).callCount, 1)
        assertEvent(tx, 'ReportSubmitted', {
          decodeForAbi: baseOracleAbi,
          expectedArgs: {
            refSlot: initialRefSlot,
            hash: HASH_1,
            processingDeadlineTime: initialRefSlot + SLOTS_PER_FRAME
          }
        })
      })

      it('older report cannot be submitted', async () => {
        assertRevert(
          baseOracle.submitConsensusReport(HASH_1, initialRefSlot - 1, initialRefSlot + SLOTS_PER_FRAME),
          'RefSlotCannotDecrease(29,31)'
        )
      })

      it('oracle starts processing last report', async () => {
        await baseOracle.startProcessing()
      })

      it('consensus cannot resubmit already processing report', async () => {
        assertRevert(
          baseOracle.submitConsensusReport(HASH_1, initialRefSlot, initialRefSlot + SLOTS_PER_FRAME),
          'RefSlotMustBeGreaterThanProcessingOne(31,31)'
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
  })
})
