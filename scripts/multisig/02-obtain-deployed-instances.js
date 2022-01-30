const chalk = require('chalk')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, logHeader, logTx } = require('../helpers/log')
const { useOrGetDeployed, assertDeployedBytecode, getTxBlock } = require('../helpers/deploy')
const { assert } = require('../helpers/assert')
const { readNetworkState, persistNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('./constants')

const REQUIRED_NET_STATE = [
  'ensAddress',
  'daoFactoryAddress',
  'miniMeTokenFactoryAddress',
  'aragonIDAddress',
  'apmRegistryFactoryAddress',
  'multisigAddress',
  'daoTemplateDeployTx',
  'lidoBaseDeployTx',
  'oracleBaseDeployTx',
  'nodeOperatorsRegistryBaseDeployTx'
]

async function deployTemplate({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  logHeader('DAO template')
  const { daoTemplate, daoTemplateDeployBlock } = await obtainTemplate(state)
  persistNetworkState(network.name, netId, state, { daoTemplate, daoTemplateDeployBlock })

  logHeader('Lido app base')
  const lidoBase = await useOrGetDeployed('Lido', state.lidoBaseAddress, state.lidoBaseDeployTx)
  log(`Checking...`)
  await assertDeployedBytecode(lidoBase.address, 'Lido')
  await assertAragonProxyBase(lidoBase, 'lidoBase')
  persistNetworkState(network.name, netId, state, {
    [`app:${APP_NAMES.LIDO}`]: {
      ...state[`app:${APP_NAMES.LIDO}`],
      baseAddress: lidoBase.address
    }
  })

  logHeader('LidoOracle app base')
  const oracleBase = await useOrGetDeployed('LidoOracle', state.oracleBaseAddress, state.oracleBaseDeployTx)
  log(`Checking...`)
  await assertDeployedBytecode(oracleBase.address, 'LidoOracle')
  await assertAragonProxyBase(oracleBase, 'oracleBase')
  persistNetworkState(network.name, netId, state, {
    [`app:${APP_NAMES.ORACLE}`]: {
      ...state[`app:${APP_NAMES.ORACLE}`],
      baseAddress: oracleBase.address
    }
  })

  logHeader('NodeOperatorsRegistry app base')
  const nodeOperatorsRegistryBase = await useOrGetDeployed(
    'NodeOperatorsRegistry',
    state.nodeOperatorsRegistryBaseAddress,
    state.nodeOperatorsRegistryBaseDeployTx
  )
  log(`Checking...`)
  await assertDeployedBytecode(nodeOperatorsRegistryBase.address, 'NodeOperatorsRegistry')
  await assertAragonProxyBase(nodeOperatorsRegistryBase, 'nodeOperatorsRegistryBase')
  persistNetworkState(network.name, netId, state, {
    [`app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`]: {
      ...state[`app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`],
      baseAddress: nodeOperatorsRegistryBase.address
    }
  })
}

async function obtainTemplate(state) {
  const daoTemplate = await useOrGetDeployed('LidoTemplate', state.daoTemplateAddress, state.daoTemplateDeployTx)
  const daoTemplateDeployBlock = await getTxBlock(state.daoTemplateDeployTx)
  log(`LidoTemplate deploy block: ${chalk.yellow(daoTemplateDeployBlock)}`)

  log(`Checking...`)
  await assertDeployedBytecode(daoTemplate.address, 'LidoTemplate')
  const templateConfig = await daoTemplate.getConfig()
  assert.addressEqual(templateConfig._owner, state.multisigAddress, 'tmpl: owner')
  assert.addressEqual(templateConfig._daoFactory, state.daoFactoryAddress, 'tmpl: daoFactory')
  assert.addressEqual(templateConfig._ens, state.ensAddress, 'tmpl: ens')
  assert.addressEqual(templateConfig._miniMeFactory, state.miniMeTokenFactoryAddress, 'tmpl: miniMeFactory')
  assert.addressEqual(templateConfig._aragonID, state.aragonIDAddress, 'tmpl: aragonId')
  assert.addressEqual(templateConfig._apmRegistryFactory, state.apmRegistryFactoryAddress, 'tmpl: apmRegistryFactory')
  log.success(`the config`)
  return { daoTemplate, daoTemplateDeployBlock }
}

async function assertAragonProxyBase(instance, desc) {
  assert.equal(await instance.hasInitialized(), false, `${desc}: is not initialized`)
  assert.equal(await instance.isPetrified(), true, `${desc}: is petrified`)
  log.success(`is a petrified Aragon base`)
}

module.exports = runOrWrapScript(deployTemplate, module)
