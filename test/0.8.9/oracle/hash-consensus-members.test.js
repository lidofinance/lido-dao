const { contract } = require('hardhat')
const { assert } = require('../../helpers/assert')
const { toNum } = require('../../helpers/utils')
const { ZERO_ADDRESS } = require('../../helpers/constants')

const { HASH_1, HASH_2, CONSENSUS_VERSION, deployHashConsensus, ZERO_HASH } = require('./hash-consensus-deploy.test')

contract('HashConsensus', ([admin, member1, member2, member3, member4, member5, member6, stranger]) => {
  context('Managing members and quorum', () => {
    let consensus

    const deploy = async (options = undefined) => {
      const deployed = await deployHashConsensus(admin, options)
      consensus = deployed.consensus
    }

    context('initial state', () => {
      before(deploy)

      it('members list is empty', async () => {
        const membersInfo = await consensus.getMembers()
        assert.isEmpty(membersInfo.addresses)
        assert.isEmpty(membersInfo.lastReportedRefSlots)

        assert.isFalse(await consensus.getIsMember(member1))

        const member1Info = await consensus.getConsensusStateForMember(member1)
        assert.isFalse(member1Info.isMember)
        assert.isFalse(member1Info.canReport)
        assert.equals(member1Info.lastMemberReportRefSlot, 0)
        assert.equal(member1Info.currentFrameMemberReport, ZERO_HASH)
      })

      it('quorum is zero', async () => {
        assert.equals(await consensus.getQuorum(), 0)
      })
    })

    context('addMember', () => {
      before(deploy)

      it('reverts if member address equals zero', async () => {
        await assert.revertsWithCustomError(
          consensus.addMember(ZERO_ADDRESS, 1, { from: admin }),
          'AddressCannotBeZero()'
        )
      })

      it(`doesn't allow setting quorum to zero`, async () => {
        await assert.reverts(consensus.addMember(member1, 0, { from: admin }), 'QuorumTooSmall(1, 0)')
      })

      it('allows to add a member, setting the new quorum', async () => {
        const newQuorum = 1
        const tx = await consensus.addMember(member1, newQuorum, { from: admin })

        assert.emits(tx, 'MemberAdded', { addr: member1, newTotalMembers: 1, newQuorum: 1 })
        assert.isTrue(await consensus.getIsMember(member1))

        const membersInfo = await consensus.getMembers()
        assert.sameOrderedMembers(membersInfo.addresses, [member1])
        assert.sameOrderedMembers(membersInfo.lastReportedRefSlots.map(toNum), [0])

        const member1Info = await consensus.getConsensusStateForMember(member1)
        assert.isTrue(member1Info.isMember)
        assert.isTrue(member1Info.canReport)
        assert.equals(member1Info.lastMemberReportRefSlot, 0)
        assert.equal(member1Info.currentFrameMemberReport, ZERO_HASH)

        assert.equals(await consensus.getQuorum(), 1)
      })

      it(`doesn't allow to add the same member twice`, async () => {
        await assert.reverts(consensus.addMember(member1, 2, { from: admin }), 'DuplicateMember()')
      })

      it(`requires quorum to be more than half of the total members count`, async () => {
        await assert.reverts(consensus.addMember(member2, 1, { from: admin }), 'QuorumTooSmall(2, 1)')
      })

      it(`allows setting the quorum more than total members count`, async () => {
        const tx = await consensus.addMember(member2, 3, { from: admin })
        assert.emits(tx, 'MemberAdded', { addr: member2, newTotalMembers: 2, newQuorum: 3 })
        assert.isTrue(await consensus.getIsMember(member2))
        assert.equals(await consensus.getQuorum(), 3)
      })

      it(`lowering the quorum while adding a member may trigger consensus`, async () => {
        await consensus.addMember(member3, 3, { from: admin })
        await consensus.addMember(member4, 4, { from: admin })

        const { refSlot } = await consensus.getCurrentFrame()

        await consensus.submitReport(refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
        await consensus.submitReport(refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })
        await consensus.submitReport(refSlot, HASH_1, CONSENSUS_VERSION, { from: member3 })
        assert.equal((await consensus.getConsensusState()).consensusReport, ZERO_HASH)

        const tx = await consensus.addMember(member5, 3, { from: admin })
        assert.emits(tx, 'MemberAdded', { addr: member5, newTotalMembers: 5, newQuorum: 3 })
        assert.emits(tx, 'ConsensusReached', { refSlot, report: HASH_1, support: 3 })
        assert.equal((await consensus.getConsensusState()).consensusReport, HASH_1)
      })

      it(`increasing the quorum might trigger consensus loss`, async () => {
        const { refSlot } = await consensus.getCurrentFrame()
        const tx = await consensus.addMember(member6, 4, { from: admin })
        assert.emits(tx, 'ConsensusLost', { refSlot })
      })
    })

    context('removeMember', () => {
      beforeEach(deploy)

      beforeEach(async () => {
        await consensus.addMember(member1, 4, { from: admin })
        await consensus.addMember(member2, 4, { from: admin })
        await consensus.addMember(member3, 4, { from: admin })
        await consensus.addMember(member4, 4, { from: admin })
        await consensus.addMember(member5, 4, { from: admin })

        const membersInfo = await consensus.getMembers()
        assert.sameMembers(membersInfo.addresses, [member1, member2, member3, member4, member5])
        assert.sameMembers(membersInfo.lastReportedRefSlots.map(toNum), [0, 0, 0, 0, 0])
      })

      it('removes a member, setting the new quorum', async () => {
        const tx = await consensus.removeMember(member1, 3, { from: admin })

        assert.emits(tx, 'MemberRemoved', { addr: member1, newTotalMembers: 4, newQuorum: 3 })
        assert.isFalse(await consensus.getIsMember(member1))
        assert.equals(await consensus.getQuorum(), 3)

        const member1Info = await consensus.getConsensusStateForMember(member1)
        assert.isFalse(member1Info.isMember)
        assert.equals(member1Info.lastMemberReportRefSlot, 0)
        assert.equal(member1Info.currentFrameMemberReport, ZERO_HASH)
      })

      it(`doesn't allow removing a non-member`, async () => {
        await assert.reverts(consensus.removeMember(stranger, 4, { from: admin }), 'NonMember()')
      })

      it(`doesn't allow removing an already removed member`, async () => {
        await consensus.removeMember(member1, 4, { from: admin })
        await assert.reverts(consensus.removeMember(member1, 4, { from: admin }), 'NonMember()')
      })

      it('allows removing all members', async () => {
        await consensus.removeMember(member1, 3, { from: admin })
        assert.sameMembers((await consensus.getMembers()).addresses, [member2, member3, member4, member5])
        assert.equals(await consensus.getQuorum(), 3)

        await consensus.removeMember(member3, 2, { from: admin })
        assert.sameMembers((await consensus.getMembers()).addresses, [member2, member4, member5])
        assert.equals(await consensus.getQuorum(), 2)

        await consensus.removeMember(member4, 2, { from: admin })
        assert.sameMembers((await consensus.getMembers()).addresses, [member2, member5])
        assert.equals(await consensus.getQuorum(), 2)

        await consensus.removeMember(member5, 1, { from: admin })
        assert.sameMembers((await consensus.getMembers()).addresses, [member2])
        assert.equals(await consensus.getQuorum(), 1)

        await consensus.removeMember(member2, 1, { from: admin })
        assert.isEmpty((await consensus.getMembers()).addresses)
        assert.equals(await consensus.getQuorum(), 1)
      })

      it(`removing a member who didn't vote doesn't decrease any report variant's support`, async () => {
        const { refSlot } = await consensus.getCurrentFrame()
        await consensus.submitReport(refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
        await consensus.submitReport(refSlot, HASH_2, CONSENSUS_VERSION, { from: member4 })

        let reportVariants = await consensus.getReportVariants()
        assert.sameOrderedMembers(reportVariants.variants, [HASH_1, HASH_2])
        assert.sameOrderedMembers(reportVariants.support.map(toNum), [1, 1])

        await consensus.removeMember(member2, 3, { from: admin })

        reportVariants = await consensus.getReportVariants()
        assert.sameOrderedMembers(reportVariants.variants, [HASH_1, HASH_2])
        assert.sameOrderedMembers(reportVariants.support.map(toNum), [1, 1])
      })

      it(`removing a member who didn't vote can trigger consensus`, async () => {
        const { refSlot } = await consensus.getCurrentFrame()
        await consensus.submitReport(refSlot, HASH_2, CONSENSUS_VERSION, { from: member1 })
        await consensus.submitReport(refSlot, HASH_2, CONSENSUS_VERSION, { from: member3 })
        await consensus.submitReport(refSlot, HASH_2, CONSENSUS_VERSION, { from: member4 })

        const reportVariants = await consensus.getReportVariants()
        assert.sameOrderedMembers(reportVariants.variants, [HASH_2])
        assert.sameOrderedMembers(reportVariants.support.map(toNum), [3])

        const tx = await consensus.removeMember(member2, 3, { from: admin })

        assert.emits(tx, 'ConsensusReached', { refSlot, report: HASH_2, support: 3 })
        assert.equal((await consensus.getConsensusState()).consensusReport, HASH_2)
      })

      it(`removing a member who voted decreases the voted variant's support`, async () => {
        const { refSlot } = await consensus.getCurrentFrame()
        await consensus.submitReport(refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
        await consensus.submitReport(refSlot, HASH_2, CONSENSUS_VERSION, { from: member2 })
        await consensus.submitReport(refSlot, HASH_2, CONSENSUS_VERSION, { from: member4 })
        await consensus.submitReport(refSlot, HASH_2, CONSENSUS_VERSION, { from: member5 })

        let reportVariants = await consensus.getReportVariants()
        assert.sameOrderedMembers(reportVariants.variants, [HASH_1, HASH_2])
        assert.sameOrderedMembers(reportVariants.support.map(toNum), [1, 3])

        await consensus.removeMember(member2, 3, { from: admin })

        reportVariants = await consensus.getReportVariants()
        assert.sameOrderedMembers(reportVariants.variants, [HASH_1, HASH_2])
        assert.sameOrderedMembers(reportVariants.support.map(toNum), [1, 2])

        assert.equal((await consensus.getConsensusState()).consensusReport, ZERO_HASH)
      })

      it(`removing a member who voted can trigger consensus loss`, async () => {
        const { refSlot } = await consensus.getCurrentFrame()
        await consensus.submitReport(refSlot, HASH_2, CONSENSUS_VERSION, { from: member1 })
        await consensus.submitReport(refSlot, HASH_2, CONSENSUS_VERSION, { from: member2 })
        await consensus.submitReport(refSlot, HASH_2, CONSENSUS_VERSION, { from: member4 })

        let tx = await consensus.submitReport(refSlot, HASH_2, CONSENSUS_VERSION, { from: member5 })
        assert.emits(tx, 'ConsensusReached', { refSlot, report: HASH_2, support: 4 })
        assert.equal((await consensus.getConsensusState()).consensusReport, HASH_2)

        let reportVariants = await consensus.getReportVariants()
        assert.sameOrderedMembers(reportVariants.variants, [HASH_2])
        assert.sameOrderedMembers(reportVariants.support.map(toNum), [4])

        tx = await consensus.removeMember(member2, 4, { from: admin })
        assert.emits(tx, 'ConsensusLost', { refSlot })
        assert.equal((await consensus.getConsensusState()).consensusReport, ZERO_HASH)

        reportVariants = await consensus.getReportVariants()
        assert.sameOrderedMembers(reportVariants.variants, [HASH_2])
        assert.sameOrderedMembers(reportVariants.support.map(toNum), [3])
      })

      it(`allows to remove a member that's the only one who voted for a variant`, async () => {
        const { refSlot } = await consensus.getCurrentFrame()
        await consensus.submitReport(refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })

        await consensus.removeMember(member1, 3, { from: admin })

        const reportVariants = await consensus.getReportVariants()
        assert.sameOrderedMembers(reportVariants.variants, [HASH_1])
        assert.sameOrderedMembers(reportVariants.support.map(toNum), [0])
      })
    })

    context('Re-triggering consensus via members and quorum manipulation', () => {
      beforeEach(deploy)

      it(`scenario 1`, async () => {
        await consensus.addMember(member1, 1, { from: admin })
        await consensus.addMember(member2, 2, { from: admin })

        const { refSlot } = await consensus.getCurrentFrame()

        let tx = await consensus.submitReport(refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })
        assert.notEmits(tx, 'ConsensusReached')
        assert.notEmits(tx, 'ConsensusLost')

        tx = await consensus.submitReport(refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
        assert.emits(tx, 'ConsensusReached', { refSlot, report: HASH_1, support: 2 })
        assert.notEmits(tx, 'ConsensusLost')
        assert.equal((await consensus.getConsensusState()).consensusReport, HASH_1)

        tx = await consensus.addMember(member3, 3, { from: admin })
        assert.emits(tx, 'ConsensusLost', { refSlot })
        assert.notEmits(tx, 'ConsensusReached')
        assert.equal((await consensus.getConsensusState()).consensusReport, ZERO_HASH)

        tx = await consensus.removeMember(member3, 2, { from: admin })
        assert.emits(tx, 'ConsensusReached', { refSlot, report: HASH_1, support: 2 })
        assert.notEmits(tx, 'ConsensusLost')
        assert.equal((await consensus.getConsensusState()).consensusReport, HASH_1)
      })

      it(`scenario 2`, async () => {
        await consensus.addMember(member1, 1, { from: admin })
        await consensus.addMember(member2, 2, { from: admin })

        const { refSlot } = await consensus.getCurrentFrame()

        let tx = await consensus.submitReport(refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })
        assert.notEmits(tx, 'ConsensusReached')
        assert.notEmits(tx, 'ConsensusLost')

        tx = await consensus.submitReport(refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
        assert.emits(tx, 'ConsensusReached', { refSlot, report: HASH_1, support: 2 })
        assert.notEmits(tx, 'ConsensusLost')
        assert.equal((await consensus.getConsensusState()).consensusReport, HASH_1)

        tx = await consensus.addMember(member3, 2, { from: admin })
        assert.notEmits(tx, 'ConsensusReached')
        assert.notEmits(tx, 'ConsensusLost')
        assert.equal((await consensus.getConsensusState()).consensusReport, HASH_1)

        tx = await consensus.removeMember(member3, 2, { from: admin })
        assert.notEmits(tx, 'ConsensusReached')
        assert.notEmits(tx, 'ConsensusLost')
        assert.equal((await consensus.getConsensusState()).consensusReport, HASH_1)
      })

      it(`scenario 3`, async () => {
        await consensus.addMember(member1, 1, { from: admin })
        await consensus.addMember(member2, 2, { from: admin })

        const { refSlot } = await consensus.getCurrentFrame()

        let tx = await consensus.submitReport(refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })
        assert.notEmits(tx, 'ConsensusReached')
        assert.notEmits(tx, 'ConsensusLost')

        tx = await consensus.submitReport(refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
        assert.emits(tx, 'ConsensusReached', { refSlot, report: HASH_1, support: 2 })
        assert.notEmits(tx, 'ConsensusLost')
        assert.equal((await consensus.getConsensusState()).consensusReport, HASH_1)

        tx = await consensus.addMember(member3, 3, { from: admin })
        assert.emits(tx, 'ConsensusLost', { refSlot })
        assert.notEmits(tx, 'ConsensusReached')
        assert.equal((await consensus.getConsensusState()).consensusReport, ZERO_HASH)

        tx = await consensus.submitReport(refSlot, HASH_1, CONSENSUS_VERSION, { from: member3 })
        assert.emits(tx, 'ConsensusReached', { refSlot, report: HASH_1, support: 3 })
        assert.equal((await consensus.getConsensusState()).consensusReport, HASH_1)

        tx = await consensus.removeMember(member3, 2, { from: admin })
        assert.notEmits(tx, 'ConsensusReached')
        assert.notEmits(tx, 'ConsensusLost')
        assert.equal((await consensus.getConsensusState()).consensusReport, HASH_1)
      })

      it(`scenario 4`, async () => {
        const { refSlot } = await consensus.getCurrentFrame()

        await consensus.addMember(member1, 1, { from: admin })
        await consensus.addMember(member2, 2, { from: admin })
        await consensus.addMember(member3, 2, { from: admin })

        let tx = await consensus.submitReport(refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
        assert.notEmits(tx, 'ConsensusReached')
        assert.notEmits(tx, 'ConsensusLost')

        tx = await consensus.submitReport(refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })
        assert.emits(tx, 'ConsensusReached', { refSlot, report: HASH_1, support: 2 })
        assert.notEmits(tx, 'ConsensusLost')
        assert.equal((await consensus.getConsensusState()).consensusReport, HASH_1)

        tx = await consensus.submitReport(refSlot, HASH_2, CONSENSUS_VERSION, { from: member3 })
        assert.notEmits(tx, 'ConsensusReached')
        assert.notEmits(tx, 'ConsensusLost')
        assert.equal((await consensus.getConsensusState()).consensusReport, HASH_1)

        tx = await consensus.addMember(member4, 3, { from: admin })
        assert.emits(tx, 'ConsensusLost', { refSlot })
        assert.equal((await consensus.getConsensusState()).consensusReport, ZERO_HASH)

        tx = await consensus.addMember(member5, 3, { from: admin })
        assert.notEmits(tx, 'ConsensusReached')
        assert.notEmits(tx, 'ConsensusLost')
        assert.equal((await consensus.getConsensusState()).consensusReport, ZERO_HASH)

        tx = await consensus.submitReport(refSlot, HASH_2, CONSENSUS_VERSION, { from: member4 })
        assert.notEmits(tx, 'ConsensusReached')
        assert.notEmits(tx, 'ConsensusLost')
        assert.equal((await consensus.getConsensusState()).consensusReport, ZERO_HASH)

        tx = await consensus.submitReport(refSlot, HASH_2, CONSENSUS_VERSION, { from: member5 })
        assert.emits(tx, 'ConsensusReached', { refSlot, report: HASH_2, support: 3 })
        assert.notEmits(tx, 'ConsensusLost')
        assert.equal((await consensus.getConsensusState()).consensusReport, HASH_2)
      })

      it(`scenario 5`, async () => {
        const { refSlot } = await consensus.getCurrentFrame()

        await consensus.addMember(member1, 1, { from: admin })
        await consensus.addMember(member2, 2, { from: admin })
        await consensus.addMember(member3, 2, { from: admin })

        let tx = await consensus.submitReport(refSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
        assert.notEmits(tx, 'ConsensusReached')
        assert.notEmits(tx, 'ConsensusLost')

        tx = await consensus.submitReport(refSlot, HASH_1, CONSENSUS_VERSION, { from: member2 })
        assert.emits(tx, 'ConsensusReached', { refSlot, report: HASH_1, support: 2 })
        assert.notEmits(tx, 'ConsensusLost')
        assert.equal((await consensus.getConsensusState()).consensusReport, HASH_1)

        tx = await consensus.submitReport(refSlot, HASH_2, CONSENSUS_VERSION, { from: member3 })
        assert.notEmits(tx, 'ConsensusReached')
        assert.notEmits(tx, 'ConsensusLost')
        assert.equal((await consensus.getConsensusState()).consensusReport, HASH_1)

        tx = await consensus.addMember(member4, 3, { from: admin })
        assert.emits(tx, 'ConsensusLost', { refSlot })
        assert.notEmits(tx, 'ConsensusReached')
        assert.equal((await consensus.getConsensusState()).consensusReport, ZERO_HASH)

        tx = await consensus.addMember(member5, 4, { from: admin })
        assert.notEmits(tx, 'ConsensusReached')
        assert.notEmits(tx, 'ConsensusLost')
        assert.equal((await consensus.getConsensusState()).consensusReport, ZERO_HASH)

        tx = await consensus.submitReport(refSlot, HASH_2, CONSENSUS_VERSION, { from: member4 })
        assert.notEmits(tx, 'ConsensusReached')
        assert.notEmits(tx, 'ConsensusLost')
        assert.equal((await consensus.getConsensusState()).consensusReport, ZERO_HASH)

        tx = await consensus.submitReport(refSlot, HASH_2, CONSENSUS_VERSION, { from: member5 })
        assert.notEmits(tx, 'ConsensusReached')
        assert.notEmits(tx, 'ConsensusLost')
        assert.equal((await consensus.getConsensusState()).consensusReport, ZERO_HASH)

        tx = await consensus.removeMember(member2, 3, { from: admin })
        assert.emits(tx, 'ConsensusReached', { refSlot, report: HASH_2, support: 3 })
        assert.notEmits(tx, 'ConsensusLost')
        assert.equal((await consensus.getConsensusState()).consensusReport, HASH_2)
      })
    })
  })
})
