const chalk = require('chalk')
const { assert } = require('chai')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, logHeader, logTx } = require('../helpers/log')
const { useOrGetDeployed, assertDeployedBytecode } = require('../helpers/deploy')
const {
  readNetworkState,
  persistNetworkState,
  assertRequiredNetworkState
} = require('../helpers/persisted-network-state')

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

const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'

async function deployTemplate({
  web3,
  artifacts,
  networkStateFile = NETWORK_STATE_FILE
}) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(networkStateFile, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  logHeader('DAO template')
  const daoTemplate = await obtainTemplate(state)
  persistNetworkState(networkStateFile, netId, state, { daoTemplate })

  logHeader('Lido app base')
  const lidoBase = await useOrGetDeployed('Lido', state.lidoBaseAddress, state.lidoBaseDeployTx)
  log(`Checking...`)
  await assertDeployedBytecode(lidoBase.address, 'Lido')
  await assertAragonProxyBase(lidoBase, 'lidoBase')
  persistNetworkState(networkStateFile, netId, state, {
    'lido_app_lido': {
      ...state['lido_app_lido'],
      baseAddress: lidoBase.address
    }
  })

  logHeader('LidoOracle app base')
  const oracleBase = await useOrGetDeployed('LidoOracle', state.oracleBaseAddress, state.oracleBaseDeployTx)
  log(`Checking...`)
  await assertDeployedBytecode(oracleBase.address, 'LidoOracle')
  await assertAragonProxyBase(oracleBase, 'oracleBase')
  persistNetworkState(networkStateFile, netId, state, {
    'lido_app_lidooracle': {
      ...state['lido_app_lidooracle'],
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
  persistNetworkState(networkStateFile, netId, state, {
    'lido_app_node-operators-registry': {
      ...state['lido_app_node-operators-registry'],
      baseAddress: nodeOperatorsRegistryBase.address
    }
  })
}

async function obtainTemplate(state) {
  const daoTemplate = await useOrGetDeployed('LidoTemplate3', state.daoTemplateAddress, state.daoTemplateDeployTx)

  log(`Checking...`)
  await assertDeployedBytecode(daoTemplate.address, 'LidoTemplate3')

  const templateConfig = await daoTemplate.getConfig()
  assert.equal(templateConfig._owner, state.multisigAddress, 'tmpl: owner')
  assert.equal(templateConfig._daoFactory, state.daoFactoryAddress, 'tmpl: daoFactory')
  assert.equal(templateConfig._ens, state.ensAddress, 'tmpl: ens')
  assert.equal(templateConfig._miniMeFactory, state.miniMeTokenFactoryAddress, 'tmpl: miniMeFactory')
  assert.equal(templateConfig._aragonID, state.aragonIDAddress, 'tmpl: aragonId')
  assert.equal(templateConfig._apmRegistryFactory, state.apmRegistryFactoryAddress, 'tmpl: apmRegistryFactory')
  log.success(`the config`)

  return daoTemplate
}

async function assertAragonProxyBase(instance, desc) {
  assert.equal(await instance.hasInitialized(), false, `${desc}: is not initialized`)
  assert.equal(await instance.isPetrified(), true, `${desc}: is pertified`)
  log.success(`is a petrified Aragon base`)
}

module.exports = runOrWrapScript(deployTemplate, module)
