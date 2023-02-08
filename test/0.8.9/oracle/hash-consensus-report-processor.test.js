const { assert, getAccessControlMessage } = require('../../helpers/assert')
const { toNum } = require('../../helpers/utils')
const { assertBn, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { assertRevert } = require('../../helpers/assertThrow')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const {
  SLOTS_PER_EPOCH, SECONDS_PER_SLOT, GENESIS_TIME, EPOCHS_PER_FRAME,
  SECONDS_PER_EPOCH, SECONDS_PER_FRAME, SLOTS_PER_FRAME,
  computeSlotAt, computeEpochAt, computeEpochFirstSlot, computeEpochFirstSlotAt,
  computeTimestampAtSlot, computeTimestampAtEpoch,
  ZERO_HASH, HASH_1, HASH_2, HASH_3, HASH_4, HASH_5,
  CONSENSUS_VERSION, deployHashConsensus} = require('./hash-consensus-deploy.test')

const HashConsensus = artifacts.require('HashConsensusTimeTravellable')
const MockReportProcessor = artifacts.require('MockReportProcessor')

contract('HashConsensus', ([admin, member1, member2, member3, member4, member5, stranger]) => {
  let consensus
  let reportProcessor

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

    const deployProcessorZero = async () => {
      await deploy({ reportProcessorAddress: ZERO_ADDRESS })
    }

    context('without initial processor', () => {
      before(deployProcessorZero)

      it('has no initial processor', async () => {
        assert.addressEqual(
          await consensus.getReportProcessor(),
          ZERO_ADDRESS,
          'there should be zero address for processor',
        )
      })
    })

    context('with initial processor', () => {
      before(deploy)

      it('properly set initial report processor', async () => {
        assert.addressEqual(
          await consensus.getReportProcessor(),
          reportProcessor1.address,
          'processor address differs',
        )
      })

      context('method setReportProcessor', () => {
        before(deploy)

        it('checks next processor is not zero', async () => {
          await assertRevert(
            consensus.setReportProcessor(ZERO_ADDRESS),
            'AddressCannotBeZero()',
          )
        })

        it('checks next processor is not the same as previous', async () => {
          await assertRevert(
            consensus.setReportProcessor(reportProcessor1.address),
            'NewProcessorCannotBeTheSame()',
          )
        })

        it('checks tx sender for MANAGE_REPORT_PROCESSOR_ROLE', async () => {
          await assertRevert(
            consensus.setReportProcessor(reportProcessor2.address, {from: stranger}),
            getAccessControlMessage(stranger.toLowerCase(), await consensus.MANAGE_REPORT_PROCESSOR_ROLE())
          )
        })

        it('emits ReportProcessorSet event', async () => {
          const tx = await consensus.setReportProcessor(reportProcessor2.address)
          assertEvent(tx, 'ReportProcessorSet', {expectedArgs: {processor: reportProcessor2.address, prevProcessor: reportProcessor1.address}})
        })
      })
    })
  })
})
