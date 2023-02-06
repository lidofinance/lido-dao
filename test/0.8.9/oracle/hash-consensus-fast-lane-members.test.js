const { assert } = require('../../helpers/assert')
const { toNum } = require('../../helpers/utils')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const {
  SLOTS_PER_EPOCH, SECONDS_PER_SLOT, GENESIS_TIME, EPOCHS_PER_FRAME,
  SECONDS_PER_EPOCH, SECONDS_PER_FRAME, SLOTS_PER_FRAME,
  computeSlotAt, computeEpochAt, computeEpochFirstSlot, computeEpochFirstSlotAt,
  computeTimestampAtSlot, computeTimestampAtEpoch,
  ZERO_HASH, HASH_1, HASH_2, HASH_3, HASH_4, HASH_5,
  CONSENSUS_VERSION, deployHashConsensus} = require('./hash-consensus-deploy.test')


contract('HashConsensus', ([admin, member1, member2, member3, member4, member5, stranger]) => {
  context('Fast-lane members', async () => {
    let consensus

    const deploy = async (options = undefined) => {
      const deployed = await deployHashConsensus(admin, options)
      consensus = deployed.consensus
    }

    context('Basic scenario', () => {
      const fastLaneLengthSlots = 10

      const frames = [
        {fastLaneMembers: [member1, member2, member3], restMembers: [member4, member5]},
        {fastLaneMembers: [member2, member3, member4], restMembers: [member5, member1]},
        {fastLaneMembers: [member3, member4, member5], restMembers: [member1, member2]},
        {fastLaneMembers: [member4, member5, member1], restMembers: [member2, member3]},
        {fastLaneMembers: [member5, member1, member2], restMembers: [member3, member4]},
        {fastLaneMembers: [member1, member2, member3], restMembers: [member4, member5]},
        {fastLaneMembers: [member2, member3, member4], restMembers: [member5, member1]},
        {fastLaneMembers: [member3, member4, member5], restMembers: [member1, member2]},
        {fastLaneMembers: [member4, member5, member1], restMembers: [member2, member3]},
        {fastLaneMembers: [member5, member1, member2], restMembers: [member3, member4]},
        {fastLaneMembers: [member1, member2, member3], restMembers: [member4, member5]},
        {fastLaneMembers: [member2, member3, member4], restMembers: [member5, member1]},
      ]

      before(async () => {
        await deploy({fastLaneLengthSlots})

        await consensus.addMember(member1, 1, {from: admin})
        await consensus.addMember(member2, 2, {from: admin})
        await consensus.addMember(member3, 2, {from: admin})
        await consensus.addMember(member4, 3, {from: admin})
        await consensus.addMember(member5, 3, {from: admin})

        await consensus.setTimeInEpochs((await consensus.getFrameConfig()).initialEpoch)
        assert.equal(
          +await consensus.getTimeInSlots(),
          +(await consensus.getCurrentFrame()).refSlot + 1
        )
      })

      const testFrame = ({fastLaneMembers, restMembers}, index) => context(`frame ${index}`, () => {
        let frame

        before(async () => {
          frame = await consensus.getCurrentFrame()
        })

        after(async () => {
          await consensus.advanceTimeToNextFrameStart()
        })

        it(`fast lane members are calculated correctly`, async () => {
          assert.isTrue(await consensus.getIsFastLaneMember(fastLaneMembers[0]))
          assert.isTrue((await consensus.getMemberInfo(fastLaneMembers[0])).isFastLane)

          assert.isTrue(await consensus.getIsFastLaneMember(fastLaneMembers[1]))
          assert.isTrue((await consensus.getMemberInfo(fastLaneMembers[1])).isFastLane)

          assert.isTrue(await consensus.getIsFastLaneMember(fastLaneMembers[2]))
          assert.isTrue((await consensus.getMemberInfo(fastLaneMembers[2])).isFastLane)

          assert.isFalse(await consensus.getIsFastLaneMember(restMembers[0]))
          assert.isFalse((await consensus.getMemberInfo(restMembers[0])).isFastLane)

          assert.isFalse(await consensus.getIsFastLaneMember(restMembers[1]))
          assert.isFalse((await consensus.getMemberInfo(restMembers[1])).isFastLane)

          assert.sameOrderedMembers(
            (await consensus.getFastLaneMembers()).addresses,
            fastLaneMembers
          )

          assert.sameOrderedMembers(
            (await consensus.getMembers()).addresses,
            [member1, member2, member3, member4, member5]
          )
        })

        it(`fast lane members can submit a report in the first part of the frame`, async () => {
          assert.isTrue((await consensus.getMemberInfo(fastLaneMembers[0])).canReport)
          await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, {from: fastLaneMembers[0]})

          assert.isTrue((await consensus.getMemberInfo(fastLaneMembers[1])).canReport)
          await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, {from: fastLaneMembers[1]})

          await consensus.advanceTimeBySlots(fastLaneLengthSlots - 1)

          assert.isTrue((await consensus.getMemberInfo(fastLaneMembers[2])).canReport)
          await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, {from: fastLaneMembers[2]})

          assert.equal((await consensus.getConsensusState()).consensusReport, HASH_1)
        })

        it(`non-fast lane members cannot submit a report in the first part of the frame`, async () => {
          assert.isFalse((await consensus.getMemberInfo(restMembers[0])).canReport)
          await assert.reverts(
            consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, {from: restMembers[0]}),
            'NonFastLaneMemberCannotReportWithinFastLaneInterval()'
          )

          assert.isFalse((await consensus.getMemberInfo(restMembers[1])).canReport)
          await assert.reverts(
            consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, {from: restMembers[1]}),
            'NonFastLaneMemberCannotReportWithinFastLaneInterval()'
          )
        })

        it(`non-fast lane members can submit a report during the rest of the frame`, async () => {
          await consensus.advanceTimeBySlots(1)

          assert.isTrue((await consensus.getMemberInfo(restMembers[0])).canReport)
          await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, {from: restMembers[0]})

          assert.isTrue((await consensus.getMemberInfo(restMembers[1])).canReport)
          await consensus.submitReport(frame.refSlot, HASH_1, CONSENSUS_VERSION, {from: restMembers[1]})

          const variants = await consensus.getReportVariants()
          assert.sameOrderedMembers(variants.variants, [HASH_1])
          assert.sameOrderedMembers(toNum(variants.support), [5])
        })
      })

      frames.forEach(testFrame)
    })
  })
})
