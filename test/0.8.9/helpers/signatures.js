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

function signPauseData(pauseMessagePrefix, blockNumber, guardianPrivateKey) {
  const hash = keccak256(encodePauseData(pauseMessagePrefix, blockNumber))
  return toEip2098(ecSign(hash, guardianPrivateKey))
}

function encodePauseData(pauseMessagePrefix, blockNumber) {
  const uint256Size = 64
  return hexToBytes(strip0x(pauseMessagePrefix) + new BN(blockNumber).toString('hex', uint256Size))
}

function signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, blockNumber, blockHash, guardianPrivateKey) {
  const hash = keccak256(encodeAttestMessage(attestMessagePrefix, depositRoot, keysOpIndex, blockNumber, blockHash))
  return toEip2098(ecSign(hash, guardianPrivateKey))
}

function encodeAttestMessage(attestMessagePrefix, depositRoot, keysOpIndex, blockNumber, blockHash) {
  const uint256Size = 64
  return hexToBytes(
    strip0x(attestMessagePrefix) +
      strip0x(depositRoot) +
      new BN(keysOpIndex).toString('hex', uint256Size) +
      new BN(blockNumber).toString('hex', uint256Size) +
      strip0x(blockHash)
  )
}

function hexToBytes(hex) {
  for (var bytes = [], c = 0; c < hex.length; c += 2) bytes.push(parseInt(hex.substr(c, 2), 16))
  return bytes
}

module.exports = {
  signDepositData,
  signPauseData
}
