const { contract, artifacts } = require('hardhat')
const { bn } = require('@aragon/contract-helpers-test')
const { assert } = require('../../helpers/assert')

const BaseOracle = artifacts.require('BaseOracleTimeTravellable')
const MockConsensusContract = artifacts.require('MockConsensusContract')

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
const computeDeadlineFromRefSlot = (slot) => computeTimestampAtSlot(+slot + SLOTS_PER_FRAME)
const computeNextRefSlotFromRefSlot = (slot) => +slot + SLOTS_PER_FRAME

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000'

const HASH_1 = '0x1111111111111111111111111111111111111111111111111111111111111111'
const HASH_2 = '0x2222222222222222222222222222222222222222222222222222222222222222'
const HASH_3 = '0x3333333333333333333333333333333333333333333333333333333333333333'
const HASH_4 = '0x4444444444444444444444444444444444444444444444444444444444444444'
const HASH_5 = '0x5555555555555555555555555555555555555555555555555555555555555555'

const UNREACHABLE_QUORUM = bn('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

const CONSENSUS_VERSION = 1

async function deployBaseOracle(
  admin,
  {
    secondsPerSlot = SECONDS_PER_SLOT,
    genesisTime = GENESIS_TIME,
    slotsPerEpoch = SLOTS_PER_EPOCH,
    consensusContract = null,
    epochsPerFrame = EPOCHS_PER_FRAME,
    fastLaneLengthSlots = INITIAL_FAST_LANE_LENGTH_SLOTS,
    initialEpoch = INITIAL_EPOCH,
    mockMember = admin,
  } = {}
) {
  if (!consensusContract) {
    consensusContract = await MockConsensusContract.new(
      slotsPerEpoch,
      secondsPerSlot,
      genesisTime,
      epochsPerFrame,
      initialEpoch,
      fastLaneLengthSlots,
      mockMember,
      { from: admin }
    )
  }

  const oracle = await BaseOracle.new(secondsPerSlot, genesisTime, admin, { from: admin })

  await oracle.initialize(consensusContract.address, CONSENSUS_VERSION, 0)

  await consensusContract.setAsyncProcessor(oracle.address)

  return { oracle, consensusContract }
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
  computeNextRefSlotFromRefSlot,
  computeDeadlineFromRefSlot,
  ZERO_HASH,
  HASH_1,
  HASH_2,
  HASH_3,
  HASH_4,
  HASH_5,
  CONSENSUS_VERSION,
  UNREACHABLE_QUORUM,
  deployBaseOracle,
}

contract('BaseOracle', ([admin]) => {
  context('Deployment and initial configuration', () => {
    it('deploying base oracle ', async () => {
      await deployBaseOracle(admin)
    })

    it('reverts when slotsPerSecond is zero', async () => {
      await assert.reverts(deployBaseOracle(admin, { secondsPerSlot: 0 }), 'SecondsPerSlotCannotBeZero()')
    })

    // TODO: add more base tests
  })
})
