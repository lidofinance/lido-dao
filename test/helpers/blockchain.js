const { network, web3, ethers } = require('hardhat')
const { wei } = require('./wei')

async function waitBlocks(numBlocksToMine) {
  let block
  for (let i = 0; i < numBlocksToMine; ++i) {
    await network.provider.send('evm_mine')
    block = await web3.eth.getBlock('latest')
  }
  return block
}

async function advanceChainTime(seconds) {
  await network.provider.send('evm_increaseTime', [seconds])
  await network.provider.send('evm_mine')
}

async function getCurrentBlockTimestamp() {
  const blockNum = await ethers.provider.getBlockNumber()
  const block = await ethers.provider.getBlock(blockNum)
  return block.timestamp
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

async function getBalance(addressOrContract) {
  const address = addressOrContract.address || addressOrContract
  return wei.int(await ethers.provider.getBalance(address))
}

async function setBalance(addressOrContract, value) {
  const address = addressOrContract.address || addressOrContract
  const hexValue = web3.utils.numberToHex(wei.str(value))
  await network.provider.send('hardhat_setBalance', [address, hexValue])
}

module.exports = {
  EvmSnapshot,
  waitBlocks,
  advanceChainTime,
  getCurrentBlockTimestamp,
  impersonate,
  getBalance,
  setBalance,
}
