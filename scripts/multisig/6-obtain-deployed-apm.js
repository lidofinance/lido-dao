const path = require('path')
const chalk = require('chalk')
const { assert } = require('chai')
const { getEvents } = require('@aragon/contract-helpers-test')
const { hash: namehash } = require('eth-ens-namehash')
const { toChecksumAddress } = require('web3-utils')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { readJSON } = require('../helpers/fs')
const { log, logSplitter, logWideSplitter, logHeader, logTx } = require('../helpers/log')
const { useOrGetDeployed, assertProxiedContractBytecode } = require('../helpers/deploy')
const {
  readNetworkState,
  persistNetworkState,
  assertRequiredNetworkState
} = require('../helpers/persisted-network-state')
const { getENSNodeOwner } = require('../components/ens')

const REQUIRED_NET_STATE = [
  'lidoApmDeployTx',
  'ensAddress',
  'lidoApmEnsName',
  'daoTemplateAddress'
]

const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'

async function obtainDeployedAPM({
  web3,
  artifacts,
  networkStateFile = NETWORK_STATE_FILE
}) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(networkStateFile, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  logSplitter()
  log(`Using LidoTemplate: ${chalk.yellow(state.daoTemplateAddress)}`)

  const registryAddress = await getRegistryAddress(state.lidoApmAddress, state.lidoApmDeployTx)

  logSplitter(`Checking...`)
  const registry = await artifacts.require('APMRegistry').at(registryAddress)

  const registryArtifact = await readJSON(path.join(__dirname, 'external-artifacts', 'APMRegistry.json'))
  const proxyArtifact = await readJSON(path.join(__dirname, 'external-artifacts', 'AppProxyUpgradeable.json'))
  await assertProxiedContractBytecode(registry.address, proxyArtifact, registryArtifact)

  const ensAddress = await registry.ens()
  assert.equal(ensAddress, state.ensAddress, 'APMRegistry ENS address')
  log.success(`registry.ens: ${chalk.yellow(ensAddress)}`)

  const registrarAddress = await registry.registrar()
  const registrar = await artifacts.require('ENSSubdomainRegistrar').at(registrarAddress)
  log.success(`registry.registrar: ${chalk.yellow(registrarAddress)}`)

  const registrarEnsAddress = await registrar.ens()
  assert.equal(registrarEnsAddress, state.ensAddress, 'ENSSubdomainRegistrar: ENS address')
  log.success(`registry.registrar.ens: ${chalk.yellow(registrarEnsAddress)}`)

  const rootNode = await registrar.rootNode()
  const lidoApmRootNode = namehash(state.lidoApmEnsName)
  assert.equal(rootNode, lidoApmRootNode, 'ENSSubdomainRegistrar: root node')
  log.success(`registry.registrar.rootNode: ${chalk.yellow(rootNode)}`)

  const ens = await artifacts.require('ENS').at(ensAddress)
  const rootNodeOwner = await getENSNodeOwner(ens, lidoApmRootNode)
  assert.equal(rootNodeOwner, registrarAddress, 'ENSSubdomainRegistrar: root node owner')
  log.success(`registry.registrar.rootNode owner: ${chalk.yellow(rootNodeOwner)}`)

  const registryKernelAddress = await registry.kernel()
  const registryKernel = await artifacts.require('Kernel').at(registryKernelAddress)
  log.success(`registry.kernel: ${chalk.yellow(registryKernelAddress)}`)

  const registryACLAddress = await registryKernel.acl()
  const registryACL = await artifacts.require('ACL').at(registryACLAddress)
  log.success(`registry.kernel.acl: ${chalk.yellow(registryACLAddress)}`)

  await assertRole({
    acl: registryACL,
    app: registry,
    appName: 'registry',
    roleName: 'CREATE_REPO_ROLE',
    managerAddress: state.daoTemplateAddress,
    granteeAddress: state.daoTemplateAddress,
  })

  await assertRole({
    acl: registryACL,
    app: registryKernel,
    appName: 'registry.kernel',
    roleName: 'APP_MANAGER_ROLE',
    managerAddress: state.daoTemplateAddress,
  })

  await assertRole({
    acl: registryACL,
    app: registryACL,
    appName: 'registry.kernel.acl',
    roleName: 'CREATE_PERMISSIONS_ROLE',
    managerAddress: state.daoTemplateAddress,
    granteeAddress: state.daoTemplateAddress,
  })

  const registrarKernelAddress = await registrar.kernel()
  assert.equal(registrarKernelAddress, registryKernelAddress, 'registrar kernel')
  log.success(`registrar.kernel: ${chalk.yellow(registrarKernelAddress)}`)

  await assertRole({
    acl: registryACL,
    app: registrar,
    appName: 'registrar',
    roleName: 'CREATE_NAME_ROLE',
    managerAddress: state.daoTemplateAddress,
    granteeAddress: registryAddress,
  })

  await assertRole({
    acl: registryACL,
    app: registrar,
    appName: 'registrar',
    roleName: 'POINT_ROOTNODE_ROLE',
    managerAddress: state.daoTemplateAddress,
    granteeAddress: registryAddress,
  })

  logSplitter()
  persistNetworkState(networkStateFile, netId, state, { lidoApmAddress: registryAddress })
}

async function getRegistryAddress(lidoApmAddress, lidoApmDeployTx) {
  if (!lidoApmAddress) {
    log(`Using transaction: ${chalk.yellow(lidoApmDeployTx)}`)

    const receipt = await web3.eth.getTransactionReceipt(lidoApmDeployTx)
    if (!receipt) {
      throw new Error(`transaction ${lidoApmDeployTx} not found`)
    }

    const { abi: registryFactoryABI } = await artifacts.readArtifact('APMRegistryFactory')

    const events = getEvents(receipt, 'DeployAPM', { decodeForAbi: registryFactoryABI })
    assert.equal(events.length, 1, 'the transaction has generated one DeployAPM event')

    lidoApmAddress = events[0].args.apm
  }

  log(`Using APMRegistry: ${chalk.yellow(lidoApmAddress)}`)

  return lidoApmAddress
}

async function assertRole({ roleName, acl, app, appName, managerAddress, granteeAddress }) {
  appName = appName || app.constructor

  assert.isTrue(
    managerAddress !== undefined || granteeAddress !== undefined,
    'empty assert: specify either managerAddress or granteeAddress'
  )

  const permission = await app[roleName]()
  const actualManagerAddress = await acl.getPermissionManager(app.address, permission)

  if (managerAddress !== undefined) {
    const desc = `${appName}.${chalk.yellow(roleName)} perm manager`
    assert.equal(toChecksumAddress(actualManagerAddress), toChecksumAddress(managerAddress), desc)
    log.success(`${desc}: ${chalk.yellow(actualManagerAddress)}`)
  }

  if (granteeAddress !== undefined) {
    const desc = `${appName}.${chalk.yellow(roleName)} perm is accessible by ${chalk.yellow(granteeAddress)}`
    assert.isTrue(await acl.hasPermission(granteeAddress, app.address, permission), desc)
    log.success(desc)
  }
}

module.exports = runOrWrapScript(obtainDeployedAPM, module)
