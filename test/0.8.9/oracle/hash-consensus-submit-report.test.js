const { contract, ethers } = require('hardhat')
const { assert } = require('../../helpers/assert')
const { EvmSnapshot } = require('../../helpers/blockchain')

const { deployHashConsensus, CONSENSUS_VERSION, ZERO_HASH, HASH_1, HASH_2 } = require('./hash-consensus-deploy.test')

const CONSENSUS_VERSION_2 = 2

contract('HashConsensus', ([admin, member1, member2, stranger]) => {
  let consensus
  let frame
  let reportProcessor
  let snapshot

  const deploy = async (options = { epochsPerFrame: 200 }) => {
    snapshot = new EvmSnapshot(ethers.provider)
    const deployed = await deployHashConsensus(admin, options)
    consensus = deployed.consensus
    reportProcessor = deployed.reportProcessor
    frame = await consensus.getCurrentFrame()
    await consensus.addMember(member1, 1, { from: admin })
    await snapshot.make()
  }

  const rollback = async () => {
    await snapshot.rollback()
  }

  before(deploy)

  context('method submitReport', () => {
    afterEach(rollback)

    it('reverts with NumericOverflow if slot is greater than max allowed', async () => {
      await assert.reverts(
        consensus.submitReport('20446744073709551615', HASH_1, CONSENSUS_VERSION, { from: member1 }),
        'NumericOverflow()'
      )
    })

    it('reverts with NumericOverflow if slot is greater than max allowed', async () => {
      await assert.reverts(
        consensus.submitReport('20446744073709551615', HASH_1, CONSENSUS_VERSION, { from: member1 }),
        'NumericOverflow()'
      )
    })

    it('reverts with InvalidSlot if slot is zero', async () => {
      await assert.reverts(consensus.submitReport(0, HASH_1, CONSENSUS_VERSION, { from: member1 }), 'InvalidSlot()')
    })

    it('reverts with UnexpectedConsensusVersion', async () => {
      await assert.reverts(
        consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION_2, { from: member1 }),
        `UnexpectedConsensusVersion(${CONSENSUS_VERSION}, ${CONSENSUS_VERSION_2})`
      )
    })

    it('reverts with EmptyReport', async () => {
      await assert.reverts(
        consensus.submitReport(frame.refSlot, ZERO_HASH, CONSENSUS_VERSION, { from: member1 }),
        `EmptyReport()`
      )
    })

    it('reverts with ConsensusReportAlreadyProcessing', async () => {
      await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
      await reportProcessor.startReportProcessing()
      await assert.reverts(
        consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 }),
        `ConsensusReportAlreadyProcessing()`
      )
    })

    it('reverts with DuplicateReport', async () => {
      await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
      await assert.reverts(
        consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 }),
        `DuplicateReport()`
      )
    })

    it('does not reverts with ConsensusReportAlreadyProcessing if member has not sent a report for this slot', async () => {
      await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
      await reportProcessor.startReportProcessing()
      await consensus.addMember(member2, 2, { from: admin })
      await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })
    })

    it('consensus loss on conflicting report submit', async () => {
      await consensus.addMember(member2, 2, { from: admin })
      await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
      const tx1 = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })
      assert.emitsNumberOfEvents(tx1, 'ConsensusReached', 1)
      const tx2 = await consensus.submitReport(frame.refSlot, HASH_2, CONSENSUS_VERSION, { from: member2 })
      assert.emitsNumberOfEvents(tx2, 'ConsensusLost', 1)
    })
  })
})
