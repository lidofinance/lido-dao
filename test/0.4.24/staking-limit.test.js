const { assert } = require('chai')
const { assertBn, assertRevert } = require('@aragon/contract-helpers-test/src/asserts')
const { bn, MAX_UINT256 } = require('@aragon/contract-helpers-test')
const { toBN } = require('../helpers/utils')
const { waitBlocks } = require('../helpers/blockchain')

const StakeLimitUtils = artifacts.require('StakeLimitUtilsMock.sol')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')

//
// We need to pack four variables into the same 256bit-wide storage slot
// to lower the costs per each staking request.
//
// As a result, slot's memory aligned as follows:
//
// MSB ------------------------------------------------------------------------------> LSB
// 256____________160_________________________128_______________32_____________________ 0
// |_______________|___________________________|________________|_______________________|
// | maxStakeLimit | maxStakeLimitGrowthBlocks | prevStakeLimit | prevStakeBlockNumber  |
// |<-- 96 bits -->|<---------- 32 bits ------>|<-- 96 bits --->|<----- 32 bits ------->|
//
//
// NB: Internal representation conventions:
//
// - the `maxStakeLimitGrowthBlocks` field above represented as follows:
// `maxStakeLimitGrowthBlocks` = `maxStakeLimit` / `stakeLimitIncreasePerBlock`
//           32 bits                 96 bits               96 bits
//
//
// - the "staking paused" state is encoded by `prevStakeBlockNumber` being zero,
// - the "staking unlimited" state is encoded by `maxStakeLimit` being zero and `prevStakeBlockNumber` being non-zero.
//

contract('StakingLimits', ([account1]) => {
  let limits

  before('deploy base app', async () => {
    limits = await StakeLimitUtils.new()
  })

  it('encode zeros', async () => {
    const slot = await limits.setStorageStakeLimitStruct(0, 0, 0, 0)
    assertBn(slot, 0)

    const decodedSlot = await limits.getStorageStakeLimit(slot)
    assertBn(decodedSlot.prevStakeBlockNumber, 0)
    assertBn(decodedSlot.prevStakeLimit, 0)
    assertBn(decodedSlot.maxStakeLimitGrowthBlocks, 0)
    assertBn(decodedSlot.maxStakeLimit, 0)
  })

  it('check staking pause at start', async () => {
    const slot = await limits.setStorageStakeLimitStruct(0, 0, 0, 0)
    const paused = await limits.isStakingPaused(slot)
    assert.equal(paused, true, 'staking not paused')
  })

  it('check staking pause with block number', async () => {
    const prevStakeBlockNumber = 10
    const slot2 = await limits.setStorageStakeLimitStruct(prevStakeBlockNumber, 0, 0, 0)
    const paused2 = await limits.isStakingPaused(slot2)
    assert.equal(paused2, false, 'staking paused')
  })

  it('check staking pause/unpause', async () => {
    let paused
    const slot = await limits.setStorageStakeLimitStruct(1, 1, 1, 1)
    paused = await limits.isStakingPaused(slot)
    assert.equal(paused, false, 'staking paused')

    const slot2 = await limits.setStakeLimitPauseState(slot, true)
    paused = await limits.isStakingPaused(slot2)
    assert.equal(paused, true, 'staking not paused')

    const slot3 = await limits.setStakeLimitPauseState(slot, false)
    paused = await limits.isStakingPaused(slot3)
    assert.equal(paused, false, 'staking paused')
  })

  it('check staking rate limit', async () => {
    let limited
    const slot = await limits.setStorageStakeLimitStruct(0, 0, 0, 0)
    limited = await limits.isStakingLimitSet(slot)

    assert.equal(limited, false, 'limits are limited')

    const maxStakeLimit = 10
    const slot2 = await limits.setStorageStakeLimitStruct(0, 0, 0, maxStakeLimit)
    limited = await limits.isStakingLimitSet(slot2)
    assert.equal(limited, true, 'limits are not limited')

    const slot3 = await limits.removeStakingLimit(slot2)
    limited = await limits.isStakingLimitSet(slot3)
    assert.equal(limited, false, 'limits are limited')
  })

  it('stake limit increase > max stake', async () => {
    let maxStakeLimit = 5
    let maxStakeLimitIncreasePerBlock = 0
    const slot = await limits.setStorageStakeLimitStruct(0, 0, 0, 0)
    await limits.setStakingLimit(slot, maxStakeLimit, maxStakeLimitIncreasePerBlock)

    maxStakeLimit = 5
    maxStakeLimitIncreasePerBlock = 5
    await limits.setStakingLimit(slot, maxStakeLimit, maxStakeLimitIncreasePerBlock)

    maxStakeLimit = 5
    maxStakeLimitGrowthBlocks = 6
    assertRevert(limits.setStakingLimit(slot, maxStakeLimit, maxStakeLimitGrowthBlocks), 'TOO_LARGE_LIMIT_INCREASE')
  })

  it('stake limit reverts on large values', async () => {
    let maxStakeLimit = toBN(2).pow(toBN(96))
    let maxStakeLimitIncreasePerBlock = 1
    const slot = await limits.setStorageStakeLimitStruct(0, 0, 0, 0)
    assertRevert(limits.setStakingLimit(slot, maxStakeLimit, maxStakeLimitIncreasePerBlock), 'TOO_LARGE_MAX_STAKE_LIMIT')

    maxStakeLimit = toBN(2).mul(toBN(10).pow(toBN(18)))
    maxStakeLimitIncreasePerBlock = toBN(10)
    assertRevert(limits.setStakingLimit(slot, maxStakeLimit, maxStakeLimitIncreasePerBlock), `TOO_SMALL_LIMIT_INCREASE`)
  })

  it('check update calculate stake limit with different blocks', async () => {
    const block = await web3.eth.getBlock('latest')

    const maxStakeLimit = 100
    const increasePerBlock = 50
    const maxStakeLimitGrowthBlocks = maxStakeLimit / increasePerBlock

    const slot = await limits.setStorageStakeLimitStruct(block.number, 0, maxStakeLimitGrowthBlocks, maxStakeLimit)

    const currentStakeLimit2 = await limits.calculateCurrentStakeLimit(slot)
    assertBn(currentStakeLimit2, 0)

    const block2 = await waitBlocks(1)
    assert.equal(block2.number, block.number + 1)
    const currentStakeLimit3 = await limits.calculateCurrentStakeLimit(slot)
    assertBn(currentStakeLimit3, 50)

    const block3 = await waitBlocks(3)
    assert.equal(block3.number, block.number + 1 + 3)
    const currentStakeLimit4 = await limits.calculateCurrentStakeLimit(slot)
    assertBn(currentStakeLimit4, 100)
  })

  it('check update stake limit', async () => {
    const block = await web3.eth.getBlock('latest')

    const maxStakeLimit = 100
    const increasePerBlock = 50
    const maxStakeLimitGrowthBlocks = maxStakeLimit / increasePerBlock

    const slot = await limits.setStorageStakeLimitStruct(block.number, 0, maxStakeLimitGrowthBlocks, maxStakeLimit)
    const decodedSlot = await limits.getStorageStakeLimit(slot)
    assert.equal(decodedSlot.prevStakeBlockNumber, block.number)
    assert.equal(decodedSlot.prevStakeLimit, 0)

    const block2 = await waitBlocks(3)
    assert.equal(block2.number, block.number + 3)

    const currentStakeLimit2 = await limits.calculateCurrentStakeLimit(slot)
    assertBn(currentStakeLimit2, maxStakeLimit)

    const deposit = 87
    const newSlot = await limits.updatePrevStakeLimit(slot, currentStakeLimit2 - deposit)
    const decodedNewSlot = await limits.getStorageStakeLimit(newSlot)
    assert.equal(decodedNewSlot.prevStakeBlockNumber, block2.number)
    assert.equal(decodedNewSlot.prevStakeLimit, 13)

    // checking staking recovery
    await waitBlocks(1)
    const currentStakeLimit3 = await limits.calculateCurrentStakeLimit(newSlot)
    assertBn(currentStakeLimit3, 13 + increasePerBlock)

    await waitBlocks(1)
    const currentStakeLimit4 = await limits.calculateCurrentStakeLimit(newSlot)
    assertBn(currentStakeLimit4, maxStakeLimit)
  })

  it('max values', async () => {
    const block = await web3.eth.getBlock('latest')

    const max32 = toBN(2).pow(toBN(32)).sub(toBN(1)) // uint32
    const max96 = toBN(2).pow(toBN(96)).sub(toBN(1)) // uint96

    const maxStakeLimit = max96 // uint96
    const maxStakeLimitGrowthBlocks = max32
    const maxPrevStakeLimit = max96 // uint96
    const maxBlock = max32 // uint32

    // check that we CAN set max value

    const maxSlot = await limits.setStorageStakeLimitStruct(maxBlock, maxPrevStakeLimit, maxStakeLimitGrowthBlocks, maxStakeLimit)
    const maxUint256 = toBN(2).pow(toBN(256)).sub(toBN(1))
    assertBn(maxSlot, maxUint256)

    const decodedRaw = await limits.getStorageStakeLimit(maxSlot)

    const decodedMaxLimit = decodedRaw.maxStakeLimit
    const decodedMaxStakeLimitGrowthBlocks = decodedRaw.maxStakeLimitGrowthBlocks
    const decodedPrevStakeLimit = decodedRaw.prevStakeLimit
    const decodedPrevStakeBlockNumber = decodedRaw.prevStakeBlockNumber

    assertBn(decodedMaxLimit, max96)
    assertBn(decodedMaxStakeLimitGrowthBlocks, max32)
    assertBn(decodedPrevStakeLimit, max96)
    assertBn(decodedPrevStakeBlockNumber, max32)
  })
})
