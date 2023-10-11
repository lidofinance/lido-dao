const chalk = require('chalk')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, yl, gr } = require('../helpers/log')
const { deployImplementation, deployWithoutProxy } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState2 } = require('../helpers/persisted-network-state')
const { APP_NAMES } = require('../constants')

const REQUIRED_NET_STATE = [
  'ensAddress',
  'daoFactoryAddress',
  'miniMeTokenFactoryAddress',
  'aragonIDAddress',
  'apmRegistryFactoryAddress',
  'deployer'
]

async function deployTemplate({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  log.splitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const daoTemplateConstructorArgs = [
    state.deployer,
    state.daoFactoryAddress,
    state.ensAddress,
    state.miniMeTokenFactoryAddress,
    state.aragonIDAddress,
    state.apmRegistryFactoryAddress
  ]

  log.splitter()

  await deployWithoutProxy('lidoTemplate', 'LidoTemplate', state.deployer, daoTemplateConstructorArgs)
  const daoTemplateDeployBlock = (await ethers.provider.getBlock('latest')).number

  await deployImplementation(`app:${APP_NAMES.LIDO}`, 'Lido', state.deployer)

  await deployImplementation(`app:${APP_NAMES.ORACLE}`, 'LegacyOracle', state.deployer)

  await deployImplementation(`app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`, 'NodeOperatorsRegistry', state.deployer)

  persistNetworkState2(network.name, netId, readNetworkState(network.name, netId), {
    lidoTemplate: {
      deployBlock: daoTemplateDeployBlock,
    }
  })

  log.splitter()
}

module.exports = runOrWrapScript(deployTemplate, module)
