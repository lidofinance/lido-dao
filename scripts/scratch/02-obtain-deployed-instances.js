const chalk = require('chalk')
const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logWideSplitter, logHeader } = require('../helpers/log')
const { assertDeployedBytecode } = require('../helpers/deploy')
const { assert } = require('../helpers/assert')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('../constants')
const { network } = require('hardhat')

const REQUIRED_NET_STATE = [
  'ens',
  'daoFactory',
  'miniMeTokenFactory',
  'aragonID',
  'apmRegistryFactory',
  'deployer',
  'lidoTemplate',
  `app:${APP_NAMES.LIDO}`,
  `app:${APP_NAMES.ORACLE}`,
  `app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`,
]

async function deployTemplate({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  logHeader('DAO template')
  {
    const daoTemplateAddress = state.lidoTemplate.address
    const daoTemplate = await artifacts.require('LidoTemplate').at(daoTemplateAddress)
    log(`Checking...`)
    await assertDeployedBytecode(daoTemplate.address, 'LidoTemplate')
    const templateConfig = await daoTemplate.getConfig()
    assert.addressEqual(templateConfig._owner, state.deployer, 'tmpl: owner')
    assert.addressEqual(templateConfig._daoFactory, state.daoFactory.address, 'tmpl: daoFactory')
    assert.addressEqual(templateConfig._ens, state.ens.address, 'tmpl: ens')
    assert.addressEqual(templateConfig._miniMeFactory, state.miniMeTokenFactory.address, 'tmpl: miniMeFactory')
    assert.addressEqual(templateConfig._aragonID, state.aragonID.address, 'tmpl: aragonId')
    assert.addressEqual(templateConfig._apmRegistryFactory, state.apmRegistryFactory.address, 'tmpl: apmRegistryFactory')
    log.success(`the config`)
  }

  logHeader('Lido app base')
  {
    const lidoBaseAddress = state[`app:${APP_NAMES.LIDO}`].implementation.address
    const lidoBase = await artifacts.require('Lido').at(lidoBaseAddress)
    log(`Checking...`)
    await assertDeployedBytecode(lidoBaseAddress, 'Lido')
    await assertAragonProxyBase(lidoBase, 'lidoBase')
  }

  logHeader('NodeOperatorsRegistry app base')
  {
    const nodeOperatorsRegistryBaseAddress = state[`app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`].implementation.address
    const nodeOperatorsRegistryBase = await artifacts.require('NodeOperatorsRegistry').at(nodeOperatorsRegistryBaseAddress)
    log(`Checking...`)
    await assertDeployedBytecode(nodeOperatorsRegistryBase.address, 'NodeOperatorsRegistry')
    await assertAragonProxyBase(nodeOperatorsRegistryBase, 'nodeOperatorsRegistryBase')
  }

  logHeader('LegacyOracle app base')
  {
    const legacyOracleBaseAddress = state[`app:${APP_NAMES.ORACLE}`].implementation.address
    const legacyOracleBase = await artifacts.require('LegacyOracle').at(legacyOracleBaseAddress)
    log(`Checking...`)
    await assertDeployedBytecode(legacyOracleBase.address, 'LegacyOracle')
    await assertAragonProxyBase(legacyOracleBase, 'legacyOracleBase')
  }
}

async function assertAragonProxyBase(instance, desc) {
  assert.equal(await instance.hasInitialized(), false, `${desc}: is not initialized`)
  assert.equal(await instance.isPetrified(), true, `${desc}: is petrified`)
  log.success(`is a petrified Aragon base`)
}

module.exports = runOrWrapScript(deployTemplate, module)
