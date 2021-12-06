const chalk = require('chalk')
const hre = require('hardhat')

const runOrWrapScript = require('./helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter } = require('./helpers/log')
const { deploy, withArgs } = require('./helpers/deploy')
const { readNetworkState, persistNetworkState } = require('./helpers/persisted-network-state')

async function deployWstEthContract({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()
  const network = hre.network.name

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)
  log(`Network name: ${chalk.yellow(network)}`)

  const state = readNetworkState(network.name, netId)
  const [deployer] = await web3.eth.getAccounts()

  const stEthAddress = state['app:lido'].proxyAddress
  console.log('stEthAddress', stEthAddress)
  console.log('deployer', deployer)

  const wstethContractResults = await deployWsteth({
    artifacts,
    stEthAddress,
    deployer,
  })

  logSplitter()
  persistNetworkState(network.name, netId, state, wstethContractResults)
}

async function deployWsteth({ artifacts, stEthAddress, deployer }) {
  const wstethContract = await deploy('WstETH', artifacts, withArgs(stEthAddress, { from: deployer }))
  return { wstethContract }
}

module.exports = runOrWrapScript(deployWstEthContract, module)
