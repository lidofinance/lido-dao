const { artifacts } = require('hardhat')

const OssifiableProxy = artifacts.require('OssifiableProxy.sol')
const WithdrawalQueueERC721 = artifacts.require('WithdrawalQueueERC721Mock.sol')

async function deploy(ownerAddress, wstethAddress, name = 'Lido: Withdrawal Request NFT', symbol = 'unstETH') {
  const impl = await WithdrawalQueueERC721.new(wstethAddress, name, symbol)
  const proxy = await OssifiableProxy.new(impl.address, ownerAddress, '0x')
  const queue = await WithdrawalQueueERC721.at(proxy.address)

  return {
    impl,
    proxy,
    queue,
  }
}

module.exports = {
  deploy,
}
