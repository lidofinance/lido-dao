const { contract, artifacts } = require('hardhat')
const { assert } = require('../../helpers/assert')
const { bn, ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

const HashConsensus = artifacts.require('HashConsensusTimeTravellable')
const MockReportProcessor = artifacts.require('MockReportProcessor')

const SLOTS_PER_EPOCH = 32
const SECONDS_PER_SLOT = 12
const GENESIS_TIME = 100
const EPOCHS_PER_FRAME = 225 // one day
const INITIAL_EPOCH = 1
const INITIAL_FAST_LANE_LENGTH_SLOTS = 0

const SECONDS_PER_EPOCH = SLOTS_PER_EPOCH * SECONDS_PER_SLOT
const SECONDS_PER_FRAME = SECONDS_PER_EPOCH * EPOCHS_PER_FRAME
const SLOTS_PER_FRAME = EPOCHS_PER_FRAME * SLOTS_PER_EPOCH

const computeSlotAt = (time) => Math.floor((time - GENESIS_TIME) / SECONDS_PER_SLOT)
const computeEpochAt = (time) => Math.floor(computeSlotAt(time) / SLOTS_PER_EPOCH)
const computeEpochFirstSlot = (epoch) => epoch * SLOTS_PER_EPOCH
const computeEpochFirstSlotAt = (time) => computeEpochFirstSlot(computeEpochAt(time))
const computeTimestampAtEpoch = (epoch) => GENESIS_TIME + epoch * SECONDS_PER_EPOCH
const computeTimestampAtSlot = (slot) => GENESIS_TIME + slot * SECONDS_PER_SLOT

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000'

const HASH_1 = '0x1111111111111111111111111111111111111111111111111111111111111111'
const HASH_2 = '0x2222222222222222222222222222222222222222222222222222222222222222'
const HASH_3 = '0x3333333333333333333333333333333333333333333333333333333333333333'
const HASH_4 = '0x4444444444444444444444444444444444444444444444444444444444444444'
const HASH_5 = '0x5555555555555555555555555555555555555555555555555555555555555555'

const UNREACHABLE_QUORUM = bn('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

const CONSENSUS_VERSION = 1

async function deployHashConsensus(
  admin,
  {
    reportProcessor = null,
    slotsPerEpoch = SLOTS_PER_EPOCH,
    secondsPerSlot = SECONDS_PER_SLOT,
    genesisTime = GENESIS_TIME,
    epochsPerFrame = EPOCHS_PER_FRAME,
    fastLaneLengthSlots = INITIAL_FAST_LANE_LENGTH_SLOTS,
    initialEpoch = INITIAL_EPOCH,
  } = {}
) {
  if (!reportProcessor) {
    reportProcessor = await MockReportProcessor.new(CONSENSUS_VERSION, { from: admin })
  }

  const consensus = await HashConsensus.new(
    slotsPerEpoch,
    secondsPerSlot,
    genesisTime,
    epochsPerFrame,
    fastLaneLengthSlots,
    admin,
    reportProcessor.address,
    { from: admin }
  )

  if (initialEpoch !== null) {
    await consensus.updateInitialEpoch(initialEpoch, { from: admin })
    await consensus.setTime(genesisTime + initialEpoch * slotsPerEpoch * secondsPerSlot)
  }

  await consensus.grantRole(await consensus.MANAGE_MEMBERS_AND_QUORUM_ROLE(), admin, { from: admin })
  await consensus.grantRole(await consensus.DISABLE_CONSENSUS_ROLE(), admin, { from: admin })
  await consensus.grantRole(await consensus.MANAGE_FRAME_CONFIG_ROLE(), admin, { from: admin })
  await consensus.grantRole(await consensus.MANAGE_FAST_LANE_CONFIG_ROLE(), admin, { from: admin })
  await consensus.grantRole(await consensus.MANAGE_REPORT_PROCESSOR_ROLE(), admin, { from: admin })

  return { reportProcessor, consensus }
}

module.exports = {
  INITIAL_FAST_LANE_LENGTH_SLOTS,
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
  deployHashConsensus,
}

contract('HashConsensus', ([admin, member1]) => {
  context('Deployment and initial configuration', () => {
    const INITIAL_EPOCH = 3
    let consensus

    it('deploying hash consensus', async () => {
      const deployed = await deployHashConsensus(admin, { initialEpoch: INITIAL_EPOCH })
      consensus = deployed.consensus
    })

    it('chain config is correct', async () => {
      const config = await consensus.getChainConfig()
      assert.equals(config.slotsPerEpoch, SLOTS_PER_EPOCH)
      assert.equals(config.secondsPerSlot, SECONDS_PER_SLOT)
      assert.equals(config.genesisTime, GENESIS_TIME)
    })

    it('frame config is correct', async () => {
      const config = await consensus.getFrameConfig()
      assert.equals(config.initialEpoch, INITIAL_EPOCH)
      assert.equals(config.epochsPerFrame, EPOCHS_PER_FRAME)
    })

    it('reverts if report processor address is zero', async () => {
      await assert.revertsWithCustomError(
        HashConsensus.new(
          SLOTS_PER_EPOCH,
          SECONDS_PER_SLOT,
          GENESIS_TIME,
          EPOCHS_PER_FRAME,
          INITIAL_FAST_LANE_LENGTH_SLOTS,
          admin,
          ZERO_ADDRESS,
          { from: admin }
        ),
        'ReportProcessorCannotBeZero()'
      )
    })

    it('reverts if admin address is zero', async () => {
      const reportProcessor = await MockReportProcessor.new(CONSENSUS_VERSION, { from: admin })
      await assert.revertsWithCustomError(
        HashConsensus.new(
          SLOTS_PER_EPOCH,
          SECONDS_PER_SLOT,
          GENESIS_TIME,
          EPOCHS_PER_FRAME,
          INITIAL_FAST_LANE_LENGTH_SLOTS,
          ZERO_ADDRESS,
          reportProcessor.address,
          { from: admin }
        ),
        'AdminCannotBeZero()'
      )
    })
  })
})
