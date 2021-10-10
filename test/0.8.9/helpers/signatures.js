const BN = require('bn.js')
const { keccak256 } = require('js-sha3')
const { ecSign, strip0x } = require('../../0.6.12/helpers')

function generateGuardianSignatures(guardianIndexesWithSignatures) {
  return guardianIndexesWithSignatures.reduce((combinedSignatures, [guardianIndex, { v, r, s }]) => {
    return combinedSignatures + uint8ToHex(guardianIndex, true) + uint8ToHex(v, true) + strip0x(r) + strip0x(s)
  }, '0x')
}

function signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, guardianPrivateKey) {
  const hash = keccak256(encodeDepositRootAndKeysOpIndex(attestMessagePrefix, depositRoot, keysOpIndex))
  return ecSign(hash, guardianPrivateKey)
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
  generateGuardianSignatures,
  signDepositData
}
