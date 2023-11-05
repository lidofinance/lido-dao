const chalk = require('chalk')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter } = require('../helpers/log')
const { deployWithoutProxy, TotalGasCounter } = require('../helpers/deploy')
const { readNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'

async function deployBeaconDepositContract({ web3, artifacts, networkStateFile = NETWORK_STATE_FILE }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  const [firstAccount] = await web3.eth.getAccounts()
  const chainSpec = state.chainSpec
  let depositContractAddress
  if (chainSpec.depositContract) {
    depositContractAddress = chainSpec.depositContract
  }
  depositContractAddress = await useOrDeployDepositContract({
    artifacts,
    owner: firstAccount,
    depositContractAddress,
  })

  state.chainSpec.depositContract = depositContractAddress
  persistNetworkState(network.name, netId, state)
  logSplitter()

  await TotalGasCounter.incrementTotalGasUsedInStateFile()
}

async function useOrDeployDepositContract({ artifacts, owner, depositContractAddress }) {
  if (depositContractAddress) {
    log(`Using DepositContract at: ${chalk.yellow(depositContractAddress)}`)
    const depositContract = await artifacts.require('DepositContract').at(depositContractAddress)
    return depositContract.address
  }
  return await deployWithoutProxy('depositContract', 'DepositContract', owner)
}

module.exports = runOrWrapScript(deployBeaconDepositContract, module)
