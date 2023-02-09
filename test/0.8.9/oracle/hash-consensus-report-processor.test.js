const { assert, getAccessControlMessage } = require('../../helpers/assert')
const { assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { assertRevert } = require('../../helpers/assertThrow')
const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

const { CONSENSUS_VERSION, deployHashConsensus } = require('./hash-consensus-deploy.test')

const CONSENSUS_VERSION_2 = 2

const HashConsensus = artifacts.require('HashConsensusTimeTravellable')
const MockReportProcessor = artifacts.require('MockReportProcessor')

contract('HashConsensus', ([admin, stranger]) => {
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
      reportProcessor2 = await MockReportProcessor.new(CONSENSUS_VERSION_2, { from: admin })
    }

    context('with initial processor', () => {
      before(deploy)

      it('properly set initial report processor', async () => {
        assert.addressEqual(await consensus.getReportProcessor(), reportProcessor1.address, 'processor address differs')
      })

      context('method setReportProcessor', () => {
        before(deploy)

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
      })

      context('consensus version', () => {
        beforeEach(deploy)

        it('equals to version of initial processor', async () => {
          assert.equal(await consensus.getConsensusVersion(), CONSENSUS_VERSION)
        })

        it('equals to new processor version after it was changed', async () => {
          await consensus.setReportProcessor(reportProcessor2.address)
          assert.equal(await consensus.getConsensusVersion(), CONSENSUS_VERSION_2)
        })
      })
    })
  })
})
