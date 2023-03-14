const PUBKEY_LENGTH = 48
const SIGNATURE_LENGTH = 96
const EMPTY_PUBLIC_KEY = '0x' + '0'.repeat(2 * PUBKEY_LENGTH)
const EMPTY_SIGNATURE = '0x' + '0'.repeat(2 * SIGNATURE_LENGTH)

const { strip0x, pad, hexConcat, hexSplit } = require('./utils')

class ValidatorKeys {
  constructor(publicKeys, signatures) {
    if (publicKeys.length !== signatures.length) {
      throw new Error('Public keys & signatures length mismatch')
    }

    publicKeys = publicKeys.map(strip0x)
    signatures = signatures.map(strip0x)

    if (!publicKeys.every((pk) => pk.length !== PUBKEY_LENGTH)) {
      throw new Error('Invalid Public Key length')
    }

    if (!signatures.every((s) => s.length !== SIGNATURE_LENGTH)) {
      throw new Error('Invalid Signature length')
    }
    this.count = publicKeys.length
    this.publicKeysList = publicKeys
    this.signaturesList = signatures
  }

  get(index) {
    if (index >= this.count) {
      throw new Error(`Index out of range`)
    }
    return ['0x' + this.publicKeysList[index], '0x' + this.signaturesList[index]]
  }

  slice(start = 0, end = this.count) {
    return [hexConcat(...this.publicKeysList.slice(start, end)), hexConcat(...this.signaturesList.slice(start, end))]
  }
}

class FakeValidatorKeys extends ValidatorKeys {
  constructor(length, { seed = randomInt(10, 10 ** 9), kFill = 'f', sFill = 'e' } = {}) {
    super(
      Array(length)
        .fill(0)
        .map((_, i) => Number(seed + i).toString(16))
        .map((v) => (v.length % 2 === 0 ? v : '0' + v)) // make resulting hex str length representation even(faa -> 0faa)
        .map((v) => pad('0x' + v, PUBKEY_LENGTH, kFill)),
      Array(length)
        .fill(0)
        .map((_, i) => Number(seed + i).toString(16))
        .map((v) => (v.length % 2 === 0 ? v : '0' + v)) // make resulting hex str length representation even(faa -> 0faa)
        .map((v) => pad('0x' + v, SIGNATURE_LENGTH, sFill))
    )
  }
}

function splitPublicKeysBatch(batch) {
  return hexSplit(batch, PUBKEY_LENGTH)
}

function splitSignaturesBatch(batch) {
  return hexSplit(batch, SIGNATURE_LENGTH)
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

module.exports = {
  PUBKEY_LENGTH,
  SIGNATURE_LENGTH,
  EMPTY_PUBLIC_KEY,
  EMPTY_SIGNATURE,
  FakeValidatorKeys,
  splitPublicKeysBatch,
  splitSignaturesBatch,
}
