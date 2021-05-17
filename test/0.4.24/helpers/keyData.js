const { hexConcat } = require('../../helpers/utils')
const { calcLeafHash, MerkleTree } = require('./merkleTree')

const buildKeyData = (operators, operatorId, leafIndex) => {
  const operator = operators[operatorId]
  const publicKeys = hexConcat(...operator.keys[leafIndex])
  const signatures = hexConcat(...operator.sigs[leafIndex])
  const proofData = hexConcat(
    ...MerkleTree.fromKeysAndSignatures(operator.keys, operator.sigs).getProof(
      calcLeafHash(operator.keys[leafIndex], operator.sigs[leafIndex])
    )
  )
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
