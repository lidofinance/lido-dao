const { assert } = require('chai')
const { toChecksumAddress, isHexStrict } = require('web3-utils')

const { log } = require('./log')

assert.assert = assert

assert.bnEqual = (a, b, msg) => {
  assert.equal('' + a, '' + b, msg)
}

assert.addressEqual = (actual, expected, msg) => {
  assert.equal(toChecksumAddress(actual), toChecksumAddress(expected), msg)
}

assert.hexEqual = (actual, expected, msg) => {
  assert.isTrue(isHexStrict(actual), `Actual string ${actual} is not a valid hex string`)
  assert.isTrue(isHexStrict(expected), `Expected string ${expected} is not a valid hex string`)
  assert.equal(actual.toLowerCase(), expected.toLowerCase(), msg)
}

assert.log = (doAssert, ...args) => {
  doAssert(...args)
  log.success(args[args.length - 1])
}

module.exports = assert
