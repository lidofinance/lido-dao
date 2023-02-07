const { assert } = require('chai')
const { assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { assertRevert } = require('../../helpers/assertThrow')

const {
  SLOTS_PER_EPOCH,
  SECONDS_PER_SLOT,
  SECONDS_PER_EPOCH,
  SECONDS_PER_FRAME,
  computeEpochFirstSlot,
  computeTimestampAtEpoch,
  ZERO_HASH,
  HASH_1,
  HASH_3,
  CONSENSUS_VERSION,
  deployHashConsensus
} = require('./hash-consensus-deploy.test')

contract('HashConsensus', ([admin, member1, member2, member3]) => {
  context('setQuorum changes getQuorum', () => {
    let consensus

    beforeEach(async () => {
      const deployed = await deployHashConsensus(admin, { initialEpoch: 1 })
      consensus = deployed.consensus
    })

    it('at deploy quorum is zero and can be set to any number while event is fired on every changes', async () => {
      assert.equal(+(await consensus.getQuorum()), 0)

      const tx1 = await consensus.setQuorum(1)
      assert.equal(+(await consensus.getQuorum()), 1)
      assertEvent(tx1, 'QuorumSet', { expectedArgs: { newQuorum: 1, totalMembers: 0, prevQuorum: 0 } })

      // dry run
      const tx2 = await consensus.setQuorum(1)
      assert.equal(+(await consensus.getQuorum()), 1)
      assertAmountOfEvents(tx2, 'QuorumSet', { expectedAmount: 0 })

      const tx3 = await consensus.setQuorum(10)
      assert.equal(+(await consensus.getQuorum()), 10)
      assertEvent(tx3, 'QuorumSet', { expectedArgs: { newQuorum: 10, totalMembers: 0, prevQuorum: 1 } })

      const tx4 = await consensus.setQuorum(5)
      assert.equal(+(await consensus.getQuorum()), 5)
      assertEvent(tx4, 'QuorumSet', { expectedArgs: { newQuorum: 5, totalMembers: 0, prevQuorum: 10 } })
    })

    it('as new members are added quorum is updated and cannot be set lower than members/2', async () => {
      assert.equal(+(await consensus.getQuorum()), 0)

      await consensus.addMember(member1, 1, { from: admin })
      assert.equal(+(await consensus.getQuorum()), 1)

      await assertRevert(consensus.setQuorum(0), 'QuorumTooSmall(1, 0)')

      await consensus.addMember(member2, 2, { from: admin })
      assert.equal(+(await consensus.getQuorum()), 2)

      await assertRevert(consensus.setQuorum(1), 'QuorumTooSmall(2, 1)')

      await consensus.addMember(member3, 2, { from: admin })
      assert.equal(+(await consensus.getQuorum()), 2)

      await consensus.setQuorum(3)
      assert.equal(+(await consensus.getQuorum()), 3)

      await assertRevert(consensus.setQuorum(1), 'QuorumTooSmall(2, 1)')

      await consensus.setQuorum(2)
      assert.equal(+(await consensus.getQuorum()), 2)
    })
  })

  context('setQuorum changes the effective quorum', () => {
    let consensus
    let frame

    beforeEach(async () => {
      const deployed = await deployHashConsensus(admin, { initialEpoch: 1 })
      consensus = deployed.consensus

      await consensus.addMember(member1, 1, { from: admin })
      await consensus.addMember(member2, 2, { from: admin })
      await consensus.addMember(member3, 3, { from: admin })
      frame = await consensus.getCurrentFrame()
    })

    it('setQuorum increases and cancels current consensus', async () => {
      await consensus.setQuorum(2)

      const tx1 = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
      assertEvent(tx1, 'ReportReceived', { expectedArgs: { refSlot: frame.refSlot, member: member1, report: HASH_1 } })
      assertAmountOfEvents(tx1, 'ConsensusReached', { expectedAmount: 0 })

      const tx2 = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })
      assertEvent(tx2, 'ReportReceived', {
        expectedArgs: { refSlot: frame.refSlot, member: member2, report: HASH_1 }
      })
      assertAmountOfEvents(tx2, 'ConsensusReached', { expectedAmount: 1 })

      const tx3 = await consensus.setQuorum(3)
      assertAmountOfEvents(tx3, 'ConsensusReached', { expectedAmount: 0 })
      const consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, ZERO_HASH)
      assert.isFalse(consensusState.isReportProcessing)
    })

    it('setQuorum decreases, triggers quorum once and goes up/down again', async () => {
      await consensus.setQuorum(3)

      const tx1 = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
      assertEvent(tx1, 'ReportReceived', { expectedArgs: { refSlot: frame.refSlot, member: member1, report: HASH_1 } })
      assertAmountOfEvents(tx1, 'ConsensusReached', { expectedAmount: 0 })

      const tx2 = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })
      assertEvent(tx2, 'ReportReceived', {
        expectedArgs: { refSlot: frame.refSlot, member: member2, report: HASH_1 }
      })
      assertAmountOfEvents(tx2, 'ConsensusReached', { expectedAmount: 0 })

      const tx3 = await consensus.setQuorum(2)
      assertAmountOfEvents(tx3, 'ConsensusReached', { expectedAmount: 1 })
      let consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, HASH_1)

      const tx4 = await consensus.setQuorum(3)
      assertAmountOfEvents(tx4, 'ConsensusReached', { expectedAmount: 0 })
      consensusState = await consensus.getConsensusState()
      assert.equal(consensusState.consensusReport, ZERO_HASH)

      const tx5 = await consensus.setQuorum(2)
      assertAmountOfEvents(tx5, 'ConsensusReached', { expectedAmount: 0 })
    })

    it('setQuorum does not re-trigger consensus if hash is already being processed', async () => {
      await consensus.setQuorum(3)
      const tx1 = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
      assertEvent(tx1, 'ReportReceived', {
        expectedArgs: { refSlot: frame.refSlot, member: member1, report: HASH_1 }
      })
      assertAmountOfEvents(tx1, 'ConsensusReached', { expectedAmount: 0 })

      const tx2 = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })
      assertEvent(tx2, 'ReportReceived', {
        expectedArgs: { refSlot: frame.refSlot, member: member2, report: HASH_1 }
      })
      assertAmountOfEvents(tx2, 'ConsensusReached', { expectedAmount: 0 })

      await consensus.advanceTimeBy(SECONDS_PER_FRAME)

      const tx3 = await consensus.setQuorum(2)
      assertAmountOfEvents(tx3, 'ConsensusReached', { expectedAmount: 0 })
    })
  })
})
