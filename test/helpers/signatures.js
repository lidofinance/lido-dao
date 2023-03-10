const BN = require('bn.js')
const { ecsign: ecSignBuf } = require('ethereumjs-util')
const { keccak256 } = require('js-sha3')

const { strip0x, bufferFromHexString, hexStringFromBuffer } = require('./utils')

function ecSign(digest, privateKey) {
  const { v, r, s } = ecSignBuf(bufferFromHexString(digest), bufferFromHexString(privateKey))
  return { v, r: hexStringFromBuffer(r), s: hexStringFromBuffer(s) }
}

// Converts a ECDSA signature to the format provided in https://eips.ethereum.org/EIPS/eip-2098.
function toEip2098({ v, r, s }) {
  const vs = bufferFromHexString(s)
  if (vs[0] >> 7 === 1) {
    throw new Error(`invalid signature 's' value`)
  }
  vs[0] |= v % 27 << 7 // set the first bit of vs to the v parity bit
  return [r, hexStringFromBuffer(vs)]
}

const UINT256_SIZE = 64

class DSMMessage {
  static MESSAGE_PREFIX

  static setMessagePrefix(newMessagePrefix) {
    this.MESSAGE_PREFIX = newMessagePrefix
  }

  get messagePrefix() {
    const messagePrefix = this.constructor.MESSAGE_PREFIX
    if (messagePrefix === undefined) {
      throw new Error(`MESSAGE_PREFIX isn't set`)
    }
    return messagePrefix
  }

  get hash() {
    throw new Error('Unimplemented')
  }

  sign(signerPrivateKey) {
    return toEip2098(ecSign(this.hash, signerPrivateKey))
  }
}

class DSMAttestMessage extends DSMMessage {
  constructor(blockNumber, blockHash, depositRoot, stakingModule, keysOpIndex) {
    super()
    this.blockNumber = blockNumber
    this.blockHash = blockHash
    this.depositRoot = depositRoot
    this.stakingModule = stakingModule
    this.keysOpIndex = keysOpIndex
  }

  get hash() {
    return keccak256(
      hexToBytes(
        strip0x(this.messagePrefix) +
          encodeBN(this.blockNumber) +
          strip0x(this.blockHash) +
          strip0x(this.depositRoot) +
          encodeBN(this.stakingModule) +
          encodeBN(this.keysOpIndex)
      )
    )
  }
}

class DSMPauseMessage extends DSMMessage {
  constructor(blockNumber, stakingModule) {
    super()
    this.blockNumber = blockNumber
    this.stakingModule = stakingModule
  }

  get hash() {
    return keccak256(
      hexToBytes(strip0x(this.messagePrefix) + encodeBN(this.blockNumber) + encodeBN(this.stakingModule))
    )
  }
}

function signPauseData(pauseMessagePrefix, pauseMessage, guardianPrivateKey) {
  const hash = keccak256(encodePauseData(pauseMessagePrefix, pauseMessage))
  return toEip2098(ecSign(hash, guardianPrivateKey))
}

function encodePauseData(pauseMessagePrefix, pauseMessage) {
  return hexToBytes(
    strip0x(pauseMessagePrefix) + encodeBN(pauseMessage.blockNumber) + encodeBN(pauseMessage.stakingModule)
  )
}

function encodeBN(value) {
  return new BN(value).toString('hex', UINT256_SIZE) // 32bytes
}

function signDepositData(
  attestMessagePrefix,
  blockNumber,
  blockHash,
  depositRoot,
  StakingModuleId,
  keysOpIndex,
  calldata,
  guardianPrivateKey
) {
  const hash = keccak256(
    encodeAttestMessage(attestMessagePrefix, blockNumber, blockHash, depositRoot, StakingModuleId, keysOpIndex)
  )
  return toEip2098(ecSign(hash, guardianPrivateKey))
}

function encodeAttestMessage(attestMessagePrefix, blockNumber, blockHash, depositRoot, StakingModuleId, keysOpIndex) {
  const uint256Size = 64

  return hexToBytes(
    strip0x(attestMessagePrefix) +
      new BN(blockNumber).toString('hex', uint256Size) +
      strip0x(blockHash) +
      strip0x(depositRoot) +
      new BN(StakingModuleId).toString('hex', uint256Size) +
      new BN(keysOpIndex).toString('hex', uint256Size)
  )
}

function hexToBytes(hex) {
  const bytes = []
  for (let c = 0; c < hex.length; c += 2) bytes.push(parseInt(hex.substr(c, 2), 16))
  return bytes
}

module.exports = {
  ecSign,
  toEip2098,
  keccak256,
  signDepositData,
  signPauseData,
  DSMPauseMessage,
  DSMAttestMessage,
}
