const { assert } = require('chai')
const { assertBn, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { assertRevert } = require('../../helpers/assertThrow')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const HashConsensus = artifacts.require('HashConsensusTimeTravellable')
const MockReportProcessor = artifacts.require('MockReportProcessor')

const SLOTS_PER_EPOCH = 32
const SECONDS_PER_SLOT = 12
const GENESIS_TIME = 100
const EPOCHS_PER_FRAME = 225 // one day

const SECONDS_PER_EPOCH = SLOTS_PER_EPOCH * SECONDS_PER_SLOT
const SECONDS_PER_FRAME = SECONDS_PER_EPOCH * EPOCHS_PER_FRAME
const SLOTS_PER_FRAME = EPOCHS_PER_FRAME * SLOTS_PER_EPOCH

const computeSlotAt = time => Math.floor((time - GENESIS_TIME) / SECONDS_PER_SLOT)
const computeEpochAt = time => Math.floor(computeSlotAt(time) / SLOTS_PER_EPOCH)
const computeEpochFirstSlot = epoch => epoch * SLOTS_PER_EPOCH
const computeEpochFirstSlotAt = time => computeEpochFirstSlot(computeEpochAt(time))
const computeTimestampAtEpoch = epoch => GENESIS_TIME + epoch * SECONDS_PER_EPOCH
const computeTimestampAtSlot = slot => GENESIS_TIME + slot * SECONDS_PER_SLOT

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000'

const HASH_1 = '0x1111111111111111111111111111111111111111111111111111111111111111'
const HASH_2 = '0x2222222222222222222222222222222222222222222222222222222222222222'
const HASH_3 = '0x3333333333333333333333333333333333333333333333333333333333333333'
const HASH_4 = '0x4444444444444444444444444444444444444444444444444444444444444444'
const HASH_5 = '0x5555555555555555555555555555555555555555555555555555555555555555'

const CONSENSUS_VERSION = 1

async function deployHashConsensus(admin) {
  const reportProcessor = await MockReportProcessor.new(CONSENSUS_VERSION, { from: admin })

  const consensus = await HashConsensus.new(
    SLOTS_PER_EPOCH,
    SECONDS_PER_SLOT,
    GENESIS_TIME,
    EPOCHS_PER_FRAME,
    admin,
    reportProcessor.address,
    { from: admin }
  )

  await consensus.grantRole(await consensus.MANAGE_MEMBERS_AND_QUORUM_ROLE(), admin, { from: admin })
  await consensus.grantRole(await consensus.DISABLE_CONSENSUS_ROLE(), admin, { from: admin })
  await consensus.grantRole(await consensus.MANAGE_INTERVAL_ROLE(), admin, { from: admin })
  await consensus.grantRole(await consensus.MANAGE_REPORT_PROCESSOR_ROLE(), admin, { from: admin })

  return { reportProcessor, consensus }
}

module.exports = {
  SLOTS_PER_EPOCH, SECONDS_PER_SLOT, GENESIS_TIME, EPOCHS_PER_FRAME,
  SECONDS_PER_EPOCH, SECONDS_PER_FRAME, SLOTS_PER_FRAME,
  computeSlotAt, computeEpochAt, computeEpochFirstSlot, computeEpochFirstSlotAt,
  computeTimestampAtSlot, computeTimestampAtEpoch,
  ZERO_HASH, HASH_1, HASH_2, HASH_3, HASH_4, HASH_5,
  CONSENSUS_VERSION,
  deployHashConsensus
}

contract('HashConsensus', ([admin]) => {
  context('Deployment and initial configuration', () => {
    let consensus
    let reportProcessor

    it('deploying hash consensus', async () => {
      const deployed = await deployHashConsensus(admin)
      consensus = deployed.consensus
      reportProcessor = deployed.reportProcessor
    })

    it('chain config is correct', async () => {
      const config = await consensus.getChainConfig()
      assert.equal(+config.slotsPerEpoch, SLOTS_PER_EPOCH)
      assert.equal(+config.secondsPerSlot, SECONDS_PER_SLOT)
      assert.equal(+config.genesisTime, GENESIS_TIME)
    })

    it('frame config is correct', async () => {
      const config = await consensus.getFrameConfig()
      const time = +await consensus.getTime()
      const expectedInitialEpoch = computeEpochAt(time)
      assert.equal(+config.initialEpoch, expectedInitialEpoch)
      assert.equal(+config.epochsPerFrame, EPOCHS_PER_FRAME)
    })
  })
})