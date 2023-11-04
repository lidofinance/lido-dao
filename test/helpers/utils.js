const { web3 } = require('hardhat')
const assert = require('node:assert')
const chai = require('chai')
const { BN } = require('bn.js')
const { getEvents } = require('@aragon/contract-helpers-test')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000'

const pad = (hex, bytesLength, fill = '0') => {
  const absentZeroes = bytesLength * 2 + 2 - hex.length
  if (absentZeroes > 0) hex = '0x' + fill.repeat(absentZeroes) + hex.substr(2)
  return hex
}

const padRight = (hex, length, fill = '0') => {
  const strippedHex = hex.replace('0x', '')
  const absentZeroes = length * 2 - strippedHex.length
  if (absentZeroes > 0) hex = '0x' + strippedHex + fill.repeat(absentZeroes)
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
  return str.startsWith('0x') ? new BN(str.substring(2), 16) : new BN(str, 10)
}

function hex(n, byteLen = undefined) {
  const s = n.toString(16)
  return byteLen === undefined ? s : s.padStart(byteLen * 2, '0')
}

function hexPaddedToByte(n) {
  const s = n.toString(16)
  const prefix = s.length % 2 ? '0x0' : '0x'
  return prefix + s
}

function strip0x(s) {
  return s.substr(0, 2) === '0x' ? s.substr(2) : s
}

function bufferFromHexString(hex) {
  return Buffer.from(strip0x(hex), 'hex')
}

function hexStringFromBuffer(buf) {
  return '0x' + buf.toString('hex')
}

// Divides a BN by 1e15
const div15 = (bn) => bn.div(new BN(1000000)).div(new BN(1000000)).div(new BN(1000))

const e9 = (value) => web3.utils.toWei(value + '', 'gwei')
const e18 = (value) => web3.utils.toWei(value + '', 'ether')
const e27 = (value) => web3.utils.toWei(value + '', 'gether')
const gwei = e9
const ETH = e18
const tokens = e18
const shares = e18
const shareRate = e27

const bnE9 = new BN(10).pow(new BN(9))
const ethToGwei = (valueEth) => toBN(valueEth).div(bnE9).toString()

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

const toNum = (x) => (Array.isArray(x) ? x.map(toNum) : +x)
const toStr = (x) => (Array.isArray(x) ? x.map(toStr) : `${x}`)

const prepIdsCountsPayload = (ids, counts) => {
  if (!Array.isArray(ids)) ids = [ids]
  if (!Array.isArray(counts)) counts = [counts]
  return {
    operatorIds: '0x' + ids.map((id) => hex(id, 8)).join(''),
    keysCounts: '0x' + counts.map((count) => hex(count, 16)).join(''),
  }
}

const calcSharesMintedAsFees = (rewards, fee, feePoints, prevTotalShares, newTotalEther) => {
  return toBN(rewards)
    .mul(toBN(fee))
    .mul(toBN(prevTotalShares))
    .div(
      toBN(newTotalEther)
        .mul(toBN(feePoints))
        .sub(toBN(rewards).mul(toBN(fee)))
    )
}

const limitRebase = (limitE9, preTotalPooledEther, preTotalShares, clBalanceUpdate, elBalanceUpdate, sharesToBurn) => {
  const bnE9 = toBN(e9(1))

  const etherLimit = limitE9.mul(toBN(preTotalPooledEther)).div(bnE9).add(toBN(preTotalPooledEther))

  const clRebase = toBN(preTotalPooledEther).add(toBN(clBalanceUpdate))
  if (etherLimit.lte(clRebase)) {
    return { elBalanceUpdate: 0, sharesToBurn: 0 }
  }

  const remainEther = etherLimit.sub(clRebase)
  if (remainEther.lte(toBN(elBalanceUpdate))) {
    return { elBalanceUpdate: remainEther, sharesToBurn: 0 }
  }

  const postTotalPooledEther = clRebase.add(toBN(elBalanceUpdate))
  const rebaseLimitPlus1 = toBN(limitE9).add(bnE9)
  const tvlRate = toBN(postTotalPooledEther).mul(bnE9).div(toBN(preTotalPooledEther))

  const remainShares = toBN(preTotalShares).mul(rebaseLimitPlus1.sub(tvlRate)).div(rebaseLimitPlus1)

  if (remainShares.lte(toBN(sharesToBurn))) {
    return { elBalanceUpdate, sharesToBurn: remainShares }
  }

  return { elBalanceUpdate, sharesToBurn }
}

const calcShareRateDeltaE27 = (preTotalPooledEther, postTotalPooledEther, preTotalShares, postTotalShares) => {
  const oldShareRateE27 = toBN(e27(1)).mul(toBN(preTotalPooledEther)).div(toBN(preTotalShares))
  const newShareRatesE27 = toBN(e27(1)).mul(toBN(postTotalPooledEther)).div(toBN(postTotalShares))
  return newShareRatesE27.sub(oldShareRateE27)
}

function getFirstEventArgs(receipt, eventName, abi = undefined) {
  const events = getEvents(receipt, eventName, { decodeForAbi: abi })
  chai.assert(events.length !== 0, () => `Expected event ${eventName} wasn't emitted`)
  return events[0].args
}

function addSendWithResult(method) {
  method.sendWithResult = async (...args) => {
    const result = await method.call(...args)
    await method(...args)
    return result
  }
}

module.exports = {
  ZERO_ADDRESS,
  ZERO_HASH,
  pad,
  hexConcat,
  hexSplit,
  toBN,
  hex,
  hexPaddedToByte,
  strip0x,
  bufferFromHexString,
  hexStringFromBuffer,
  div15,
  e9,
  e18,
  e27,
  gwei,
  ETH,
  ethToGwei,
  StETH: ETH,
  tokens,
  changeEndianness,
  genKeys,
  shareRate,
  shares,
  padRight,
  toNum,
  toStr,
  prepIdsCountsPayload,
  calcSharesMintedAsFees,
  getFirstEventArgs,
  calcShareRateDeltaE27,
  addSendWithResult,
  limitRebase,
}
