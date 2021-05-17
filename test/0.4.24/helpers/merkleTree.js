const { hexConcat } = require('../../helpers/utils')

const HASH_ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000'

const calcLeafHash = (keysBatch, sigsBatch) => web3.utils.keccak256(hexConcat(hexConcat(...keysBatch), hexConcat(...sigsBatch)))
const hashNodes = (left, right) => web3.utils.keccak256(web3.eth.abi.encodeParameters(['bytes32', 'bytes32'], [left, right]))

class MerkleTree {
  constructor(leaves) {
    if (leaves.length < 1) {
      throw new Error('At least 1 leaf needed')
    }

    const depth = Math.ceil(Math.log2(leaves.length))
    if (depth > 20) {
      throw new Error('Depth must be 20 or less')
    }

    this.leaves = leaves.concat(Array.from(Array(2 ** depth - leaves.length), () => HASH_ZERO))
    this.layers = [this.leaves]
    this.createHashes(this.leaves)
  }

  static fromKeysAndSignatures(keyBatches, sigBatches, batchSize = 8) {
    const leaves = keyBatches.map((keyBatch, index) => calcLeafHash(keyBatch, sigBatches[index]))
    return new MerkleTree(leaves)
  }

  createHashes(nodes) {
    if (nodes.length === 1) {
      // Reached the top of the tree
      return true
    }

    const treeLevel = []
    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i]
      const right = nodes[i + 1]
      treeLevel.push(hashNodes(left, right))
    }

    // is odd number of nodes
    if (nodes.length % 2 === 1) {
      treeLevel.push(nodes[nodes.length - 1])
    }

    this.layers.push(treeLevel)
    return this.createHashes(treeLevel)
  }

  getLeaves() {
    return this.leaves
  }

  getLayers() {
    return this.layers
  }

  getRoot() {
    return this.layers[this.layers.length - 1][0]
  }

  getProof(leaf) {
    let index = -1
    for (let i = 0; i < this.leaves.length; i += 1) {
      if (leaf === this.leaves[i]) {
        index = i
      }
    }
    if (index === -1) {
      throw new Error('Could not find element in tree')
    }

    const proof = []
    if (index <= this.getLeaves().length) {
      let siblingIndex
      for (let i = 0; i < this.layers.length - 1; i += 1) {
        if (index % 2 === 0) {
          siblingIndex = index + 1
        } else {
          siblingIndex = index - 1
        }
        index = Math.floor(index / 2)
        proof.push(this.layers[i][siblingIndex])
      }
    }
    return proof
  }

  static verify(value, index, root, proof) {
    if (!Array.isArray(proof) || !value || !root) {
      return false
    }

    let hash = value
    let currentIndex = index
    for (let i = 0; i < proof.length; i += 1) {
      const node = proof[i]
      if (currentIndex % 2 === 0) {
        hash = hashNodes(hash, node)
      } else {
        hash = hashNodes(node, hash)
      }

      currentIndex = Math.floor(currentIndex / 2)
    }

    return hash === root
  }
}

module.exports = {
  MerkleTree,
  calcLeafHash
}
