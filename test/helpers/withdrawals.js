const { utils } = require('ethers')

const OssifiableProxy = artifacts.require('OssifiableProxy.sol')
const WithdrawalRequestNFT = artifacts.require('WithdrawalRequestNFT.sol')

async function deploy(ownerAddress, wstethAddress, name = "Lido Withdrawal Request", symbol = "unstETH") {
  const impl = await WithdrawalRequestNFT.new(wstethAddress, name, symbol)
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
