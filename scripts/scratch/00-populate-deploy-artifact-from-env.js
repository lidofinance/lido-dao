const chalk = require('chalk')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, yl, gr } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const DEPLOYER = process.env.DEPLOYER
const CHAIN_ID = process.env.CHAIN_ID

async function deployTemplate({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  log.splitter()
  log(`Network ID: ${chalk.yellow(netId)}`)
  log(`Deployer: ${chalk.yellow(DEPLOYER)}`)

  const state = readNetworkState(network.name, netId)
  persistNetworkState(network.name, netId, state, {
    chainId: CHAIN_ID,
    multisigAddress: DEPLOYER,
  })
}

module.exports = runOrWrapScript(deployTemplate, module)
