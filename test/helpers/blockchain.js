async function waitBlocks(numBlocksToMine) {
  let block
  for (let i = 0; i < numBlocksToMine; ++i) {
    await network.provider.send('evm_mine')
    block = await web3.eth.getBlock('latest')
  }
  return block
}

/**
 * Allows to make snapshot of the blockchain and revert to the previous state
 */
class EvmSnapshot {
  constructor(provider) {
    this.provider = provider
    this.evmSnapshotId = undefined
  }

  async make() {
    this.evmSnapshotId = await this.provider.send('evm_snapshot', [])
  }

  async revert() {
    if (this.evmSnapshotId === undefined) {
      throw new Error('Revert Error: no snapshots to revert')
    }
    await this.provider.send('evm_revert', [this.evmSnapshotId])
    this.evmSnapshotId = undefined
  }

  async rollback() {
    await this.revert()
    await this.make()
  }
}

function impersonate(provider, address) {
  return provider.send('hardhat_impersonateAccount', [address])
}

module.exports = {
  EvmSnapshot,
  waitBlocks,
  impersonate
}
