const chalk = require('chalk')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log } = require('../helpers/log')
const { deployImplementation, deployWithoutProxy, TotalGasCounter } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')
const { APP_NAMES } = require('../constants')

const REQUIRED_NET_STATE = [
  'ens',
  'daoFactory',
  'miniMeTokenFactory',
  'aragonID',
  'apmRegistryFactory',
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
    state.daoFactory.address,
    state.ens.address,
    state.miniMeTokenFactory.address,
    state.aragonID.address,
    state.apmRegistryFactory.address
  ]

  log.splitter()

  await deployWithoutProxy('lidoTemplate', 'LidoTemplate', state.deployer, daoTemplateConstructorArgs)
  const daoTemplateDeployBlock = (await ethers.provider.getBlock('latest')).number

  await deployImplementation(`app:${APP_NAMES.LIDO}`, 'Lido', state.deployer)

  await deployImplementation(`app:${APP_NAMES.ORACLE}`, 'LegacyOracle', state.deployer)

  await deployImplementation(`app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`, 'NodeOperatorsRegistry', state.deployer)

  persistNetworkState(network.name, netId, readNetworkState(network.name, netId), {
    lidoTemplate: {
      deployBlock: daoTemplateDeployBlock,
    }
  })

  log.splitter()

  await TotalGasCounter.incrementTotalGasUsedInStateFile()
}

module.exports = runOrWrapScript(deployTemplate, module)
