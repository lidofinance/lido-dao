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
// LSB ------------------------------------------------------------------------------> MSB
// 0______________________32______________128_________________________160______________256
// |______________________|________________|___________________________|________________|
// | prevStakeBlockNumber | prevStakeLimit | maxStakeLimitGrowthBlocks | maxStakeLimit  |
// |<----- 32 bits ------>|<-- 96 bits --->|<---------- 32 bits ------>|<--- 96 bits -->|
//
//
// NB: we represent `maxStakeLimitGrowthBlocks` as follows:
// `maxStakeLimitGrowthBlocks` = `maxStakeLimit` / `stakeLimitIncreasePerBlock`
//           32 bits                 96 bits               96 bits
//

contract.skip('StakingLimits', () => {
  let limits

  before('deploy base app', async () => {
    limits = await StakeLimitUtils.new()
  })

  it('encode zeros', async () => {
    const slot = await limits.encodeStakeLimitSlot(0, 0, 0, 0)
    assertBn(slot, 0)

    const decodedSlot = await limits.decodeStakeLimitSlot(slot)
    assertBn(decodedSlot.maxStakeLimit, 0)
    assertBn(decodedSlot.stakeLimitIncPerBlock, 0)
    assertBn(decodedSlot.prevStakeLimit, 0)
    assertBn(decodedSlot.prevStakeBlockNumber, 0)
  })

  it('check 0 slot', async () => {
    const slot = 0
    assertBn(slot, 0)

    const decodedSlot = await limits.decodeStakeLimitSlot(slot)
    assertBn(decodedSlot.maxStakeLimit, 0)
    assertBn(decodedSlot.stakeLimitIncPerBlock, 0)
    assertBn(decodedSlot.prevStakeLimit, 0)
    assertBn(decodedSlot.prevStakeBlockNumber, 0)
  })

  it('check staking pause', async () => {
    const slot = 0
    const paused = await limits.isStakingPaused(slot)
    assert.equal(paused, true, 'limits not paused')

    const maxStakeLimit = 10
    const slot2 = await limits.encodeStakeLimitSlot(maxStakeLimit, 0, 0, 0)
    const paused2 = await limits.isStakingPaused(slot2)
    assert.equal(paused2, false, 'limits not limited')
  })

  it('check staking rate limit', async () => {
    const slot = 0
    const limited = await limits.isStakingRateLimited(slot)

    assert.equal(limited, false, 'limits not limited')

    const maxStakeLimit = 10
    const slot2 = await limits.encodeStakeLimitSlot(maxStakeLimit, 0, 0, 0)
    const limited2 = await limits.isStakingRateLimited(slot2)

    assert.equal(limited2, true, 'limits not limited')
  })

  it('stake limit increase > max stake', async () => {
    await limits.encodeStakeLimitSlot(5, 0, 0, 0)
    await limits.encodeStakeLimitSlot(5, 5, 0, 0)

    assertRevert(limits.encodeStakeLimitSlot(5, 6, 0, 0), `TOO_LARGE_LIMIT_INCREASE`)
  })

  it('stake limit reverts on large values', async () => {
    assertRevert(limits.encodeStakeLimitSlot(toBN(2).pow(toBN(96)), 1, 1, 1), `TOO_LARGE_MAX_STAKE_LIMIT`)
    assertRevert(limits.encodeStakeLimitSlot(1, 1, toBN(2).pow(toBN(96), 1), 1), `TOO_LARGE_PREV_STAKE_LIMIT`)
    assertRevert(limits.encodeStakeLimitSlot(1, 1, 1, toBN(2).pow(toBN(32), 1)), `TOO_LARGE_BLOCK_NUMBER`)
  })

  it('check update calculate stake limit with different blocks', async () => {
    const block = await web3.eth.getBlock('latest')

    const slot = await limits.encodeStakeLimitSlot(100, 50, 0, block.number)

    const currentStakeLimit = await limits.calculateCurrentStakeLimit(slot)
    assertBn(currentStakeLimit, 0)

    const block2 = await waitBlocks(1)
    assert.equal(block2.number, block.number + 1)
    const currentStakeLimit2 = await limits.calculateCurrentStakeLimit(slot)
    assertBn(currentStakeLimit2, 50)

    const block3 = await waitBlocks(3)
    assert.equal(block3.number, block.number + 1 + 3)
    const currentStakeLimit3 = await limits.calculateCurrentStakeLimit(slot)
    assertBn(currentStakeLimit3, 100)
  })

  it('check update stake limit', async () => {
    const maxLimit = 100
    const incPerBlock = 50
    const block = await web3.eth.getBlock('latest')

    const slot = await limits.encodeStakeLimitSlot(maxLimit, incPerBlock, 0, block.number)
    const decodedSlot = await limits.decodeStakeLimitSlot(slot)
    assert.equal(decodedSlot.prevStakeBlockNumber, block.number)
    assert.equal(decodedSlot.prevStakeLimit, 0)

    const block2 = await waitBlocks(3)
    assert.equal(block2.number, block.number + 3)

    const currentStakeLimit2 = await limits.calculateCurrentStakeLimit(slot)
    assertBn(currentStakeLimit2, maxLimit)

    const deposit = 87
    const newSlot = await limits.updatePrevStakeLimit(slot, currentStakeLimit2 - deposit)
    const decodedNewSlot = await limits.decodeStakeLimitSlot(newSlot)
    assert.equal(decodedNewSlot.prevStakeBlockNumber, block2.number)
    assert.equal(decodedNewSlot.prevStakeLimit, 13)

    // checking staking recovery
    await waitBlocks(1)
    const currentStakeLimit3 = await limits.calculateCurrentStakeLimit(newSlot)
    assertBn(currentStakeLimit3, 13 + incPerBlock)

    await waitBlocks(1)
    const currentStakeLimit4 = await limits.calculateCurrentStakeLimit(newSlot)
    assertBn(currentStakeLimit4, maxLimit)
  })

  it('max values', async () => {
    const block = await web3.eth.getBlock('latest')
    const maxLimit = toBN(2).pow(toBN(96)).sub(toBN(1)) // uint96
    let minIncPerBlock = 1 // uint96
    const maxPrevStakeLimit = toBN(2).pow(toBN(96)).sub(toBN(1)) // uint96
    const maxBlock = toBN(2).pow(toBN(32)).sub(toBN(1)) // uint32

    assertRevert(limits.encodeStakeLimitSlot(maxLimit, minIncPerBlock, maxPrevStakeLimit, maxBlock), `TOO_SMALL_LIMIT_INCREASE`)

    minIncPerBlock = maxLimit.div(toBN(2).pow(toBN(32)).sub(toBN(1)))

    minIncPerBlockForRevert = minIncPerBlock.div(toBN(2)) // reverts
    assertRevert(limits.encodeStakeLimitSlot(maxLimit, minIncPerBlockForRevert, maxPrevStakeLimit, maxBlock), `TOO_SMALL_LIMIT_INCREASE`)

    const maxSlot = await limits.encodeStakeLimitSlot(maxLimit, minIncPerBlock, maxPrevStakeLimit, maxBlock)
    const maxUint256 = toBN(2).pow(toBN(256)).sub(toBN(1))
    assertBn(maxSlot, maxUint256)

    const decodedRaw = await limits.decodeStakeLimitSlot(maxSlot)

    // console.log(decodedRaw)

    const maxStakeLimit = decodedRaw.maxStakeLimit
    const stakeLimitIncPerBlock = decodedRaw.stakeLimitIncPerBlock
    const prevStakeLimit = decodedRaw.prevStakeLimit
    const prevStakeBlockNumber = decodedRaw.prevStakeBlockNumber

    const growthBlock = maxSlot.shrn(128)
    // console.log(maxSlot.toString(2))
    console.log({
      stakeLimitIncPerBlock: stakeLimitIncPerBlock.toString(),
      maxBlock: maxBlock.toString(),
      maxStakeLimit: maxStakeLimit.toString(),
      growthBlock: growthBlock.toTwos(32).toString(2)
    })

    assertBn(maxStakeLimit, maxLimit)
    assertBn(stakeLimitIncPerBlock, minIncPerBlock)
    assertBn(prevStakeLimit, maxPrevStakeLimit)
    assertBn(prevStakeBlockNumber, maxBlock)
  })
})

function pad32(num) {
  return pz(num, 32)
}

function pad96(num) {
  return pz(num, 96)
}

function pad256(num) {
  return pz(num, 256)
}

function pz(num, size) {
  var s = num + ''
  while (s.length < size) s = '0' + s
  return s
}
