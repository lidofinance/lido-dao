async function waitBlocks(numBlocksToMine) {
  let block
  for (let i = 0; i < numBlocksToMine; ++i) {
    await network.provider.send('evm_mine')
    block = await web3.eth.getBlock('latest')
  }
  return block
}

module.exports = {
  waitBlocks
}
