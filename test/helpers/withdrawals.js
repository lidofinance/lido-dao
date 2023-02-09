const OssifiableProxy = artifacts.require('OssifiableProxy.sol')
const WithdrawalRequestNFT = artifacts.require('WithdrawalRequestNFT.sol')

async function deploy(ownerAddress, wstethAddress) {
  const impl = await WithdrawalRequestNFT.new(wstethAddress)
  const proxy = await OssifiableProxy.new(impl.address, ownerAddress, '0x')
  const queue = await WithdrawalRequestNFT.at(proxy.address)

  return {
    impl,
    proxy,
    queue
  }
}

module.exports = {
  deploy
}
