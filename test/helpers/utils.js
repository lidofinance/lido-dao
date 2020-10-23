const { BN } = require('bn.js')

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

module.exports = {
  pad,
  hexConcat,
  toBN,
  div15,
  ETH,
  tokens
}
