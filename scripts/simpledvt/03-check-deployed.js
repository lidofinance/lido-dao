const { network } = require('hardhat')
const chalk = require('chalk')
const { assert } = require('chai')
const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, yl } = require('../helpers/log')
const {
  readStateAppAddress,
  MANAGE_SIGNING_KEYS,
  MANAGE_NODE_OPERATOR_ROLE,
  SET_NODE_OPERATOR_LIMIT_ROLE,
  STAKING_ROUTER_ROLE,
  STAKING_MODULE_MANAGE_ROLE,
  SIMPLE_DVT_IPFS_CID,
} = require('./helpers')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { hash: namehash } = require('eth-ens-namehash')
const { resolveLatestVersion } = require('../components/apm')
const { APP_NAMES, APP_ARTIFACTS } = require('../constants')

const APP_TRG = process.env.APP_TRG || 'simple-dvt'
const APP_IPFS_CID = process.env.APP_IPFS_CID || SIMPLE_DVT_IPFS_CID

const REQUIRED_NET_STATE = [
  'ensAddress',
  'lidoApmAddress',
  'lidoApmEnsName',
  'daoAddress',
  'lidoLocator',
  `app:${APP_NAMES.ARAGON_VOTING}`,
  `app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`,
]

function _checkEq(a, b, descr = '') {
  assert.equal(a, b, descr)
  log.success(descr)
}

async function deployNORClone({ web3, artifacts, trgAppName = APP_TRG, ipfsCid = APP_IPFS_CID }) {
  const netId = await web3.eth.net.getId()

  log.splitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE.concat([`app:${trgAppName}`]))

  log.splitter()

  log(`Using ENS:`, yl(state.ensAddress))
  const ens = await artifacts.require('ENS').at(state.ensAddress)
  const lidoLocatorAddress = readStateAppAddress(state, `lidoLocator`)
  log(`Lido Locator:`, yl(lidoLocatorAddress))
  log.splitter()

  const srcAppName = APP_NAMES.NODE_OPERATORS_REGISTRY
  const srcAppFullName = `${srcAppName}.${state.lidoApmEnsName}`
  const srcAppId = namehash(srcAppFullName)
  const { contractAddress: srcContractAddress } = await resolveLatestVersion(srcAppId, ens, artifacts)

  const trgAppFullName = `${trgAppName}.${state.lidoApmEnsName}`
  const trgAppId = namehash(trgAppFullName)

  const { semanticVersion, contractAddress, contentURI } = await resolveLatestVersion(trgAppId, ens, artifacts)

  _checkEq(contractAddress, srcContractAddress, 'App APM repo last version: implementation is the same to NOR')
  _checkEq(
    contentURI,
    '0x' + Buffer.from(`ipfs:${ipfsCid}`, 'utf8').toString('hex'),
    'App APM repo last version: IPFS CIT correct'
  )
  _checkEq(semanticVersion.map((x) => x.toNumber()).join(''), '100', 'App APM repo last version: app version = 1.0.0')

  const trgProxyAddress = readStateAppAddress(state, `app:${trgAppName}`)
  const trgAppArtifact = APP_ARTIFACTS[srcAppName] // get source app artifact
  const trgApp = await artifacts.require(trgAppArtifact).at(trgProxyAddress)
  const { moduleType, penaltyDelay } = state[`app:${trgAppName}`].stakingRouterModuleParams

  _checkEq(await trgApp.appId(), trgAppId, 'App Contract: AppID correct')
  _checkEq(await trgApp.kernel(), state.daoAddress, 'App Contract: kernel address correct')
  _checkEq(await trgApp.hasInitialized(), true, 'App Contract: initialized')
  _checkEq(await trgApp.getLocator(), lidoLocatorAddress, 'App Contract: Locator address correct')

  log.splitter()
  const kernel = await artifacts.require('Kernel').at(state.daoAddress)
  const aclAddress = await kernel.acl()
  const acl = await artifacts.require('ACL').at(aclAddress)
  const agentAddress = readStateAppAddress(state, `app:${APP_NAMES.ARAGON_AGENT}`)
  const votingAddress = readStateAppAddress(state, `app:${APP_NAMES.ARAGON_VOTING}`)
  const srAddress = readStateAppAddress(state, 'stakingRouter')
  const stakingRouter = await artifacts.require('StakingRouter').at(srAddress)

  _checkEq(
    await stakingRouter.hasRole(STAKING_MODULE_MANAGE_ROLE, agentAddress),
    true,
    'Agent has rolw: STAKING_MODULE_MANAGE_ROLE'
  )

  _checkEq(
    await acl.getPermissionManager(trgProxyAddress, MANAGE_SIGNING_KEYS),
    votingAddress,
    'Voting is permission manager: MANAGE_SIGNING_KEYS'
  )
  _checkEq(
    await acl.getPermissionManager(trgProxyAddress, MANAGE_NODE_OPERATOR_ROLE),
    votingAddress,
    'Voting is permission manager: MANAGE_NODE_OPERATOR_ROLE'
  )
  _checkEq(
    await acl.getPermissionManager(trgProxyAddress, SET_NODE_OPERATOR_LIMIT_ROLE),
    votingAddress,
    'Voting is permission manager: SET_NODE_OPERATOR_LIMIT_ROLE'
  )
  _checkEq(
    await acl.getPermissionManager(trgProxyAddress, STAKING_ROUTER_ROLE),
    votingAddress,
    'Voting is permission manager: STAKING_ROUTER_ROLE'
  )

  _checkEq(
    await acl.hasPermission(votingAddress, trgProxyAddress, MANAGE_SIGNING_KEYS),
    true,
    'Voting has permission: MANAGE_SIGNING_KEYS'
  )
  _checkEq(
    await acl.hasPermission(votingAddress, trgProxyAddress, MANAGE_NODE_OPERATOR_ROLE),
    true,
    'Voting has permission: MANAGE_NODE_OPERATOR_ROLE'
  )
  _checkEq(
    await acl.hasPermission(votingAddress, trgProxyAddress, SET_NODE_OPERATOR_LIMIT_ROLE),
    true,
    'Voting has permission: MANAGE_SIGNING_KEYS'
  )
  _checkEq(
    await acl.hasPermission(srAddress, trgProxyAddress, STAKING_ROUTER_ROLE),
    true,
    'StakingRouter has permission: STAKING_ROUTER_ROLE'
  )

  if (state.managerAddress) {
    _checkEq(
      await acl.hasPermission(state.managerAddress, trgProxyAddress, MANAGE_SIGNING_KEYS),
      true,
      'Module Manager has permission: MANAGE_SIGNING_KEYS'
    )
    _checkEq(
      await acl.hasPermission(state.managerAddress, trgProxyAddress, MANAGE_NODE_OPERATOR_ROLE),
      true,
      'Module Manager has permission: MANAGE_NODE_OPERATOR_ROLE'
    )
    _checkEq(
      await acl.hasPermission(state.managerAddress, trgProxyAddress, SET_NODE_OPERATOR_LIMIT_ROLE),
      true,
      'Module Manager has permission: MANAGE_SIGNING_KEYS'
    )
  } else {
    log(yl('[-]'), 'No additional app manager address set - skip!')
  }
  if (state.easytrackAddress) {
    _checkEq(
      await acl.hasPermission(state.easytrackAddress, trgProxyAddress, SET_NODE_OPERATOR_LIMIT_ROLE),
      true,
      'Easytrack has permission: SET_NODE_OPERATOR_LIMIT_ROLE'
    )
  } else {
    log(yl('[-]'), 'No Easytrack address set - skip!')
  }

  log.splitter()

  _checkEq(await stakingRouter.getStakingModulesCount(), 2, 'StakingRouter: modules count = 2')
  const srModuleId = 2
  _checkEq(
    await stakingRouter.hasStakingModule(srModuleId),
    true,
    `StakingRouter: expected moduleId = ${srModuleId} exists`
  )

  const { moduleName, targetShare, moduleFee, treasuryFee } = state[`app:${trgAppName}`].stakingRouterModuleParams
  const srModule = await stakingRouter.getStakingModule(srModuleId)
  _checkEq(srModule.name, moduleName, `StakingRouter module: name = ${trgAppName}`)
  _checkEq(srModule.stakingModuleAddress, trgProxyAddress, `StakingRouter module: address correct`)
  _checkEq(srModule.treasuryFee, treasuryFee, `StakingRouter module: treasuryFee = ${treasuryFee}`)
  _checkEq(srModule.stakingModuleFee, moduleFee, `StakingRouter module: moduleFee = ${moduleFee}`)
  _checkEq(srModule.targetShare, targetShare, `StakingRouter module: targetShare = ${targetShare}`)

  log.splitter()

  _checkEq(await trgApp.getStuckPenaltyDelay(), penaltyDelay, `App params: penalty delay = ${penaltyDelay}`)
  _checkEq(
    await trgApp.getType(),
    '0x' + Buffer.from(moduleType).toString('hex').padEnd(64, '0'),
    `App params: module type = ${moduleType}`
  )

  _checkEq(await trgApp.getNodeOperatorsCount(), 0, `App initial values: no any operators (count = 0)`)
  _checkEq(await trgApp.getActiveNodeOperatorsCount(), 0, `App initial values: no active operators (count = 0)`)
  _checkEq(await trgApp.getNonce(), 0, `App initial values: nonce (keysOpIndex) = 0`)

  const { totalExitedValidators, totalDepositedValidators, depositableValidatorsCount } =
    await trgApp.getStakingModuleSummary()
  // console.log({ totalExitedValidators, totalDepositedValidators, depositableValidatorsCount })
  _checkEq(totalExitedValidators, 0, `App initial values: totalExitedValidators = 0`)
  _checkEq(totalDepositedValidators, 0, `App initial values: totalDepositedValidators = 0`)
  _checkEq(depositableValidatorsCount, 0, `App initial values: depositableValidatorsCount = 0`)

  log.splitter()
}

module.exports = runOrWrapScript(deployNORClone, module)
