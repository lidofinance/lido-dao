const { assert } = require('chai')
const { toChecksumAddress } = require('web3-utils')

const { log } = require('./log')

assert.assert = assert

assert.bnEqual = (a, b, msg) => {
  assert.equal('' + a, '' + b, msg)
}

assert.addressEqual = (actual, expected, msg) => {
  assert.equal(toChecksumAddress(actual), toChecksumAddress(expected), msg)
}

assert.log = (doAssert, ...args) => {
  doAssert(...args)
  log.success(args[args.length - 1])
}

module.exports = assert
