const { hexConcat, KEYS_BATCH_SIZE } = require('../../helpers/utils')
const { calcLeafHash, MerkleTree } = require('./merkleTree')

const buildKeyData = (operators, operatorId, leafIndex, usedSigningKeysArray = operators.map(() => 0), batchSize = KEYS_BATCH_SIZE) => {
  const { keys, sigs } = operators[operatorId]
  const publicKeys = hexConcat(...keys[leafIndex])
  const signatures = hexConcat(...sigs[leafIndex])
  const usedSigningKeys = usedSigningKeysArray[operatorId]
  const merkleProof = MerkleTree.fromKeysAndSignatures(keys, sigs, usedSigningKeys, batchSize).getProof(
    calcLeafHash(usedSigningKeys + leafIndex * batchSize, keys[leafIndex], sigs[leafIndex])
  )
  const proofData = merkleProof.length > 0 ? hexConcat(...merkleProof) : '0x'
  return {
    leafIndex,
    publicKeys,
    signatures,
    proofData
  }
}

module.exports = {
  buildKeyData
}
