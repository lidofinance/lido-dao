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
  describe('setQuorum and addMember changes getQuorum', () => {
    let consensus

    const deployContract = async () => {
      const deployed = await deployHashConsensus(admin, { initialEpoch: 1 })
      consensus = deployed.consensus
    }

    context('at deploy quorum is zero and can be set to any number while event is fired on every change', () => {
      before(deployContract)

      it('quorum is zero at deploy', async () => {
        assert.equal(+(await consensus.getQuorum()), 0)
      })

      it('quorum is changed, event is fired and getter returns new value', async () => {
        const tx1 = await consensus.setQuorum(1)
        assert.equal(+(await consensus.getQuorum()), 1)
        assertEvent(tx1, 'QuorumSet', { expectedArgs: { newQuorum: 1, totalMembers: 0, prevQuorum: 0 } })
      })

      it('change to same value does not emit event and value is the same', async () => {
        const tx2 = await consensus.setQuorum(1)
        assert.equal(+(await consensus.getQuorum()), 1)
        assertAmountOfEvents(tx2, 'QuorumSet', { expectedAmount: 0 })
      })

      it('quorum value changes up and down', async () => {
        const tx3 = await consensus.setQuorum(10)
        assert.equal(+(await consensus.getQuorum()), 10)
        assertEvent(tx3, 'QuorumSet', { expectedArgs: { newQuorum: 10, totalMembers: 0, prevQuorum: 1 } })

        const tx4 = await consensus.setQuorum(5)
        assert.equal(+(await consensus.getQuorum()), 5)
        assertEvent(tx4, 'QuorumSet', { expectedArgs: { newQuorum: 5, totalMembers: 0, prevQuorum: 10 } })
      })
    })

    context('as new members are added quorum is updated and cannot be set lower than members/2', () => {
      before(deployContract)

      it('addMember adds member and updates quorum', async () => {
        assert.equal(+(await consensus.getQuorum()), 0)

        const tx1 = await consensus.addMember(member1, 1, { from: admin })
        assert.equal(+(await consensus.getQuorum()), 1)
        assertEvent(tx1, 'QuorumSet', { expectedArgs: { newQuorum: 1, totalMembers: 1, prevQuorum: 0 } })
      })

      it('setQuorum reverts on value less than members/2', async () => {
        await assertRevert(consensus.setQuorum(0), 'QuorumTooSmall(1, 0)')

        await consensus.addMember(member2, 2, { from: admin })
        assert.equal(+(await consensus.getQuorum()), 2)

        await assertRevert(consensus.setQuorum(1), 'QuorumTooSmall(2, 1)')
      })

      it('addMember sets any valid quorum value', async () => {
        await consensus.addMember(member3, 2, { from: admin })
        assert.equal(+(await consensus.getQuorum()), 2)

        await consensus.setQuorum(3)
        assert.equal(+(await consensus.getQuorum()), 3)

        await assertRevert(consensus.setQuorum(1), 'QuorumTooSmall(2, 1)')

        await consensus.setQuorum(2)
        assert.equal(+(await consensus.getQuorum()), 2)
      })
    })
  })

  describe('setQuorum changes the effective quorum', () => {
    let consensus
    let reportProcessor
    let frame

    const deployContractWithMembers = async () => {
      const deployed = await deployHashConsensus(admin, { initialEpoch: 1 })
      consensus = deployed.consensus
      reportProcessor = deployed.reportProcessor

      await consensus.addMember(member1, 1, { from: admin })
      await consensus.addMember(member2, 2, { from: admin })
      await consensus.addMember(member3, 3, { from: admin })
      frame = await consensus.getCurrentFrame()
    }

    context('quorum increases and changes effective consensus', () => {
      before(deployContractWithMembers)

      it('consensus is reached at 2/3 for quorum of 2', async () => {
        await consensus.setQuorum(2)
        const tx1 = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
        assertEvent(tx1, 'ReportReceived', {
          expectedArgs: { refSlot: frame.refSlot, member: member1, report: HASH_1 }
        })
        assertAmountOfEvents(tx1, 'ConsensusReached', { expectedAmount: 0 })
        const tx2 = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })
        assertEvent(tx2, 'ReportReceived', {
          expectedArgs: { refSlot: frame.refSlot, member: member2, report: HASH_1 }
        })
        assertAmountOfEvents(tx2, 'ConsensusReached', { expectedAmount: 1 })
        assert.equal(+(await reportProcessor.getLastCall_submitReport()).callCount, 1)
      })

      it('quorum increases and effective consensus is changed to none', async () => {
        const tx3 = await consensus.setQuorum(3)
        assertAmountOfEvents(tx3, 'ConsensusReached', { expectedAmount: 0 })
        const consensusState = await consensus.getConsensusState()
        assert.equal(consensusState.consensusReport, ZERO_HASH)
        assert.isFalse(consensusState.isReportProcessing)
      })

      it('report starts processing and it is reflected in getConsensusState', async () => {
        await reportProcessor.startReportProcessing()
        const consensusState = await consensus.getConsensusState()
        assert.equal(consensusState.consensusReport, ZERO_HASH)
        assert.isTrue(consensusState.isReportProcessing)
      })
    })

    context('setQuorum triggers consensus on decrease', () => {
      before(deployContractWithMembers)

      it('2/3 reports come in', async () => {
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
      })

      it('quorum decreases and consensus is reached', async () => {
        const tx3 = await consensus.setQuorum(2)
        assertAmountOfEvents(tx3, 'ConsensusReached', { expectedAmount: 1 })
        const consensusState = await consensus.getConsensusState()
        assert.equal(consensusState.consensusReport, HASH_1)
      })
    })

    context('setQuorum does not re-trigger same consensus', () => {
      before(deployContractWithMembers)

      it('2/3 members reach consensus with quorum of 2', async () => {
        await consensus.setQuorum(2)
        const tx1 = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
        assertEvent(tx1, 'ReportReceived', {
          expectedArgs: { refSlot: frame.refSlot, member: member1, report: HASH_1 }
        })
        assertAmountOfEvents(tx1, 'ConsensusReached', { expectedAmount: 0 })

        const tx2 = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })
        assertEvent(tx2, 'ReportReceived', {
          expectedArgs: { refSlot: frame.refSlot, member: member2, report: HASH_1 }
        })
        assertAmountOfEvents(tx2, 'ConsensusReached', { expectedAmount: 1 })
        assert.equal(+(await reportProcessor.getLastCall_submitReport()).callCount, 1)
      })

      it('quorum goes up and effective consensus changes to none', async () => {
        await consensus.setQuorum(3)
        const consensusState = await consensus.getConsensusState()
        assert.equal(consensusState.consensusReport, ZERO_HASH)
        assert.isFalse(consensusState.isReportProcessing)
      })

      it('quorum goes down but same consensus is not triggered and report is not submitted', async () => {
        const tx = await consensus.setQuorum(2)
        assertAmountOfEvents(tx, 'ConsensusReached', { expectedAmount: 0 })

        const consensusState = await consensus.getConsensusState()
        assert.equal(consensusState.consensusReport, HASH_1)
        assert.isFalse(consensusState.isReportProcessing)

        assert.equal(+(await reportProcessor.getLastCall_submitReport()).callCount, 1)
      })
    })

    context('setQuorum does not re-trigger consensus if hash is already being processed', () => {
      before(deployContractWithMembers)

      it('2/3 members reach consensus with Quorum of 2', async () => {
        await consensus.setQuorum(2)
        const tx1 = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
        assertEvent(tx1, 'ReportReceived', {
          expectedArgs: { refSlot: frame.refSlot, member: member1, report: HASH_1 }
        })
        assertAmountOfEvents(tx1, 'ConsensusReached', { expectedAmount: 0 })

        const tx2 = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })
        assertEvent(tx2, 'ReportReceived', {
          expectedArgs: { refSlot: frame.refSlot, member: member2, report: HASH_1 }
        })
        assertAmountOfEvents(tx2, 'ConsensusReached', { expectedAmount: 1 })
      })

      it('reportProcessor starts processing', async () => {
        await reportProcessor.startReportProcessing()
        const consensusState = await consensus.getConsensusState()
        assert.equal(consensusState.consensusReport, HASH_1)
        assert.isTrue(consensusState.isReportProcessing)
      })

      it('quorum increases while report is processing', async () => {
        await consensus.setQuorum(3)
        const consensusState = await consensus.getConsensusState()
        assert.isTrue(consensusState.isReportProcessing)
      })

      it('quorum decreases but no consensus is triggered', async () => {
        const tx = await consensus.setQuorum(2)
        assertAmountOfEvents(tx, 'ConsensusReached', { expectedAmount: 0 })
        assert.equal(+(await reportProcessor.getLastCall_submitReport()).callCount, 1)
      })
    })
  })
})
