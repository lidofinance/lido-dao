const chalk = require('chalk')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter } = require('../helpers/log')
const { saveDeployTx } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const REQUIRED_NET_STATE = ['ensAddress', 'daoFactoryAddress', 'miniMeTokenFactoryAddress', 'aragonIDAddress', 'apmRegistryFactoryAddress']

async function deployTemplate({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const daoTemplateConstructorArgs = [
    state.multisigAddress,
    state.daoFactoryAddress,
    state.ensAddress,
    state.miniMeTokenFactoryAddress,
    state.aragonIDAddress,
    state.apmRegistryFactoryAddress
  ]

  await saveDeployTx('LidoTemplate', 'tx-01-1-deploy-template.json', daoTemplateConstructorArgs)
  persistNetworkState(network.name, netId, state, { daoTemplateConstructorArgs })
}

module.exports = runOrWrapScript(deployTemplate, module)
