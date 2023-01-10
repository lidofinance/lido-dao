const PUBKEY_LENGTH = 48
const SIGNATURE_LENGTH = 96
const { pad, hexConcat } = require('./utils')

function createFakePublicKeysBatch(length) {
  if (length > Number.MAX_SAFE_INTEGER) {
    throw new Error('Keys sequence too long')
  }
  return hexConcat(
    ...Array(length)
      .fill(0)
      .map((_, i) => Number(i + 1).toString(16))
      .map((v) => (v.length % 2 === 0 ? v : '0' + v))
      .map((v) => pad('0x' + v, PUBKEY_LENGTH, 'f'))
  )
}

function createFakeSignaturesBatch(length) {
  if (length > Number.MAX_SAFE_INTEGER) {
    throw new Error('Keys sequence too long')
  }
  return hexConcat(
    ...Array(length)
      .fill(0)
      .map((_, i) => Number(i + 1).toString(16))
      .map((v) => (v.length % 2 === 0 ? v : '0' + v))
      .map((v) => pad('0x' + v, SIGNATURE_LENGTH, 'e'))
  )
}

module.exports = {
  PUBKEY_LENGTH,
  SIGNATURE_LENGTH,
  createFakePublicKeysBatch,
  createFakeSignaturesBatch
}
