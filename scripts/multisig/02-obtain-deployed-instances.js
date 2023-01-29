const chalk = require('chalk')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, logHeader, logTx } = require('../helpers/log')
const { useOrGetDeployed, assertDeployedBytecode, getTxBlock } = require('../helpers/deploy')
const { assert } = require('../helpers/assert')
const { readNetworkState, persistNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('./constants')
const { network } = require('hardhat')

const REQUIRED_NET_STATE = [
  'ensAddress',
  'daoFactoryAddress',
  'miniMeTokenFactoryAddress',
  'aragonIDAddress',
  'apmRegistryFactoryAddress',
  'multisigAddress',
  'daoTemplateDeployTx',
  'lidoBaseDeployTx',
  'nodeOperatorsRegistryBaseDeployTx',
  'eip712StETHDeployTx',
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

  log('EIP712StETH')
  const eip712StETH = await useOrGetDeployed(
    'EIP712StETH',
    state.eip712StETHAddress,
    state.eip712StETHDeployTx
  )

  log(`Checking...`)
  await assertDeployedBytecode(eip712StETH.address, 'EIP712StETH')
  persistNetworkState(network.name, netId, state, {
    eip712StETHAddress: eip712StETH.address
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
