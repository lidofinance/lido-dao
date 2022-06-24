const chalk = require('chalk')
const { getEvents } = require('@aragon/contract-helpers-test')
const { hash: namehash } = require('eth-ens-namehash')
const { toChecksumAddress } = require('web3-utils')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { loadArtifact } = require('../helpers/artifacts')
const { log } = require('../helpers/log')
const { assert } = require('../helpers/assert')
const { assertProxiedContractBytecode } = require('../helpers/deploy')
const { assertLastEvent } = require('../helpers/events')
const { readNetworkState, persistNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { getENSNodeOwner } = require('../components/ens')

const { assertAPMRegistryPermissions } = require('./checks/apm')

const REQUIRED_NET_STATE = ['ensAddress', 'lidoApmEnsName', 'daoTemplateAddress']

async function obtainDeployedAPM({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  log.wideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  log.splitter()

  log(`Using LidoTemplate: ${chalk.yellow(state.daoTemplateAddress)}`)
  const template = await artifacts.require('LidoTemplate').at(state.daoTemplateAddress)

  if (state.daoTemplateDeployBlock) {
    log(`Using LidoTemplate deploy block: ${chalk.yellow(state.daoTemplateDeployBlock)}`)
  }

  // if (!state.lidoApmDeployTx) {
  const apmDeployedEvt = await assertLastEvent(template, 'TmplAPMDeployed', null, state.daoTemplateDeployBlock)
  state.lidoApmDeployTx = apmDeployedEvt.transactionHash
  // }
  log(`Using deployLidoAPM transaction: ${chalk.yellow(state.lidoApmDeployTx)}`)
  persistNetworkState(network.name, netId, state)

  const registryAddress = apmDeployedEvt.args.apm
  log.splitter(`Using APMRegistry: ${chalk.yellow(registryAddress)}`)

  const registry = await artifacts.require('APMRegistry').at(registryAddress)

  const registryArtifact = await loadArtifact('external:APMRegistry', network.name)
  const proxyArtifact = await loadArtifact('external:AppProxyUpgradeable_APM', network.name)
  await assertProxiedContractBytecode(registry.address, proxyArtifact, registryArtifact)

  const ensAddress = await registry.ens()
  assert.addressEqual(ensAddress, state.ensAddress, 'APMRegistry ENS address')
  log.success(`registry.ens: ${chalk.yellow(ensAddress)}`)

  const registrarAddress = await registry.registrar()
  const registrar = await artifacts.require('ENSSubdomainRegistrar').at(registrarAddress)
  log.success(`registry.registrar: ${chalk.yellow(registrarAddress)}`)

  const registrarEnsAddress = await registrar.ens()
  assert.addressEqual(registrarEnsAddress, state.ensAddress, 'ENSSubdomainRegistrar: ENS address')
  log.success(`registry.registrar.ens: ${chalk.yellow(registrarEnsAddress)}`)

  const rootNode = await registrar.rootNode()
  const lidoApmRootNode = namehash(state.lidoApmEnsName)
  assert.equal(rootNode, lidoApmRootNode, 'ENSSubdomainRegistrar: root node')
  log.success(`registry.registrar.rootNode: ${chalk.yellow(rootNode)}`)

  const ens = await artifacts.require('ENS').at(ensAddress)
  const rootNodeOwner = await getENSNodeOwner(ens, lidoApmRootNode)
  assert.addressEqual(rootNodeOwner, registrarAddress, 'ENSSubdomainRegistrar: root node owner')
  log.success(`registry.registrar.rootNode owner: ${chalk.yellow(rootNodeOwner)}`)

  const registryKernelAddress = await registry.kernel()
  const registryKernel = await artifacts.require('Kernel').at(registryKernelAddress)
  log.success(`registry.kernel: ${chalk.yellow(registryKernelAddress)}`)

  const registryACLAddress = await registryKernel.acl()
  const registryACL = await artifacts.require('ACL').at(registryACLAddress)
  log.success(`registry.kernel.acl: ${chalk.yellow(registryACLAddress)}`)

  const registrarKernelAddress = await registrar.kernel()
  assert.addressEqual(registrarKernelAddress, registryKernelAddress, 'registrar kernel')
  log.success(`registry.registrar.kernel: ${chalk.yellow(registrarKernelAddress)}`)

  await assertAPMRegistryPermissions(
    {
      registry,
      registrar,
      registryACL,
      registryKernel,
      rootAddress: state.daoTemplateAddress
    },
    state.daoTemplateDeployBlock
  )

  log.splitter()
  persistNetworkState(network.name, netId, state, { lidoApmAddress: registryAddress })
}

module.exports = runOrWrapScript(obtainDeployedAPM, module)
