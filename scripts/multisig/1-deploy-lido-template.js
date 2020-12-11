const chalk = require('chalk')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter } = require('../helpers/log')
const { saveDeployTx } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const REQUIRED_NET_STATE = ['ensAddress', 'daoFactoryAddress', 'miniMeTokenFactoryAddress', 'aragonIDAddress', 'apmRegistryFactoryAddress']

const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'

async function deployTemplate({ web3, artifacts, networkStateFile = NETWORK_STATE_FILE }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(networkStateFile, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const daoTemplateConstructorArgs = [
    state.multisigAddress,
    state.daoFactoryAddress,
    state.ensAddress,
    state.miniMeTokenFactoryAddress,
    state.aragonIDAddress,
    state.apmRegistryFactoryAddress
  ]

  await saveDeployTx('LidoTemplate3', 'tx-01-deploy-template.json', daoTemplateConstructorArgs)
  persistNetworkState(networkStateFile, netId, state, { daoTemplateConstructorArgs })
}

module.exports = runOrWrapScript(deployTemplate, module)
