// this is modified version of assertRevert from
// https://github.com/aragon/contract-helpers/blob/b24284687abb0855da0b0a089d21ee4ea83d9f49/packages/test-helpers/src/asserts/assertThrow.js
// that adds support for asserting custom errors
const { assert } = require('chai')
const { isGeth } = require('@aragon/contract-helpers-test/src/node')
const { decodeErrorReasonFromTx } = require('@aragon/contract-helpers-test/src/decoding')

const ERROR_PREFIX = 'Returned error:'
const THROW_PREFIX = 'VM Exception while processing transaction: revert'
const THROW_PREFIX_V2 = 'VM Exception while processing transaction: reverted with reason string'
const THROW_PREFIX_CUSTOM = 'VM Exception while processing transaction: reverted with custom error'

async function assertThrows(blockOrPromise, expectedErrorCode, expectedReason, ctx) {
  try {
    typeof blockOrPromise === 'function' ? await blockOrPromise() : await blockOrPromise
  } catch (error) {
    if (await isGeth(ctx)) {
      // With geth, we are only provided the transaction receipt and have to decode the failure
      // ourselves.
      const status = error.receipt.status

      assert.equal(status, '0x0', `Expected transaction to revert but it executed with status ${status}`)
      if (!expectedReason.length) {
        // Note that it is difficult to ascertain invalid jumps or out of gas scenarios
        // and so we simply pass if no revert message is given
        return
      }

      const { tx } = error
      assert.notEqual(
        tx,
        undefined,
        `Expected error to include transaction hash, cannot assert revert reason ${expectedReason}: ${error}`
      )

      error.reason = decodeErrorReasonFromTx(tx, ctx)
      return error
    } else {
      const errorMatchesExpected = error.message.search(expectedErrorCode) > -1
      assert(errorMatchesExpected, `Expected error code "${expectedErrorCode}" but failed with "${error}" instead.`)
      return error
    }
  }
  // assert.fail() for some reason does not have its error string printed 🤷
  assert(
    false,
    `Expected "${expectedErrorCode}"${expectedReason ? ` (with reason: "${expectedReason}")` : ''} but it did not fail`
  )
}

async function assertJump(blockOrPromise, ctx) {
  await assertThrows(blockOrPromise, 'invalid JUMP', ctx)
}

async function assertInvalidOpcode(blockOrPromise, ctx) {
  await assertThrows(blockOrPromise, 'invalid opcode', ctx)
}

async function assertOutOfGas(blockOrPromise, ctx) {
  await assertThrows(blockOrPromise, 'out of gas', ctx)
}

// version of @aragon/contract-helpers-test assertRevert, but with custom errors support
async function assertRevert(blockOrPromise, expectedReason, ctx) {
  const error = await assertThrows(blockOrPromise, 'revert', expectedReason, ctx)

  if (!expectedReason) {
    return
  }

  // Truffle v5 provides `error.reason`, but truffle v4 and buidler do not.
  if (!error.reason && error.message.includes(THROW_PREFIX)) {
    error.reason = error.message
      .replace(ERROR_PREFIX, '')
      .replace(THROW_PREFIX_CUSTOM, '')
      .replace(THROW_PREFIX_V2, '')
      .replace(THROW_PREFIX, '')
      .trim()
      .replace(/^'|'$/g, '')
  }

  // Truffle v5 sometimes adds an extra ' -- Reason given: reason.' to the error message 🤷
  error.reason = error.reason.replace(` -- Reason given: ${expectedReason}.`, '').trim()

  assert.equal(
    error.reason,
    expectedReason,
    `Expected revert reason "${expectedReason}" but failed with "${error.reason || 'no reason'}" instead.`
  )
}

module.exports = {
  assertJump,
  assertInvalidOpcode,
  assertOutOfGas,
  assertRevert,
}
