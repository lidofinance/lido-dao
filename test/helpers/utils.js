const { BN } = require('bn.js')
const { isGeth } = require('@aragon/contract-helpers-test/src/node')
const { decodeErrorReasonFromTx } = require('@aragon/contract-helpers-test/src/decoding')
const { getEventAt } = require('@aragon/contract-helpers-test')

const pad = (hex, bytesLength, fill = '0') => {
  const absentZeroes = bytesLength * 2 + 2 - hex.length
  if (absentZeroes > 0) hex = '0x' + fill.repeat(absentZeroes) + hex.substr(2)
  return hex
}

const hexConcat = (first, ...rest) => {
  let result = first.startsWith('0x') ? first : '0x' + first
  rest.forEach((item) => {
    result += item.startsWith('0x') ? item.substr(2) : item
  })
  return result
}

function genKeys(cnt = 1) {
  let pubkeys = ''
  let sigkeys = ''

  for (let i = 1; i <= cnt; i++) {
    pubkeys = hexConcat(pubkeys, `0x`.padEnd(98, i.toString(16))) // 48 bytes * 2 chars + 2 chars (0x)
    sigkeys = hexConcat(sigkeys, `0x`.padEnd(194, i.toString(16))) // 96 bytes * 2 chars + 2 chars (0x)
  }

  return { pubkeys, sigkeys }
}

const hexSplit = (hexStr, lenBytes) => {
  const lenSymbols = lenBytes * 2
  hexStr = hexStr.replace(/^0x/, '')
  assert(hexStr.length % lenSymbols === 0, `data length must be a multiple of ${lenBytes} bytes`)
  const result = []
  const totalSegs = hexStr.length / lenSymbols
  for (let i = 0; i < totalSegs; ++i) {
    result.push('0x' + hexStr.substr(i * lenSymbols, lenSymbols))
  }
  return result
}

const toBN = (obj) => {
  if (BN.isBN(obj)) {
    return obj
  }
  if (obj === +obj) {
    return new BN(obj)
  }
  const str = obj + ''
  return str.startsWith('0x') ? new BN(str.substr(2), 16) : new BN(str, 10)
}

// Divides a BN by 1e15
const div15 = (bn) => bn.div(new BN(1000000)).div(new BN(1000000)).div(new BN(1000))

const ETH = (value) => web3.utils.toWei(value + '', 'ether')
const tokens = ETH
const shareRate = (value) => web3.utils.toWei(value + '', 'gether')

function formatWei(weiString) {
  return ethers.utils.formatEther(ethers.utils.parseUnits(weiString, 'wei'), { commify: true }) + ' ETH'
}

function formatBN(bn) {
  return formatWei(bn.toString())
}

async function getEthBalance(address) {
  return formatWei(await web3.eth.getBalance(address))
}

function formatStEth(bn) {
  return ethers.utils.formatEther(ethers.utils.parseUnits(bn.toString(), 'wei'), { commify: true }) + ' stETH'
}

// Copy paste from node_modules/@aragon/contract-helpers-test/src/asserts/assertThrow.js
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
      assert.notEqual(tx, undefined, `Expected error to include transaction hash, cannot assert revert reason ${expectedReason}: ${error}`)

      error.reason = decodeErrorReasonFromTx(tx, ctx)
      return error
    } else {
      const errorMatchesExpected = error.message.search(expectedErrorCode) > -1
      assert(errorMatchesExpected, `Expected error code "${expectedErrorCode}" but failed with "${error}" instead.`)
      return error
    }
  }
  // assert.fail() for some reason does not have its error string printed 🤷
  assert(false, `Expected "${expectedErrorCode}"${expectedReason ? ` (with reason: "${expectedReason}")` : ''} but it did not fail`)
}

async function assertRevertCustomError(blockOrPromise, expectedError, ctx) {
  const error = await assertThrows(blockOrPromise, 'revert', expectedError, ctx)

  if (!expectedError) {
    return
  }

  const expectedMessage = `VM Exception while processing transaction: reverted with custom error '${expectedError}()'`
  assert.equal(
    error.message,
    expectedMessage,
    `Expected revert with custom error "${expectedError}()" but failed with "${error.message}" instead.`
  )
}

const assertNoEvent = (receipt, eventName, msg) => {
  const event = getEventAt(receipt, eventName)
  assert.equal(event, undefined, msg)
}

const changeEndianness = (string) => {
  string = string.replace('0x', '')
  const result = []
  let len = string.length - 2
  while (len >= 0) {
    result.push(string.substr(len, 2))
    len -= 2
  }
  return '0x' + result.join('')
}

module.exports = {
  pad,
  hexConcat,
  hexSplit,
  toBN,
  div15,
  ETH,
  StETH: ETH,
  tokens,
  getEthBalance,
  formatWei,
  formatBN,
  formatStEth,
  assertRevertCustomError,
  assertNoEvent,
  changeEndianness,
  genKeys,
  shareRate
}
