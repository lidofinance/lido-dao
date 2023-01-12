const chai = require('chai')
const { getEvents, isBn } = require('@aragon/contract-helpers-test')
const { assertRevert } = require('@aragon/contract-helpers-test/src/asserts')
const { toChecksumAddress } = require('ethereumjs-util')
const { isAddress } = require('ethers/lib/utils')

chai.util.addMethod(chai.assert, 'emits', function (receipt, eventName, args = {}, options = {}) {
  const event = getEvent(receipt, eventName, args, options.abi)
  this.isTrue(event !== undefined, `Event ${eventName} with args ${JSON.stringify(args)} wasn't found`)
})

chai.util.addMethod(chai.assert, 'notEmits', function (receipt, eventName, args = {}, options = {}) {
  const { abi } = options
  const event = getEvent(receipt, eventName, args, abi)
  this.isUndefined(event, `Expected that event "${eventName}" with args ${args}  wouldn't be emitted, but it was.`)
})

chai.util.addMethod(chai.assert, 'reverts', async function (receipt, reason) {
  await assertRevert(receipt, reason)
})

chai.util.addMethod(chai.assert, 'equals', function (actual, expected, errorMsg) {
  this.equal(actual.toString(), expected.toString(), `${errorMsg} expected ${expected.toString()} to equal ${actual.toString()}`)
})

chai.util.addMethod(chai.assert, 'notEquals', function (actual, expected, errorMsg) {
  this.notEqual(actual.toString(), expected.toString(), `${errorMsg} expected ${expected.toString()} to equal ${actual.toString()}`)
})

function getEvent(receipt, eventName, args, abi) {
  return getEvents(receipt, eventName, { decodeForAbi: abi }).find((e) =>
    // find the first index where every event argument matches the expected one
    Object.entries(args).every(
      ([argName, argValue]) => e.args[argName] !== undefined && normalizeArg(e.args[argName]) === normalizeArg(argValue)
    )
  )
}

function normalizeArg(arg) {
  if (isBn(arg) || Number.isFinite(arg)) {
    return arg.toString()
  } else if (isAddress(arg)) {
    return toChecksumAddress(arg)
  } else if (arg && arg.address) {
    // Web3.js or Truffle contract instance
    return toChecksumAddress(arg.address)
  }

  return arg
}

module.exports = { assert: chai.assert }
