const chai = require('chai')
const { getEvents, isBn } = require('@aragon/contract-helpers-test')
const { assertRevert } = require('./assertThrow')
const { toChecksumAddress } = require('ethereumjs-util')
const { isAddress } = require('ethers/lib/utils')

chai.util.addMethod(chai.assert, 'emits', function (receipt, eventName, args = {}, options = {}) {
  const event = getEvent(receipt, eventName, args, options.abi)
  this.isTrue(event !== undefined, `Event ${eventName} with args ${JSON.stringify(args)} wasn't found`)
})

chai.util.addMethod(
  chai.assert, 'emitsNumberOfEvents', function (receipt, eventName, numberOfEvents = {}, options = {}
) {
  const events = getEvents(receipt, eventName, options.abi)
  this.equal(
    events.length,
    numberOfEvents,
    `${eventName}: ${numberOfEvents} events expected, but found ${events.length}`
  )
})

chai.util.addMethod(
  chai.assert, 'revertsOZAccessControl', async function (receipt, address, role) {
    try {
      await receipt
    } catch (error) {
      const msg = error.message.toUpperCase()
      const reason = `AccessControl: account ${web3.utils.toChecksumAddress(address)} is missing role ${web3.utils.keccak256(role)}`

      chai.expect(msg).to.equal(`VM Exception while processing transaction: reverted with reason string '${reason}'`.toUpperCase())
      return
    }
    throw new Error(
      `Transaction has been executed without revert. Expected access control error for ${address} without role: ${role}`
    )
  }
)

chai.util.addMethod(chai.assert, 'notEmits', function (receipt, eventName, args = {}, options = {}) {
  const { abi } = options
  const event = getEvent(receipt, eventName, args, abi)
  this.isUndefined(event, `Expected that event "${eventName}" with args ${args}  wouldn't be emitted, but it was.`)
})

chai.util.addMethod(chai.assert, 'reverts', async function (receipt, reason) {
  await assertRevert(receipt, reason)
})

chai.util.addMethod(chai.assert, 'equals', function (actual, expected, errorMsg) {
  this.equal(actual.toString(), expected.toString())
})

chai.util.addMethod(chai.assert, 'notEquals', function (actual, expected, errorMsg) {
  this.notEqual(actual.toString(), expected.toString(), `${errorMsg || ""} expected ${expected.toString()} to not equal ${actual.toString()}`)
})

chai.util.addMethod(chai.assert, 'revertsWithCustomError', async function (receipt, reason) {
  try {
    await receipt
  } catch (error) {
    chai.expect(error.message).to.equal(`VM Exception while processing transaction: reverted with custom error '${reason}'`)
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
