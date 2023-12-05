const chalk = require('chalk')
const namehash = require('eth-ens-namehash').hash
const keccak256 = require('js-sha3').keccak_256
const getAccounts = require('@aragon/os/scripts/helpers/get-accounts')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, logHeader, logTx } = require('../helpers/log')
const { deploy, useOrDeploy, withArgs, deployImplementation, TotalGasCounter } = require('../helpers/deploy')
const { readNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const { deployAPM } = require('../components/apm')
const { assignENSName } = require('../components/ens')

const ARAGON_ENS_LABEL = process.env.ARAGON_ENS_LABEL || 'aragonpm'
const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'

const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

async function deployAragonEnv({ web3, artifacts, networkStateFile = NETWORK_STATE_FILE }) {
  const netId = await web3.eth.net.getId()
  const accounts = await getAccounts(web3)

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  let state = readNetworkState(network.name, netId)

  if (state.deployer) {
    const lowercaseOwner = state.deployer.toLowerCase()
    if (!accounts.some((acc) => acc.toLowerCase() === lowercaseOwner)) {
      throw new Error(`owner account ${state.deployer} is missing from provided accounts`)
    }
  } else {
    state.deployer = accounts[0]
    log(`Setting owner to the first provided account: ${chalk.yellow(state.deployer)}`)
  }

  if (!state.aragonEnsLabelName) {
    state.aragonEnsLabelName = ARAGON_ENS_LABEL
    log(`Using Aragon ENS label: ${state.aragonEnsLabelName}`)
  }
  persistNetworkState(network.name, netId, state)

  logHeader(`ENS`)
  const { ens, ensFactory } = await useOrDeployENS({
    artifacts,
    owner: state.deployer,
    ensAddress: state.ensAddress,
  })
  state = readNetworkState(network.name, netId)
  state.ens = {
    address: ens.address,
    constructorArgs: ens.constructorArgs,
  }
  state.ensFactory = {
    address: ensFactory.address,
    constructorArgs: ensFactory.constructorArgs,
  }
  persistNetworkState(network.name, netId, state)

  logHeader(`DAO factory`)
  const { daoFactory, evmScriptRegistryFactory } = await useOrDeployDaoFactory({
    artifacts,
    owner: state.deployer,
    daoFactoryAddress: state.daoFactoryAddress
  })
  state = readNetworkState(network.name, netId)
  state.daoFactory = {
    address: daoFactory.address,
    constructorArgs: daoFactory.constructorArgs,
  }
  state.evmScriptRegistryFactory = {
    address: evmScriptRegistryFactory.address,
    constructorArgs: evmScriptRegistryFactory.constructorArgs,
  }
  persistNetworkState(network.name, netId, state)

  logHeader(`APM registry factory`)
  const {
    apmRegistryBase,
    apmRepoBase,
    ensSubdomainRegistrarBase,
    apmRegistryFactory
  } = await useOrDeployAPMRegistryFactory({
    artifacts,
    owner: state.deployer,
    ens: ens,
    daoFactory: daoFactory,
    apmRegistryFactoryAddress: state.apmRegistryFactoryAddress,
    apmRegistryBaseAddress: state.apmRegistryBaseAddress,
    apmRepoBaseAddress: state.apmRepoBaseAddress,
    ensSubdomainRegistrarBaseAddress: state.ensSubdomainRegistrarBaseAddress,
  })
  state = readNetworkState(network.name, netId)
  state.apmRegistry = {
    implementation: {
      address: apmRegistryBase,
    },
  }
  state.apmRepo = {
    implementation: {
      address: apmRepoBase.address,
      constructorArgs: apmRepoBase.constructorArgs,
    },
  }
  state.ensSubdomainRegistrar = {
    implementation: {
      address: ensSubdomainRegistrarBase.address,
      constructorArgs: ensSubdomainRegistrarBase.constructorArgs,
    },
  }
  state.apmRegistryFactory = {
    address: apmRegistryFactory.address,
    constructorArgs: apmRegistryFactory.constructorArgs,
  }
  persistNetworkState(network.name, netId, state)

  logHeader(`Aragon APM`)
  const {
    apmRegistry,
    ensNodeName,
    ensNode,
  } = await deployAPM({
    web3,
    artifacts,
    owner: state.deployer,
    labelName: state.aragonEnsLabelName,
    ens: ens,
    apmRegistryFactory: apmRegistryFactory,
    apmRegistryAddress: state.aragonApmRegistryAddress
  })
  state = readNetworkState(network.name, netId)
  state.ensNode = {
    nodeName: ensNodeName,
    nodeId: ensNode,
  }
  state.apmRegistry = {
    proxy: {
      address: apmRegistry.address,
    },
  }
  persistNetworkState(network.name, netId, state)

  logHeader(`MiniMeTokenFactory`)
  const { miniMeTokenFactory } = await deployMiniMeTokenFactory({
    artifacts,
    owner: state.deployer,
    miniMeTokenFactoryAddress: state.miniMeTokenFactoryAddress
  })
  state = readNetworkState(network.name, netId)
  state.miniMeTokenFactory = {
    address: miniMeTokenFactory.address,
    constructorArgs: miniMeTokenFactory.constructorArgs,
  }
  persistNetworkState(network.name, netId, state)

  logHeader('AragonID')
  const { aragonID } = await deployAragonID({
    artifacts,
    owner: state.deployer,
    ens: ens,
    aragonIDAddress: state.aragonIDAddress
  })
  state = readNetworkState(network.name, netId)
  state.aragonID = {
    address: aragonID.address,
    constructorArgs: aragonID.constructorArgs,
  }
  persistNetworkState(network.name, netId, state)

  await TotalGasCounter.incrementTotalGasUsedInStateFile()
}

async function useOrDeployENS({ artifacts, owner, ensAddress }) {
  if (!ensAddress) {
    return await deployENS({ artifacts, owner })
  } else {
    const ENS = artifacts.require('ENS')
    logSplitter()
    log(`Using ENS: ${chalk.yellow(ensAddress)}`)
    return {
      ens: await ENS.at(ensAddress)
    }
  }
}

async function deployENS({ artifacts, owner }) {
  const ENS = artifacts.require('ENS')

  const factory = await deploy(`ENSFactory`, artifacts, withArgs({ from: owner }))
  const result = await logTx(`Creating ENS`, factory.newENS(owner, { from: owner }))

  const ensAddr = result.logs.filter((l) => l.event === 'DeployENS')[0].args.ens
  log(`ENS address: ${chalk.yellow(ensAddr)}`)

  return {
    ens: await ENS.at(ensAddr),
    ensFactory: factory
  }
}

async function useOrDeployDaoFactory({ artifacts, owner, daoFactoryAddress }) {
  let daoFactory
  if (daoFactoryAddress) {
    daoFactory = await artifacts.require('DAOFactory').at(daoFactoryAddress)
    const hasEVMScripts = (await daoFactory.regFactory()) !== ZERO_ADDR
    log(`Using DAOFactory (with${hasEVMScripts ? '' : 'out'} EVMScripts): ${chalk.yellow(daoFactoryAddress)}`)
    return { daoFactory }
  } else {
    log(`Deploying DAOFactory with EVMScripts...`)
    return await deployDAOFactory({ artifacts, owner, withEvmScriptRegistryFactory: true })
  }
}

async function useOrDeployAPMRegistryFactory({
  artifacts,
  owner,
  ens,
  daoFactory,
  apmRegistryFactoryAddress,
  apmRegistryBaseAddress,
  apmRepoBaseAddress,
  ensSubdomainRegistrarBaseAddress
}) {
  const apmRegistryBase = await useOrDeploy('APMRegistry', artifacts, apmRegistryBaseAddress)
  const apmRepoBase = await useOrDeploy('Repo', artifacts, apmRepoBaseAddress)
  const ensSubdomainRegistrarBase = await useOrDeploy('ENSSubdomainRegistrar', artifacts, ensSubdomainRegistrarBaseAddress)
  const apmRegistryFactory = await useOrDeploy(
    'APMRegistryFactory',
    artifacts,
    apmRegistryFactoryAddress,
    withArgs(daoFactory.address, apmRegistryBase.address, apmRepoBase.address, ensSubdomainRegistrarBase.address, ens.address, ZERO_ADDR, {
      from: owner
    })
  )
  return { apmRegistryBase, apmRepoBase, ensSubdomainRegistrarBase, apmRegistryFactory }
}

async function deployDAOFactory({ artifacts, owner, kernelBaseAddress, aclBaseAddress, withEvmScriptRegistryFactory }) {
  const kernelBase = await deployImplementation('aragon-kernel', 'Kernel', owner, [true])

  const aclBase = await deployImplementation('aragon-acl', 'ACL', owner)

  const evmScriptRegistryFactory = withEvmScriptRegistryFactory
    ? await deploy('EVMScriptRegistryFactory', artifacts, withArgs({ from: owner }))
    : undefined

  const daoFactory = await deploy(
    'DAOFactory',
    artifacts,
    withArgs(kernelBase.address, aclBase.address, evmScriptRegistryFactory ? evmScriptRegistryFactory.address : ZERO_ADDR, { from: owner })
  )

  return {
    kernelBase,
    aclBase,
    ...(evmScriptRegistryFactory ? { evmScriptRegistryFactory } : null),
    daoFactory
  }
}

async function deployMiniMeTokenFactory({ artifacts, owner, miniMeTokenFactoryAddress }) {
  const factory = await useOrDeploy('MiniMeTokenFactory', artifacts, miniMeTokenFactoryAddress, withArgs({ from: owner }))
  return { miniMeTokenFactory: factory }
}

async function deployAragonID({ artifacts, owner, ens, aragonIDAddress }) {
  const FIFSResolvingRegistrar = artifacts.require('FIFSResolvingRegistrar')
  if (aragonIDAddress != null) {
    log(`Using FIFSResolvingRegistrar: ${chalk.yellow(aragonIDAddress)}`)
    return {
      aragonID: await FIFSResolvingRegistrar.at(aragonIDAddress)
    }
  }

  const publicNode = namehash('resolver.eth')
  const publicResolverAddress = await ens.resolver(publicNode)
  log(`Using public resolver: ${chalk.yellow(publicResolverAddress)}`)

  const nodeName = 'aragonid.eth'
  const node = namehash(nodeName)
  log(`ENS node: ${chalk.yellow(nodeName)} (${node})`)

  const aragonID = await deploy('FIFSResolvingRegistrar', artifacts, withArgs(ens.address, publicResolverAddress, node, { from: owner }))

  logSplitter()
  await assignENSName({
    parentName: 'eth',
    labelName: 'aragonid',
    assigneeAddress: aragonID.address,
    assigneeDesc: 'AragonID',
    owner,
    ens
  })

  logSplitter()
  await logTx(`Assigning owner name`, aragonID.register('0x' + keccak256('owner'), owner, { from: owner }))

  return { aragonID, aragonIDEnsNodeName: nodeName, aragonIDEnsNode: node }
}

module.exports = runOrWrapScript(deployAragonEnv, module)
