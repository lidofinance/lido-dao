async function waitBlocks(numBlocksToMine) {
  let block
  for (let i = 0; i < numBlocksToMine; ++i) {
    await network.provider.send('evm_mine')
    block = await web3.eth.getBlock('latest')
  }
  return block
}

/**
 * Allows to make snapshots of the blockchain and revert to the previously made snapshots
 */
class EvmSnapshot {
  constructor(provider) {
    this.provider = provider
    this.evmSnapshotIds = []
  }

  async add() {
    this.evmSnapshotIds.push(await this.provider.send('evm_snapshot', []))
  }

  async revert(offset = -1) {
    if (this.evmSnapshotIds.length + offset < 0) {
      throw new Error('Revert Error: no snapshots to revert')
    }
    while (offset !== 0) {
      offset += 1
      const lastSnapshotId = this.evmSnapshotIds.pop()
      await this.provider.send('evm_revert', [lastSnapshotId])
    }
  }
}

module.exports = {
  EvmSnapshot,
  waitBlocks
}
