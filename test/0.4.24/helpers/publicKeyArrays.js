const { hexConcat, padKey, padSig } = require('../../helpers/utils')

const createKeys = (numKeys) => Array.from({ length: numKeys }, (_value, i) => padKey(`0x${i + 1}`))
const createSigs = (numSigs) => Array.from({ length: numSigs }, (_value, i) => padSig(`0x${i + 1}`))

const packKeyArray = (keys) => hexConcat(...keys.map((key) => padKey(key)))
const packSigArray = (sigs) => hexConcat(...sigs.map((key) => padSig(key)))

module.exports = {
  createKeys,
  createSigs,
  packKeyArray,
  packSigArray
}
