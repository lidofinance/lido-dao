const { ecsign } = require('ethereumjs-util')
const { assert } = require('chai')

async function expectRevert(promise, reason) {
  let err
  try {
    await promise
  } catch (e) {
    err = e
  }

  if (!err) {
    assert.fail('Exception not thrown')
  }

  const errMsg = err.hijackedMessage || err.message
  assert.match(errMsg, /revert/i)

  if (!reason) {
  } else if (reason instanceof RegExp) {
    assert.match(errMsg, reason)
  } else {
    assert.include(errMsg, reason)
  }
}

function hexStringFromBuffer(buf) {
  return '0x' + buf.toString('hex')
}

function strip0x(v) {
  return v.replace(/^0x/, '')
}

function ecSign(digest, privateKey) {
  const { v, r, s } = ecsign(bufferFromHexString(digest), bufferFromHexString(privateKey))

  return { v, r: hexStringFromBuffer(r), s: hexStringFromBuffer(s) }
}

function bufferFromHexString(hex) {
  return Buffer.from(strip0x(hex), 'hex')
}

module.exports = {
  expectRevert,
  hexStringFromBuffer,
  strip0x,
  ecSign,
  bufferFromHexString
}
