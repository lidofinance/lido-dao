const { contract } = require('hardhat')
const { assert } = require('../../helpers/assert')

const {
  ZERO_HASH,
  UNREACHABLE_QUORUM,
  HASH_1,
  CONSENSUS_VERSION,
  deployHashConsensus,
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
        assert.equals(await consensus.getQuorum(), 0)
      })

      it('quorum is changed, event is fired and getter returns new value', async () => {
        const tx1 = await consensus.setQuorum(1)
        assert.equals(await consensus.getQuorum(), 1)
        assert.emits(tx1, 'QuorumSet', { newQuorum: 1, totalMembers: 0, prevQuorum: 0 })
      })

      it('change to same value does not emit event and value is the same', async () => {
        const tx2 = await consensus.setQuorum(1)
        assert.equals(await consensus.getQuorum(), 1)
        assert.notEmits(tx2, 'QuorumSet')
      })

      it('quorum value changes up and down', async () => {
        const tx3 = await consensus.setQuorum(10)
        assert.equals(await consensus.getQuorum(), 10)
        assert.emits(tx3, 'QuorumSet', { newQuorum: 10, totalMembers: 0, prevQuorum: 1 })

        const tx4 = await consensus.setQuorum(5)
        assert.equals(await consensus.getQuorum(), 5)
        assert.emits(tx4, 'QuorumSet', { newQuorum: 5, totalMembers: 0, prevQuorum: 10 })
      })
    })

    context('as new members are added quorum is updated and cannot be set lower than members/2', () => {
      before(deployContract)

      it('addMember adds member and updates quorum', async () => {
        assert.equals(await consensus.getQuorum(), 0)

        const tx1 = await consensus.addMember(member1, 1, { from: admin })
        assert.equals(await consensus.getQuorum(), 1)
        assert.emits(tx1, 'QuorumSet', { newQuorum: 1, totalMembers: 1, prevQuorum: 0 })
      })

      it('setQuorum reverts on value less than members/2', async () => {
        await assert.reverts(consensus.setQuorum(0), 'QuorumTooSmall(1, 0)')

        await consensus.addMember(member2, 2, { from: admin })
        assert.equals(await consensus.getQuorum(), 2)

        await assert.reverts(consensus.setQuorum(1), 'QuorumTooSmall(2, 1)')
      })

      it('addMember sets any valid quorum value', async () => {
        await consensus.addMember(member3, 2, { from: admin })
        assert.equals(await consensus.getQuorum(), 2)

        await consensus.setQuorum(3)
        assert.equals(await consensus.getQuorum(), 3)

        await assert.reverts(consensus.setQuorum(1), 'QuorumTooSmall(2, 1)')

        await consensus.setQuorum(2)
        assert.equals(await consensus.getQuorum(), 2)
      })
    })

    context('disableConsensus sets unreachable quorum value', () => {
      before(deployContract)

      it('disableConsensus updated quorum value and emits events', async () => {
        const tx = await consensus.disableConsensus()
        assert.emits(tx, 'QuorumSet', {
          newQuorum: UNREACHABLE_QUORUM.toString(10),
          totalMembers: 0,
          prevQuorum: 0,
        })
        assert.equals(await consensus.getQuorum(), UNREACHABLE_QUORUM)
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
        assert.emits(tx1, 'ReportReceived', {
          refSlot: frame.refSlot,
          member: member1,
          report: HASH_1,
        })
        assert.notEmits(tx1, 'ConsensusReached')
        const tx2 = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })
        assert.emits(tx2, 'ReportReceived', {
          refSlot: frame.refSlot,
          member: member2,
          report: HASH_1,
        })
        assert.emitsNumberOfEvents(tx2, 'ConsensusReached', 1)
        assert.equals((await reportProcessor.getLastCall_submitReport()).callCount, 1)
      })

      it('quorum increases and effective consensus is changed to none', async () => {
        const tx3 = await consensus.setQuorum(3)
        assert.notEmits(tx3, 'ConsensusReached')
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
        assert.emits(tx1, 'ReportReceived', {
          refSlot: frame.refSlot,
          member: member1,
          report: HASH_1,
        })
        assert.notEmits(tx1, 'ConsensusReached')

        const tx2 = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })
        assert.emits(tx2, 'ReportReceived', {
          refSlot: frame.refSlot,
          member: member2,
          report: HASH_1,
        })
        assert.notEmits(tx2, 'ConsensusReached')
      })

      it('quorum decreases and consensus is reached', async () => {
        const tx3 = await consensus.setQuorum(2)
        assert.emitsNumberOfEvents(tx3, 'ConsensusReached', 1)
        const consensusState = await consensus.getConsensusState()
        assert.equal(consensusState.consensusReport, HASH_1)
      })
    })

    context('setQuorum can lead to consensus loss on quorum increase', () => {
      before(deployContractWithMembers)

      it('2/3 members reach consensus with quorum of 2', async () => {
        await consensus.setQuorum(2)
        const tx1 = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
        assert.emits(tx1, 'ReportReceived', {
          refSlot: frame.refSlot,
          member: member1,
          report: HASH_1,
        })
        assert.notEmits(tx1, 'ConsensusReached')

        const tx2 = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })
        assert.emits(tx2, 'ReportReceived', {
          refSlot: frame.refSlot,
          member: member2,
          report: HASH_1,
        })
        assert.emitsNumberOfEvents(tx2, 'ConsensusReached', 1)
        assert.equals((await reportProcessor.getLastCall_submitReport()).callCount, 1)
      })

      it('quorum goes up to 3 and consensus is lost', async () => {
        const tx = await consensus.setQuorum(3)
        assert.emits(tx, 'ConsensusLost', { refSlot: frame.refSlot })

        const consensusState = await consensus.getConsensusState()
        assert.equal(consensusState.consensusReport, ZERO_HASH)
        assert.isFalse(consensusState.isReportProcessing)

        assert.equals((await reportProcessor.getLastCall_discardReport()).callCount, 1)
      })

      it('quorum goes down, the consensus is reached again', async () => {
        const tx = await consensus.setQuorum(2)
        assert.emits(tx, 'ConsensusReached', { refSlot: frame.refSlot, report: HASH_1, support: 2 })

        const consensusState = await consensus.getConsensusState()
        assert.equal(consensusState.consensusReport, HASH_1)
        assert.isFalse(consensusState.isReportProcessing)

        assert.equals((await reportProcessor.getLastCall_submitReport()).callCount, 2)
      })
    })

    context('setQuorum does not re-trigger consensus if hash is already being processed', () => {
      before(deployContractWithMembers)

      it('2/3 members reach consensus with Quorum of 2', async () => {
        await consensus.setQuorum(2)
        const tx1 = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
        assert.emits(tx1, 'ReportReceived', {
          refSlot: frame.refSlot,
          member: member1,
          report: HASH_1,
        })
        assert.notEmits(tx1, 'ConsensusReached')

        const tx2 = await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })
        assert.emits(tx2, 'ReportReceived', {
          refSlot: frame.refSlot,
          member: member2,
          report: HASH_1,
        })
        assert.emitsNumberOfEvents(tx2, 'ConsensusReached', 1)
      })

      it('reportProcessor starts processing', async () => {
        await reportProcessor.startReportProcessing()
        const consensusState = await consensus.getConsensusState()
        assert.equal(consensusState.consensusReport, HASH_1)
        assert.isTrue(consensusState.isReportProcessing)
      })

      it('quorum increases while report is processing', async () => {
        const tx = await consensus.setQuorum(3)
        assert.notEmits(tx, 'ConsensusReached')
        assert.notEmits(tx, 'ConsensusLost')

        const consensusState = await consensus.getConsensusState()
        assert.isTrue(consensusState.isReportProcessing)

        assert.equals((await reportProcessor.getLastCall_discardReport()).callCount, 0)
      })

      it('quorum decreases but no consensus is triggered', async () => {
        const tx = await consensus.setQuorum(2)
        assert.notEmits(tx, 'ConsensusReached')
        assert.notEmits(tx, 'ConsensusLost')
        assert.equals((await reportProcessor.getLastCall_submitReport()).callCount, 1)
        assert.equals((await reportProcessor.getLastCall_discardReport()).callCount, 0)
      })
    })
  })
})
