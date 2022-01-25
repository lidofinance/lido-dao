const chalk = require('chalk')

const runOrWrapScript = require('./helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, logHeader, logTx, logDeploy } = require('./helpers/log')
const { deploy, useOrDeploy, withArgs } = require('./helpers/deploy')
const { readNetworkState, persistNetworkState } = require('./helpers/persisted-network-state')

const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'

async function deployBeaconDepositContract({ web3, artifacts, networkStateFile = NETWORK_STATE_FILE }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  const [firstAccount] = await web3.eth.getAccounts()
  const { daoInitialSettings = { beaconSpec: { depositContractAddress: '' } } } = state
  let depositContractAddress
  if (daoInitialSettings.beaconSpec && daoInitialSettings.beaconSpec.depositContractAddress) {
    depositContractAddress = daoInitialSettings.beaconSpec.depositContractAddress
  }
  const { depositContract } = await useOrDeployDepositContract({
    artifacts,
    owner: firstAccount,
    depositContractAddress: depositContractAddress || state.depositContractAddress
  })

  daoInitialSettings.beaconSpec.depositContractAddress = depositContract.address
  logSplitter()
  persistNetworkState(network.name, netId, state, { depositContract, daoInitialSettings })
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
