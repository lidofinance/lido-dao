const namehash = require('eth-ens-namehash').hash
const runOrWrapScript = require('./helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, logHeader, logTx, logDploy, yl } = require('./helpers/log')
const { readNetworkState, persistNetworkState, updateNetworkState } = require('./helpers/persisted-network-state')
const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'

const REQUIRED_NET_STATE = ['owner', 'ensAddress', 'lidoEnsNodeName', 'aragonEnsNodeName', 'app:voiting']
const LIDO_APP_NAMES = ['lido', 'oracle', 'node-operators-registry']
const ARAGON_APP_NAMES = ['agent', 'finance', 'token-manager', 'vault', 'voting']

const CREATE_VERSION_ROLE = '0x1f56cfecd3595a2e6cc1a7e6cb0b20df84cdbd92eff2fee554e70e4e45a9a7d8'
const CREATE_REPO_ROLE = '0x2a9494d64846c9fdbf0158785aa330d8bc9caf45af27fa0e8898eb4d55adcea6'
const APP_MANAGER_ROLE = '0xb6d92708f3d4817afc106147d969e229ced5c46e65e0a5002a0d391287762bd0'
const CREATE_PERMISSIONS_ROLE = '0x0b719b33c83b8e5d300c521cb8b54ae9bd933996a14bef8c2f4e0285d2d2400a'
const CREATE_NAME_ROLE = '0xf86bc2abe0919ab91ef714b2bec7c148d94f61fdb069b91a6cfe9ecdee1799ba'
const DELETE_NAME_ROLE = '0x03d74c8724218ad4a99859bcb2d846d39999449fd18013dd8d69096627e68622'
const POINT_ROOTNODE_ROLE = '0x9ecd0e7bddb2e241c41b595a436c4ea4fd33c9fa0caa8056acf084fc3aa3bfbe'

const APM_APP_NAME = 'apm-registry'
const REPO_APP_NAME = 'apm-repo'
const ENS_SUB_APP_NAME = 'apm-enssub'
async function repoPermissions({ web3, artifacts, networkStateFile = NETWORK_STATE_FILE }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${yl(netId)}`)

  const state = readNetworkState(network.name, netId)

  const missingState = REQUIRED_NET_STATE.filter((key) => !state[key])
  if (missingState.length) {
    const missingDesc = missingState.join(', ')
    throw new Error(`missing following fields from network state file, make sure you've run previous deployment steps: ${missingDesc}`)
  }

  log(`Owner: ${yl(state.owner)}`)

  const ens = await artifacts.require('ENS').at(state.ensAddress)
  log(`Using ENS: ${yl(ens.address)}`)

  logHeader(`Set DAO permissions`)

  const votingAddress = state['app:voting'].proxyAddress

  // Lido apps
  await setPermissions(artifacts, state.owner, ens, state.lidoEnsNodeName, votingAddress, LIDO_APP_NAMES)
  // Aragon apps
  await setPermissions(artifacts, state.owner, ens, state.aragonEnsNodeName, votingAddress, ARAGON_APP_NAMES)

  logSplitter()
}

async function setPermissions(artifacts, owner, ens, ensNodeName, votingAddress, apps = []) {
  log(`Fix permissions for: ${yl(ensNodeName)}`)
  const apmId = namehash(`${ensNodeName}`)
  const resolverAddress = await ens.resolver(apmId)
  const resolver = await artifacts.require('PublicResolver').at(resolverAddress)
  const apmAddress = await resolver.addr(apmId)
  const apm = await artifacts.require('APMRegistry').at(apmAddress)
  const registarAddress = await apm.registrar()

  const kernelAddress = await apm.kernel()
  const kernel = await artifacts.require('Kernel').at(kernelAddress)
  const aclAddress = await kernel.acl()
  const acl = await artifacts.require('ACL').at(aclAddress)

  log(`Transfer APM roles`)
  // lido apm
  if ((await acl.getPermissionManager(apmAddress, CREATE_REPO_ROLE)) === owner) {
    await transferPerm(acl, apmAddress, CREATE_REPO_ROLE, owner, votingAddress)
    log.success('Ready!')
  }

  log(`Transfer Kernel roles`)
  // lido apm kernel
  if ((await acl.getPermissionManager(kernelAddress, APP_MANAGER_ROLE)) === owner) {
    await logTx(
      `Wait TX for Kernel role setPermissionManager APP_MANAGER_ROLE`,
      acl.setPermissionManager(votingAddress, kernelAddress, APP_MANAGER_ROLE)
    )
    log.success('Ready!')
  }

  // lido acl
  log(`Transfer ACL roles`)
  if ((await acl.getPermissionManager(aclAddress, CREATE_PERMISSIONS_ROLE)) === owner) {
    log(`Transfer ACL roles:`)
    await transferPerm(acl, aclAddress, CREATE_PERMISSIONS_ROLE, owner, votingAddress)
    log.success('Ready!')
  }

  // lido registar
  log(`Transfer Registar roles`)
  if ((await acl.getPermissionManager(registarAddress, CREATE_NAME_ROLE)) === owner) {
    await logTx(
      `Wait TX for Registar role setPermissionManager CREATE_PERMISSIONS_ROLE`,
      acl.setPermissionManager(votingAddress, registarAddress, CREATE_NAME_ROLE)
    )
    log.success('Ready!')
  }

  if ((await acl.getPermissionManager(registarAddress, DELETE_NAME_ROLE)) === owner) {
    await logTx(
      `Wait TX for Registar role setPermissionManager DELETE_NAME_ROLE`,
      acl.setPermissionManager(votingAddress, registarAddress, DELETE_NAME_ROLE)
    )
    log.success('Ready!')
  }

  if ((await acl.getPermissionManager(registarAddress, POINT_ROOTNODE_ROLE)) === owner) {
    await logTx(
      `Wait TX for Registar role setPermissionManager POINT_ROOTNODE_ROLE`,
      logTx(`setPermissionManager`, acl.setPermissionManager(votingAddress, registarAddress, POINT_ROOTNODE_ROLE))
    )
    log.success('Ready!')
  }

  const appsAll = [APM_APP_NAME, REPO_APP_NAME, ENS_SUB_APP_NAME].concat(apps)
  for (const app of appsAll) {
    log(`Transfer ${app}.${ensNodeName} roles:`)
    const appId = namehash(`${app}.${ensNodeName}`)
    const repoAddress = await resolver.addr(appId)
    // const repo = await artifacts.require('Repo').at(repoAddress)
    if ((await acl.getPermissionManager(repoAddress, CREATE_VERSION_ROLE)) === owner) {
      await transferPerm(acl, repoAddress, CREATE_VERSION_ROLE, owner, votingAddress)
      log.success('transferred!')
    }
  }
}

async function transferPerm(acl, app, perm, owner, to) {
  await logTx(`Wait TX grantPermission`, acl.grantPermission(to, app, perm, { from: owner }))
  await logTx(`Wait TX revokePermission`, acl.revokePermission(owner, app, perm, { from: owner }))
  await logTx(`Wait TX setPermissionManager`, acl.setPermissionManager(to, app, perm, { from: owner }))
}

module.exports = runOrWrapScript(repoPermissions, module)
