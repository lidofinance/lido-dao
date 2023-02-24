const { ecsign } = require('ethereumjs-util')

function hexStringFromBuffer(buf) {
  return '0x' + buf.toString('hex')
}

function bufferFromHexString(hex) {
  return Buffer.from(strip0x(hex), 'hex')
}

function strip0x(v) {
  return v.replace(/^0x/, '')
}

function ecSign(digest, privateKey) {
  const { v, r, s } = ecsign(bufferFromHexString(digest), bufferFromHexString(privateKey))

  return { v, r: hexStringFromBuffer(r), s: hexStringFromBuffer(s) }
}

module.exports = {
  hexStringFromBuffer,
  strip0x,
  ecSign,
  bufferFromHexString,
}
