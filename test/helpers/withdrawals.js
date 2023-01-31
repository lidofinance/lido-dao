const OssifiableProxy = artifacts.require('OssifiableProxy.sol')
const WithdrawalQueue = artifacts.require('WithdrawalQueue.sol')

async function deploy(ownerAddress, wstethAddress) {
  const impl = await WithdrawalQueue.new(wstethAddress)
  const proxy = await OssifiableProxy.new(impl.address, ownerAddress, '0x')
  const queue = await WithdrawalQueue.at(proxy.address)

  return {
    impl,
    proxy,
    queue
  }
}

module.exports = {
  deploy
}
