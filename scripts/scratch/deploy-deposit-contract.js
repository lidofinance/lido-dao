const chalk = require('chalk')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter } = require('../helpers/log')
const { deploy, withArgs } = require('../helpers/deploy')
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
  const { depositContract } = await useOrDeployDepositContract({
    artifacts,
    owner: firstAccount,
    depositContractAddress: depositContractAddress,
  })

  chainSpec.depositContract = depositContract.address
  logSplitter()
  persistNetworkState(network.name, netId, state, { chainSpec })
}

async function useOrDeployDepositContract({ artifacts, owner, depositContractAddress }) {
  if (depositContractAddress) {
    log(`Using DepositContract at: ${chalk.yellow(depositContractAddress)}`)
    const depositContract = await artifacts.require('DepositContract').at(depositContractAddress)
    return { depositContract }
  }
  const depositContract = await deploy('DepositContract', artifacts, withArgs({ from: owner }))
  return { depositContract }
}

module.exports = runOrWrapScript(deployBeaconDepositContract, module)
