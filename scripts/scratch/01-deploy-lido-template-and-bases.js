const chalk = require('chalk')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, yl, gr } = require('../helpers/log')
const { saveDeployTx } = require('../helpers/deploy')
const { deployWithoutProxy } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')
const { APP_NAMES } = require('../constants')

const REQUIRED_NET_STATE = [
  'ensAddress',
  'daoFactoryAddress',
  'miniMeTokenFactoryAddress',
  'aragonIDAddress',
  'apmRegistryFactoryAddress',
  'multisigAddress'
]

async function deployTemplate({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  log.splitter()
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

  log.splitter()

  await deployWithoutProxy('lidoTemplate', 'LidoTemplate', state.multisigAddress, daoTemplateConstructorArgs)
  const daoTemplateDeployBlock = (await ethers.provider.getBlock('latest')).number

  await deployWithoutProxy(`app:${APP_NAMES.LIDO}`, 'Lido', state.multisigAddress, [], 'implementation')

  await deployWithoutProxy(`app:${APP_NAMES.ORACLE}`, 'LegacyOracle', state.multisigAddress, [], 'implementation')

  await deployWithoutProxy(`app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`, 'NodeOperatorsRegistry', state.multisigAddress, [], 'implementation')

  persistNetworkState(network.name, netId, readNetworkState(network.name, netId), {
    daoTemplateDeployBlock,
  })

  log.splitter()
  log(gr(`Before continuing the deployment, please send all contract creation transactions`))
  log(gr(`that you can find in the files listed above. You may use a multisig address`))
  log(gr(`if it supports deploying new contract instances.`))
  log.splitter()

}

module.exports = runOrWrapScript(deployTemplate, module)
