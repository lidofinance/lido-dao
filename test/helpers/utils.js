const hre = require('hardhat')
const { BN } = require('bn.js')
const { getEventAt } = require('@aragon/contract-helpers-test')

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

function hex(n, byteLen) {
  return n.toString(16).padStart(byteLen * 2, '0')
}

function strip0x(s) {
  return s.substr(0, 2) == '0x' ? s.substr(2) : s
}

// transforms all object entries
const transformEntries = (obj, tr) => Object.fromEntries(
  Object.entries(obj).map(tr).filter(x => x !== undefined)
)

// converts all object BN keys to strings, drops numeric keys and the __length__ key
const processNamedTuple = (obj) => transformEntries(obj, ([k, v]) => {
  return /^(\d+|__length__)$/.test(k) ? undefined : [k, BN.isBN(v) ? v.toString() : v]
})

const printEvents = (tx) => {
  console.log(tx.receipt.logs.map(({event, args}) => ({event, args: processNamedTuple(args)})))
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
const ethToGwei = valueEth => toBN(valueEth).div(bnE9).toString()

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

const assertNoEvent = (receipt, eventName, msg) => {
  const event = getEventAt(receipt, eventName)
  assert.equal(event, undefined, msg)
}

function assertBnClose(x, y, maxDiff, msg = undefined) {
  const diff = new BN(x).sub(new BN(y)).abs()
  assert(
    diff.lte(new BN(maxDiff)),
    () => `Expected ${x} to be close to ${y} with max diff ${maxDiff}, actual diff ${diff}`,
    () => `Expected ${x} not to be close to ${y} with min diff ${maxDiff}, actual diff ${diff}`,
  )
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

const toNum = (x) => Array.isArray(x) ? x.map(toNum) : +x
const toStr = (x) => Array.isArray(x) ? x.map(toStr) : `${x}`

const setBalance = async (address, value) => {
  await hre.network.provider.send('hardhat_setBalance', [address, web3.utils.numberToHex(value)])
}

module.exports = {
  ZERO_HASH,
  pad,
  hexConcat,
  hexSplit,
  toBN,
  hex,
  strip0x,
  transformEntries,
  processNamedTuple,
  printEvents,
  div15,
  e9,
  e18,
  e27,
  gwei,
  ETH,
  ethToGwei,
  StETH: ETH,
  tokens,
  getEthBalance,
  formatWei,
  formatBN,
  formatStEth,
  assertNoEvent,
  assertBnClose,
  changeEndianness,
  genKeys,
  shareRate,
  shares,
  padRight,
  toNum,
  toStr,
  setBalance
}
