const { hexConcat, padKey, padSig } = require('../../helpers/utils')

const createKeys = (numKeys, start = 0) => Array.from({ length: numKeys }, (_value, i) => padKey(`0x${i + start + 1}`))
const createSigs = (numSigs, start = 0) => Array.from({ length: numSigs }, (_value, i) => padSig(`0x${i + start + 1}`))

const sanitiseKeyArray = (keys) => hexConcat(...keys.flat().map((key) => padKey(key)))
const sanitiseSigArray = (sigs) => hexConcat(...sigs.flat().map((key) => padSig(key)))

const createKeyBatches = (numBatches, start = 0, batchSize = 8) =>
  Array.from({ length: numBatches }, (_value, i) => createKeys(batchSize, start + i * batchSize))
const createSigBatches = (numBatches, start = 0, batchSize = 8) =>
  Array.from({ length: numBatches }, (_value, i) => createSigs(batchSize, start + i * batchSize))

module.exports = {
  createKeys,
  createSigs,
  createKeyBatches,
  createSigBatches,
  sanitiseKeyArray,
  sanitiseSigArray
}
