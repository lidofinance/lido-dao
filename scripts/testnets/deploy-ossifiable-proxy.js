const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const hre = require("hardhat")
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const DEPLOYER = process.env.DEPLOYER || ''

async function deployOssifiableProxy({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))
  log(`DEPLOYER`, yl(DEPLOYER))

  const implementation = '0x53088a55756fD8abe32E308a1d6f7AEdfa48a886'

  let OssifiableProxy = await hre.ethers.getContractFactory("OssifiableProxy")

  let proxy = await OssifiableProxy.deploy(
    implementation,
    DEPLOYER,
    [],
    { gasLimit: 8000000}
  )
  console.log(proxy.address)

}

module.exports = runOrWrapScript(deployOssifiableProxy, module)
