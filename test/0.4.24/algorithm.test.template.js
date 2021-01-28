const { assert } = require('chai')
const { assertBn, assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { bn } = require('@aragon/contract-helpers-test')
const Algorithm = artifacts.require('AlgorithmMock.sol')

contract('Algorithm', ([testUser]) => {
  let algorithm

  before('deploy base app', async () => {
    algorithm = await Algorithm.new()
  })

  it('frequent function works', async () => {
    let r
    /** test cases */
  })
})
