const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { assertRevert } = require('../helpers/assertThrow')

const { toBN } = require('../helpers/utils')
const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')


contract('LidoOracle', ([admin, stranger]) => {
  it.skip('TODO: legacy compat tests', async () => {})
})
