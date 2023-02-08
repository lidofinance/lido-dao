const chalk = require('chalk')
const namehash = require('eth-ens-namehash').hash
const keccak256 = require('js-sha3').keccak_256
const getAccounts = require('@aragon/os/scripts/helpers/get-accounts')

const runOrWrapScript = require('./helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, logHeader, logTx, logDeploy } = require('./helpers/log')
const { deploy, useOrDeploy, withArgs } = require('./helpers/deploy')
const { readNetworkState, persistNetworkState, updateNetworkState } = require('./helpers/persisted-network-state')

const { deployAPM } = require('./components/apm')
const { assignENSName } = require('./components/ens')

const OWNER = process.env.OWNER
const ARAGON_ENS_LABEL = process.env.ARAGON_ENS_LABEL || 'aragonpm'
const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'

const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

async function deployAragonEnv({ web3, artifacts, networkStateFile = NETWORK_STATE_FILE }) {
  const netId = await web3.eth.net.getId()
  const accounts = await getAccounts(web3)

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)

  if (state.owner) {
    const lowercaseOwner = state.owner.toLowerCase()
    if (!accounts.some((acc) => acc.toLowerCase() === lowercaseOwner)) {
      throw new Error(`owner account ${state.owner} is missing from provided accounts`)
    }
  } else {
    state.owner = accounts[0]
    log(`Setting owner to the first provided account: ${chalk.yellow(state.owner)}`)
  }

  if (!state.aragonEnsLabelName) {
    state.aragonEnsLabelName = ARAGON_ENS_LABEL
    log(`Using Aragon ENS label: ${state.aragonEnsLabelName}`)
  }

  logHeader(`ENS`)
  const ensResults = await useOrDeployENS({
    artifacts,
    owner: state.owner,
    ensAddress: state.ensAddress
  })
  updateNetworkState(state, ensResults)
  persistNetworkState(network.name, netId, state)

  logHeader(`DAO factory`)
  const daoFactoryResults = await useOrDeployDaoFactory({
    artifacts,
    owner: state.owner,
    daoFactoryAddress: state.daoFactoryAddress
  })
  updateNetworkState(state, daoFactoryResults)
  persistNetworkState(network.name, netId, state)

  logHeader(`APM registry factory`)
  const apmRegistryFactoryResults = await useOrDeployAPMRegistryFactory({
    artifacts,
    owner: state.owner,
    ens: ensResults.ens,
    daoFactory: daoFactoryResults.daoFactory,
    apmRegistryFactoryAddress: state.apmRegistryFactoryAddress,
    apmRegistryBaseAddress: state.apmRegistryBaseAddress,
    apmRepoBaseAddress: state.apmRepoBaseAddress,
    ensSubdomainRegistrarBaseAddress: state.ensSubdomainRegistrarBaseAddress
  })
  updateNetworkState(state, apmRegistryFactoryResults)
  persistNetworkState(network.name, netId, state)

  logHeader(`Aragon APM`)
  const apmResults = await deployAPM({
    web3,
    artifacts,
    owner: state.owner,
    labelName: state.aragonEnsLabelName,
    ens: ensResults.ens,
    apmRegistryFactory: apmRegistryFactoryResults.apmRegistryFactory,
    apmRegistryAddress: state.aragonApmRegistryAddress
  })
  updateNetworkState(state, {
    aragonApmRegistry: apmResults.apmRegistry,
    aragonEnsNodeName: apmResults.ensNodeName,
    aragonEnsNode: apmResults.ensNode
  })
  persistNetworkState(network.name, netId, state)

  logHeader(`MiniMeTokenFactory`)
  const tokenFactoryResults = await deployMiniMeTokenFactory({
    artifacts,
    owner: state.owner,
    miniMeTokenFactoryAddress: state.miniMeTokenFactoryAddress
  })
  updateNetworkState(state, tokenFactoryResults)
  persistNetworkState(network.name, netId, state)

  logHeader('AragonID')
  const aragonIDResults = await deployAragonID({
    artifacts,
    owner: state.owner,
    ens: ensResults.ens,
    aragonIDAddress: state.aragonIDAddress
  })
  updateNetworkState(state, aragonIDResults)
  persistNetworkState(network.name, netId, state)
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
  let daoFactoryResults
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
  const kernelBase = await useOrDeploy(
    'Kernel',
    artifacts,
    kernelBaseAddress,
    // immediately petrify
    withArgs(true, { from: owner })
  )

  const aclBase = await useOrDeploy('ACL', artifacts, aclBaseAddress, withArgs({ from: owner }))

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
