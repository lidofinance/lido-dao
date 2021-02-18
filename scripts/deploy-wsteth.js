const chalk = require('chalk')

const runOrWrapScript = require('./helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter } = require('./helpers/log')
const { deploy, withArgs } = require('./helpers/deploy')
const { readNetworkState, persistNetworkState } = require('./helpers/persisted-network-state')

const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'

async function deployWstEthContract({ web3, artifacts, networkStateFile = NETWORK_STATE_FILE }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(networkStateFile, netId)
  const [deployer] = await web3.eth.getAccounts()

  const stEthAddress = state['app:lido'].proxyAddress
  const wstethContractResults = await deployWsteth({
    artifacts,
    stEthAddress,
    deployer,
  })

  logSplitter()
  persistNetworkState(networkStateFile, netId, state, wstethContractResults)
}

async function deployWsteth({ artifacts, stEthAddress, deployer }) {
  const wstethContract = await deploy('WstETH', artifacts, withArgs(stEthAddress, { from: deployer }))
  return { wstethContract }
}

module.exports = runOrWrapScript(deployWstEthContract, module)
