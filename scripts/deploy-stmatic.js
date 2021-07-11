const chalk = require('chalk')
const hre = require('hardhat')

const runOrWrapScript = require('./helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter } = require('./helpers/log')
const { deploy, withArgs } = require('./helpers/deploy')
const { readNetworkState, persistNetworkState } = require('./helpers/persisted-network-state')

async function deploystMaticContract({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()
  const network = hre.network.name

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)
  log(`Network name: ${chalk.yellow(network)}`)

  const state = readNetworkState(network, netId)
  const [deployer] = await web3.eth.getAccounts()

  // const stMaticAddress = state['app:lido'].proxyAddress
  // console.log('stMaticAddress', stMaticAddress)
  // console.log('deployer', deployer)

  const stmaticContractResults = await deploystMatic({
    artifacts,
    deployer,
  })

  logSplitter()
  persistNetworkState(network, netId, state, stmaticContractResults)
}

async function deploystMatic({ artifacts, deployer }) {
  const stMaticContract = await deploy('StMATIC', artifacts, withArgs({ from: deployer }))
  return { stMaticContract }
}

module.exports = runOrWrapScript(deploystMaticContract, module)
