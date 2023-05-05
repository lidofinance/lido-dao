const chai = require('chai')
const { web3 } = require('hardhat')
const { getEvents, isBn } = require('@aragon/contract-helpers-test')
const { assertRevert } = require('./assertThrow')
const { toChecksumAddress } = require('ethereumjs-util')
const { isAddress } = require('ethers/lib/utils')
const { toBN } = require('./utils')

chai.util.addMethod(chai.assert, 'emits', function (receipt, eventName, args = undefined, options = {}) {
  const events = getEvents(receipt, eventName, { decodeForAbi: options.abi })
  chai.assert(events.length !== 0, () => `Expected event '${eventName}' wasn't emitted`)
  if (args !== undefined) {
    chai.assert(
      findEventWithArgs(args, events) !== undefined,
      () => `No '${eventName}' event was emitted with expected args ${stringify(args)}`
    )
  }
})

chai.util.addMethod(chai.assert, 'emitsAt', function (receipt, eventName, index, args = {}, options = {}) {
  const event = getEventAt(receipt, eventName, index, args, options.abi)
  chai.assert(
    event !== undefined,
    () => `Event '${eventName}' at index ${index} with args ${stringify(args)} wasn't found`
  )
})

chai.util.addMethod(
  chai.assert,
  'emitsNumberOfEvents',
  function (receipt, eventName, numberOfEvents = {}, options = {}) {
    const events = getEvents(receipt, eventName, options.abi)
    this.equal(
      events.length,
      numberOfEvents,
      `${eventName}: ${numberOfEvents} events expected, but found ${events.length}`
    )
  }
)

chai.util.addMethod(chai.assert, 'revertsOZAccessControl', async function (receipt, address, role) {
  try {
    await receipt
  } catch (error) {
    const msg = error.message.toUpperCase()
    const reason = `AccessControl: account ${web3.utils.toChecksumAddress(
      address
    )} is missing role ${web3.utils.keccak256(role)}`

    chai
      .expect(msg)
      .to.equal(`VM Exception while processing transaction: reverted with reason string '${reason}'`.toUpperCase())
    return
  }
  throw new Error(
    `Transaction has been executed without revert. Expected access control error for ${address} without role: ${role}`
  )
})

chai.util.addMethod(chai.assert, 'notEmits', function (receipt, eventName, args = {}, options = {}) {
  const { abi } = options
  const event = getEvent(receipt, eventName, args, abi)
  this.isUndefined(event, `Expected that event "${eventName}" with args ${args}  wouldn't be emitted, but it was.`)
})

chai.util.addMethod(chai.assert, 'reverts', async function (receipt, reason, customErrorArgs) {
  await assertRevert(receipt, customErrorArgs !== undefined ? `${reason}(${customErrorArgs.join(', ')})` : reason)
})

chai.util.addMethod(chai.assert, 'equals', function (actual, expected, errorMsg) {
  this.equal(actual.toString(), expected.toString(), errorMsg)
})

chai.util.addMethod(chai.assert, 'equalsDelta', function (actual, expected, delta, errorMsg) {
  this.isClose(actual, expected, delta, errorMsg)
})

const msg = (errorMsg, str) => `${errorMsg ? `${errorMsg}: ` : ''}${str}`

chai.util.addMethod(chai.assert, 'isClose', function (actual, expected, delta, errorMsg) {
  const diff = toBN(actual).sub(toBN(expected)).abs()
  chai.assert(
    diff.lte(toBN(delta)),
    () => msg(errorMsg, `Expected ${actual} to be close to ${expected} with max diff ${delta}, actual diff ${diff}`),
    () => msg(errorMsg, `Expected ${actual} not to be close to ${expected} with min diff ${delta}, actual diff ${diff}`)
  )
})

chai.util.addMethod(chai.assert, 'bnAbove', function (nAbove, nBelow, errorMsg) {
  chai.assert(
    toBN(nAbove).gt(toBN(nBelow)),
    () => msg(errorMsg, `Expected ${nAbove} to be above ${nBelow}`),
    () => msg(errorMsg, `Expected ${nAbove} not to be above ${nBelow}`)
  )
})

chai.util.addMethod(chai.assert, 'notEquals', function (actual, expected, errorMsg) {
  this.notEqual(
    actual.toString(),
    expected.toString(),
    `${errorMsg || ''} expected ${expected.toString()} to not equal ${actual.toString()}`
  )
})

chai.util.addMethod(chai.assert, 'addressEqual', function (actual, expected, errorMsg) {
  chai.assert.equal(toChecksumAddress(actual), toChecksumAddress(expected), errorMsg)
})

chai.util.addMethod(chai.assert, 'revertsWithCustomError', async function (receipt, reason) {
  try {
    await receipt
  } catch (error) {
    chai
      .expect(error.message)
      .to.equal(`VM Exception while processing transaction: reverted with custom error '${reason}'`)
    return
  }
  throw new Error(`Transaction has been executed without revert. Expected revert reason ${reason}`)
})

chai.util.addMethod(chai.assert, 'almostEqual', function (actual, expected, epsilon) {
  actual = BigInt(actual.toString())
  expected = BigInt(expected.toString())
  epsilon = BigInt(epsilon.toString())
  if (actual > expected) {
    this.isTrue(
      actual - expected <= epsilon,
      `Expected |${actual} - ${expected}| <= ${epsilon}. Actually ${actual - expected} > ${epsilon}`
    )
  } else {
    this.isTrue(
      expected - actual <= epsilon,
      `Expected |${expected} - ${actual}| <= ${epsilon}. Actually ${expected - actual} > ${epsilon}`
    )
  }
})

function getEventAt(receipt, eventName, index, args, abi) {
  const e = getEvents(receipt, eventName, { decodeForAbi: abi })[index]

  if (
    Object.entries(args).every(
      ([argName, argValue]) => e.args[argName] !== undefined && normalizeArg(e.args[argName]) === normalizeArg(argValue)
    )
  )
    return e
  else return undefined
}

function getEvent(receipt, eventName, args, abi) {
  const events = getEvents(receipt, eventName, { decodeForAbi: abi })
  return findEventWithArgs(args, events)
}

function findEventWithArgs(args, events) {
  // find the first index where every event argument matches the expected one
  return events.find((e) =>
    Object.entries(args).every(
      ([argName, argValue]) => e.args[argName] !== undefined && normalizeArg(e.args[argName]) === normalizeArg(argValue)
    )
  )
}

function normalizeArg(arg) {
  if (isBn(arg) || Number.isFinite(arg) || typeof arg === 'bigint') {
    return arg.toString()
  } else if (isAddress(arg)) {
    return toChecksumAddress(arg)
  } else if (arg && arg.address) {
    // Web3.js or Truffle contract instance
    return toChecksumAddress(arg.address)
  }

  return arg
}

function stringify(obj) {
  // Helps overcome the problem with BigInt serialization. Details: https://github.com/GoogleChromeLabs/jsbi/issues/30
  return JSON.stringify(obj, (_, value) => (typeof value === 'bigint' ? value.toString() : value))
}

module.exports = { assert: chai.assert }
