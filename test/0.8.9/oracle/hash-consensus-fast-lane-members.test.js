const { contract } = require('hardhat')
const { assert } = require('../../helpers/assert')
const { toNum } = require('../../helpers/utils')
const { MAX_UINT256 } = require('../../helpers/constants')

const { HASH_1, CONSENSUS_VERSION, deployHashConsensus } = require('./hash-consensus-deploy.test')

contract('HashConsensus', ([admin, member1, member2, member3, member4, member5, stranger]) => {
  context('Fast-lane members', async () => {
    let consensus

    const deploy = async (options = undefined) => {
      const deployed = await deployHashConsensus(admin, options)
      consensus = deployed.consensus
    }

    const setTimeToFrame0 = async () => {
      await consensus.setTimeInEpochs((await consensus.getFrameConfig()).initialEpoch)
      assert.equals(await consensus.getTimeInSlots(), +(await consensus.getCurrentFrame()).refSlot + 1)
    }

    context('State after initialization', () => {
      before(deploy)

      it('nobody is in the fast lane set', async () => {
        assert.isFalse(await consensus.getIsFastLaneMember(member1))
        assert.isFalse((await consensus.getConsensusStateForMember(member1)).isFastLane)

        assert.isFalse(await consensus.getIsFastLaneMember(member2))
        assert.isFalse((await consensus.getConsensusStateForMember(member2)).isFastLane)

        assert.isFalse(await consensus.getIsFastLaneMember(member3))
        assert.isFalse((await consensus.getConsensusStateForMember(member3)).isFastLane)

        assert.isEmpty((await consensus.getFastLaneMembers()).addresses)
      })
    })

    context('Basic scenario', () => {
      const fastLaneLengthSlots = 10

      const frames = [
        { fastLaneMembers: [member1, member2, member3], restMembers: [member4, member5] },
        { fastLaneMembers: [member2, member3, member4], restMembers: [member5, member1] },
        { fastLaneMembers: [member3, member4, member5], restMembers: [member1, member2] },
        { fastLaneMembers: [member4, member5, member1], restMembers: [member2, member3] },
        { fastLaneMembers: [member5, member1, member2], restMembers: [member3, member4] },
        { fastLaneMembers: [member1, member2, member3], restMembers: [member4, member5] },
        { fastLaneMembers: [member2, member3, member4], restMembers: [member5, member1] },
        { fastLaneMembers: [member3, member4, member5], restMembers: [member1, member2] },
        { fastLaneMembers: [member4, member5, member1], restMembers: [member2, member3] },
        { fastLaneMembers: [member5, member1, member2], restMembers: [member3, member4] },
        { fastLaneMembers: [member1, member2, member3], restMembers: [member4, member5] },
        { fastLaneMembers: [member2, member3, member4], restMembers: [member5, member1] },
      ]

      before(async () => {
        await deploy({ fastLaneLengthSlots })

        await consensus.addMember(member1, 1, { from: admin })
        await consensus.addMember(member2, 2, { from: admin })
        await consensus.addMember(member3, 2, { from: admin })
        await consensus.addMember(member4, 3, { from: admin })
        await consensus.addMember(member5, 3, { from: admin })
      })

      before(setTimeToFrame0)

      const testFrame = ({ fastLaneMembers, restMembers }, index) =>
        context(`frame ${index}`, () => {
          let frame

          before(async () => {
            frame = await consensus.getCurrentFrame()
          })

          after(async () => {
            await consensus.advanceTimeToNextFrameStart()
          })

          it(`fast lane members are calculated correctly`, async () => {
            assert.isTrue(await consensus.getIsFastLaneMember(fastLaneMembers[0]))
            assert.isTrue((await consensus.getConsensusStateForMember(fastLaneMembers[0])).isFastLane)

            assert.isTrue(await consensus.getIsFastLaneMember(fastLaneMembers[1]))
            assert.isTrue((await consensus.getConsensusStateForMember(fastLaneMembers[1])).isFastLane)

            assert.isTrue(await consensus.getIsFastLaneMember(fastLaneMembers[2]))
            assert.isTrue((await consensus.getConsensusStateForMember(fastLaneMembers[2])).isFastLane)

            assert.isFalse(await consensus.getIsFastLaneMember(restMembers[0]))
            assert.isFalse((await consensus.getConsensusStateForMember(restMembers[0])).isFastLane)

            assert.isFalse(await consensus.getIsFastLaneMember(restMembers[1]))
            assert.isFalse((await consensus.getConsensusStateForMember(restMembers[1])).isFastLane)

            assert.sameMembers((await consensus.getFastLaneMembers()).addresses, fastLaneMembers)

            assert.sameMembers((await consensus.getMembers()).addresses, [member1, member2, member3, member4, member5])
          })

          it('non-members are not in the fast lane set', async () => {
            assert.isFalse(await consensus.getIsFastLaneMember(stranger))
            assert.isFalse((await consensus.getConsensusStateForMember(stranger)).isFastLane)
          })

          it(`fast lane members can submit a report in the first part of the frame`, async () => {
            assert.isTrue((await consensus.getConsensusStateForMember(fastLaneMembers[0])).canReport)
            await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: fastLaneMembers[0] })

            assert.isTrue((await consensus.getConsensusStateForMember(fastLaneMembers[1])).canReport)
            await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: fastLaneMembers[1] })

            await consensus.advanceTimeBySlots(fastLaneLengthSlots - 1)

            assert.isTrue((await consensus.getConsensusStateForMember(fastLaneMembers[2])).canReport)
            await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: fastLaneMembers[2] })

            assert.equal((await consensus.getConsensusState()).consensusReport, HASH_1)
          })

          it(`non-fast lane members cannot submit a report in the first part of the frame`, async () => {
            assert.isFalse((await consensus.getConsensusStateForMember(restMembers[0])).canReport)
            await assert.reverts(
              consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: restMembers[0] }),
              'NonFastLaneMemberCannotReportWithinFastLaneInterval()'
            )

            assert.isFalse((await consensus.getConsensusStateForMember(restMembers[1])).canReport)
            await assert.reverts(
              consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: restMembers[1] }),
              'NonFastLaneMemberCannotReportWithinFastLaneInterval()'
            )
          })

          it(`non-fast lane members can submit a report during the rest of the frame`, async () => {
            await consensus.advanceTimeBySlots(1)

            assert.isTrue((await consensus.getConsensusStateForMember(restMembers[0])).canReport)
            await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: restMembers[0] })

            assert.isTrue((await consensus.getConsensusStateForMember(restMembers[1])).canReport)
            await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, { from: restMembers[1] })

            const variants = await consensus.getReportVariants()
            assert.sameOrderedMembers(variants.variants, [HASH_1])
            assert.sameOrderedMembers(toNum(variants.support), [5])
          })
        })

      frames.forEach(testFrame)
    })

    const testAllInFastLane = ({ quorumSize }) => {
      before(async () => {
        await deploy({ fastLaneLengthSlots: 10 })

        await consensus.addMember(member1, quorumSize, { from: admin })
        await consensus.addMember(member2, quorumSize, { from: admin })
        await consensus.addMember(member3, quorumSize, { from: admin })
      })

      before(setTimeToFrame0)

      const testFrame = (frameIndex) =>
        context(`frame ${frameIndex}`, () => {
          after(async () => {
            await consensus.advanceTimeToNextFrameStart()
          })

          it(`all members are in the fast lane set`, async () => {
            assert.isTrue(await consensus.getIsFastLaneMember(member1))
            assert.isTrue((await consensus.getConsensusStateForMember(member1)).isFastLane)

            assert.isTrue(await consensus.getIsFastLaneMember(member2))
            assert.isTrue((await consensus.getConsensusStateForMember(member2)).isFastLane)

            assert.isTrue(await consensus.getIsFastLaneMember(member3))
            assert.isTrue((await consensus.getConsensusStateForMember(member3)).isFastLane)

            assert.sameMembers((await consensus.getFastLaneMembers()).addresses, [member1, member2, member3])

            assert.sameMembers((await consensus.getMembers()).addresses, [member1, member2, member3])
          })

          it('non-members are not in the fast lane set', async () => {
            assert.isFalse(await consensus.getIsFastLaneMember(stranger))
            assert.isFalse((await consensus.getConsensusStateForMember(stranger)).isFastLane)
          })
        })

      Array.from({ length: 10 }, (_, i) => i).forEach(testFrame)
    }

    context('Quorum size equal to total members', () => testAllInFastLane({ quorumSize: 3 }))
    context('Quorum size more than total members', () => testAllInFastLane({ quorumSize: 5 }))
    context('Quorum is a max value', () => testAllInFastLane({ quorumSize: MAX_UINT256 }))
  })
})
