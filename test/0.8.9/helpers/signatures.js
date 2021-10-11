const BN = require('bn.js')
const { keccak256 } = require('js-sha3')
const { ecSign, strip0x, bufferFromHexString, hexStringFromBuffer } = require('../../0.6.12/helpers')

// Converts a ECDSA signature to the format provided in https://eips.ethereum.org/EIPS/eip-2098.
function toEip2098({ v, r, s }) {
  const vs = bufferFromHexString(s)
  if (vs[0] >> 7 === 1) {
    throw new Error(`invalid signature 's' value`)
  }
  vs[0] |= v % 27 << 7 // set the first bit of vs to the v parity bit
  return [r, hexStringFromBuffer(vs)]
}

function signPauseData(pauseMessagePrefix, blockHeight, guardianPrivateKey) {
  const hash = keccak256(encodePauseData(pauseMessagePrefix, blockHeight))
  return toEip2098(ecSign(hash, guardianPrivateKey))
}

function encodePauseData(pauseMessagePrefix, blockHeight) {
  const uint256Size = 64
  return hexToBytes(strip0x(pauseMessagePrefix) + new BN(blockHeight).toString('hex', uint256Size))
}

function signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, guardianPrivateKey) {
  const hash = keccak256(encodeDepositRootAndKeysOpIndex(attestMessagePrefix, depositRoot, keysOpIndex))
  return toEip2098(ecSign(hash, guardianPrivateKey))
}

function uint8ToHex(value) {
  if (value < 0 || value > 2 ** 8 - 1) {
    throw new Error('Overflow: value out of uint8 bounds')
  }
  const hexedValue = value.toString(16)
  return hexedValue.length === 2 ? hexedValue : '0' + hexedValue
}

function encodeDepositRootAndKeysOpIndex(attestMessagePrefix, depositRoot, keysOpIndex) {
  const uint256Size = 64
  return hexToBytes(strip0x(attestMessagePrefix) + strip0x(depositRoot) + new BN(keysOpIndex).toString('hex', uint256Size))
}

function hexToBytes(hex) {
  for (var bytes = [], c = 0; c < hex.length; c += 2) bytes.push(parseInt(hex.substr(c, 2), 16))
  return bytes
}

module.exports = {
  signDepositData,
  signPauseData
}
