const { hexConcat } = require('../../helpers/utils')
const { calcLeafHash, MerkleTree } = require('./merkleTree')

const buildKeyData = (operators, operatorId, leafIndex) => {
  const operator = operators[operatorId]
  const publicKeys = hexConcat(...operator.keys[leafIndex])
  const signatures = hexConcat(...operator.sigs[leafIndex])
  const merkleProof = MerkleTree.fromKeysAndSignatures(operator.keys, operator.sigs).getProof(
    calcLeafHash(operator.keys[leafIndex], operator.sigs[leafIndex])
  )
  const proofData = merkleProof.length > 0 ? hexConcat(...merkleProof) : '0x'
  return {
    operatorId,
    leafIndex,
    publicKeys,
    signatures,
    proofData
  }
}

module.exports = {
  buildKeyData
}
