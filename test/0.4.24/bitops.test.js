const { assert } = require('chai')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { bn } = require('@aragon/contract-helpers-test')

const BitOps = artifacts.require('BitOpsMock.sol')

contract('BitOps', ([testUser]) => {
  let bitops

  before('deploy base app', async () => {
    bitops = await BitOps.new()
  })

  it('getBit', async () => {
    assert(await bitops.getBit(0b101, 0, { from: testUser }))
    assert((await bitops.getBit(0b101, 1, { from: testUser })) === false)
    assert(await bitops.getBit(0b101, 2, { from: testUser }))
  })

  it('setBit', async () => {
    assertBn(bn(1), await bitops.setBit(0, 0, true, { from: testUser }))
    assertBn(bn(0), await bitops.setBit(1, 0, false, { from: testUser }))
    assertBn(bn(65), await bitops.setBit(1, 6, true, { from: testUser }))
  })

  it('popcnt', async () => {
    assertBn(bn(0), await bitops.popcnt(0, { from: testUser }))
    assertBn(bn(1), await bitops.popcnt(1, { from: testUser }))
    assertBn(bn(2), await bitops.popcnt(3, { from: testUser }))
    assertBn(bn(6), await bitops.popcnt(63, { from: testUser }))
    assertBn(bn(9), await bitops.popcnt(0b10101010101010101, { from: testUser }))
  })
})
