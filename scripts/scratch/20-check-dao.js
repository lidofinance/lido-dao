const path = require('path')
const fs = require('fs')
const chalk = require('chalk')
const BN = require('bn.js')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { getEvents } = require('@aragon/contract-helpers-test')
const { hash: namehash } = require('eth-ens-namehash')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, yl } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { assertRole, assertMissingRole } = require('../helpers/aragon')
const { assertLastEvent, assertSingleEvent } = require('../helpers/events')
const { assert } = require('../helpers/assert')
const { percentToBP } = require('../helpers/index')
const { resolveEnsAddress } = require('../components/ens')
const { isAddress } = require('web3-utils')

const { APP_NAMES } = require('../constants')

const { assertAPMRegistryPermissions } = require('./checks/apm')
const { assertInstalledApps } = require('./checks/apps')
const { assertVesting } = require('./checks/dao-token')

const REQUIRED_NET_STATE = ['ens', 'lidoApmEnsName', 'daoAragonId', 'vestingParams', 'daoInitialSettings', 'lidoTemplate']

const TOKEN_TRANSFERABLE = true
const TOKEN_DECIMALS = 18
// uint256(-1)
const TOKEN_MAX_PER_ACCOUNT = '115792089237316195423570985008687907853269984665640564039457584007913129639935'
const FINANCE_DEFAULT_PERIOD = 60 * 60 * 24 * 30 // 30 days

const STETH_TOKEN_NAME = 'Liquid staked Ether 2.0'
const STETH_TOKEN_SYMBOL = 'stETH'
const STETH_TOKEN_DECIMALS = 18

const ZERO_WITHDRAWAL_CREDENTIALS = '0x0000000000000000000000000000000000000000000000000000000000000000'
const PROTOCOL_PAUSED_AFTER_DEPLOY = true
const OSSIFIABLE_PROXY = 'OssifiableProxy'
const ACCESS_CONTROL_ENUMERABLE = 'AccessControlEnumerable'

const DAO_LIVE = /^true|1$/i.test(process.env.DAO_LIVE)

async function checkDAO({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  log.splitter()
  log(`Network ID: ${yl(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const daoTemplateAddress = state.lidoTemplate.address

  log.splitter()

  log(`Using ENS:`, yl(state.ens.address))
  const ens = await artifacts.require('ENS').at(state.ens.address)

  log.splitter()

  log(`Using LidoTemplate: ${yl(daoTemplateAddress)}`)
  const template = await artifacts.require('LidoTemplate').at(daoTemplateAddress)
  if (state.lidoTemplate.deployBlock) {
    log(`Using LidoTemplate deploy block: ${chalk.yellow(state.lidoTemplate.deployBlock)}`)
  }
  await assertLastEvent(template, 'TmplDaoFinalized', null, state.lidoTemplate.deployBlock)

  const apmDeployedEvt = await assertSingleEvent(template, 'TmplAPMDeployed', null, state.lidoTemplate.deployBlock)
  const daoDeployedEvt = await assertSingleEvent(template, 'TmplDAOAndTokenDeployed', null, state.lidoTemplate.deployBlock)

  lidoApmAddress = apmDeployedEvt.args.apm
  daoAddress = daoDeployedEvt.args.dao
  daoTokenAddress = daoDeployedEvt.args.token

  log.splitter()

  log(`Using APMRegistry:`, yl(lidoApmAddress))
  const registry = await artifacts.require('APMRegistry').at(lidoApmAddress)

  log(`Using Kernel:`, yl(daoAddress))
  const dao = await artifacts.require('Kernel').at(daoAddress)

  log(`Using MiniMeToken:`, yl(daoTokenAddress))
  const daoToken = await artifacts.require('MiniMeToken').at(daoTokenAddress)

  log.splitter()

  const apps = await assertInstalledApps(
    {
      template,
      dao,
      lidoApmEnsName: state.lidoApmEnsName,
      appProxyUpgradeableArtifactName: 'external:AppProxyUpgradeable_DAO'
    },
    state.lidoTemplate.deployBlock
  )

  log.splitter()

  for (const appName of Object.keys(apps)) {
    const app = apps[appName]
    log(`Using ${yl(appName)} app proxy: ${yl(app.proxyAddress)}`)
    const key = `app:${appName}`
    state[key] = { ...state[key], ...app }
  }

  const [lido, legacyOracle, nopsRegistry, agent, finance, tokenManager, voting, burner, elRewardsVault, stakingRouter] = await Promise.all([
    artifacts.require('Lido').at(apps[APP_NAMES.LIDO].proxyAddress),
    artifacts.require('LegacyOracle').at(apps[APP_NAMES.ORACLE].proxyAddress),
    artifacts.require('NodeOperatorsRegistry').at(apps[APP_NAMES.NODE_OPERATORS_REGISTRY].proxyAddress),
    artifacts.require('Agent').at(apps[APP_NAMES.ARAGON_AGENT].proxyAddress),
    artifacts.require('Finance').at(apps[APP_NAMES.ARAGON_FINANCE].proxyAddress),
    artifacts.require('TokenManager').at(apps[APP_NAMES.ARAGON_TOKEN_MANAGER].proxyAddress),
    artifacts.require('Voting').at(apps[APP_NAMES.ARAGON_VOTING].proxyAddress),
    artifacts.require('Burner').at(state.burner.address),
    artifacts.require('LidoExecutionLayerRewardsVault').at(state.executionLayerRewardsVault["address"]),
    artifacts.require('StakingRouter').at(state.stakingRouter.proxy.address),
  ])

  log.splitter()

  await assertDAOConfig({
    ens,
    dao,
    daoToken,
    daoAragonId: state.daoAragonId,
    lido,
    legacyOracle,
    nopsRegistry,
    agent,
    finance,
    tokenManager,
    voting,
    burner,
    elRewardsVault,
    stakingRouter,
    state,
  })

  log.splitter()

  await assertAragonPermissions(
    {
      kernel: dao,
      lido,
      legacyOracle,
      nopsRegistry,
      agent,
      finance,
      tokenManager,
      voting,
      burner,
      stakingRouter,
    },
    state.lidoTemplate.deployBlock
  )

  log.splitter()

  const { registryACL } = await assertLidoAPMPermissions({ registry, votingAddress: voting.address }, state.lidoTemplate.deployBlock)

  log.splitter()

  await assertReposPermissions({ registry, registryACL, votingAddress: voting.address }, state.lidoTemplate.deployBlock)

  log.splitter()

  await assertVesting({
    tokenManager,
    token: daoToken,
    vestingParams: state.vestingParams,
    unvestedTokensManagerAddress: agent.address
  })

  log.splitter()

  const permissionsConfig = JSON.parse(fs.readFileSync('./scripts/scratch/checks/scratch-deploy-permissions.json'))
  if (state.depositSecurityModule.deployParameters.usePredefinedAddressInstead !== null) {
    delete permissionsConfig['depositSecurityModule']
  }
  await assertNonAragonPermissions(state, permissionsConfig)

  log.splitter()

  await assertHashConsensusMembers(state.hashConsensusForAccountingOracle.address, [])
  await assertHashConsensusMembers(state.hashConsensusForValidatorsExitBusOracle.address, [])

  console.log(`Total gas used during scratch deployment: ${state.initialDeployTotalGasUsed}`)
}

async function assertLidoAPMPermissions({ registry, votingAddress }, fromBlock = 4532202) {
  const [kernelAddress, registrarAddress] = await Promise.all([registry.kernel(), registry.registrar()])

  const [registryKernel, registrar] = await Promise.all([
    artifacts.require('Kernel').at(kernelAddress),
    artifacts.require('ENSSubdomainRegistrar').at(registrarAddress)
  ])

  const registryACLAddress = await registryKernel.acl()
  const registryACL = await artifacts.require('ACL').at(registryACLAddress)

  await assertAPMRegistryPermissions(
    {
      registry,
      registrar,
      registryACL,
      registryKernel,
      rootAddress: votingAddress
    },
    fromBlock
  )

  return { registryKernel, registryACL, registrar }
}

async function assertReposPermissions({ registry, registryACL, votingAddress }, fromBlock = 4532202) {
  const Repo = artifacts.require('Repo')
  const newRepoEvents = await registry.getPastEvents('NewRepo', { fromBlock })

  for (const evt of newRepoEvents) {
    const repoAddress = await Repo.at(evt.args.repo)
    const repoName = evt.args.name
    await assertRole(
      {
        acl: registryACL,
        app: repoAddress,
        appName: `repo<${evt.args.name}>`,
        roleName: 'CREATE_VERSION_ROLE',
        managerAddress: votingAddress,
        granteeAddress: votingAddress
      },
      fromBlock
    )
  }
}

async function assertDAOConfig({
  ens,
  dao,
  daoToken,
  daoAragonId,
  lido,
  legacyOracle,
  nopsRegistry,
  agent,
  finance,
  tokenManager,
  voting,
  burner,
  elRewardsVault,
  stakingRouter,
  state,
}) {
  const assertKernel = async (app, appName) => {
    assert.log(assert.addressEqual, await app.kernel(), dao.address, `${appName}.kernel is ${yl(dao.address)}`)
  }
  const settings = state.daoInitialSettings
  const chainSpec = state.chainSpec

  assert.log(
    assert.addressEqual,
    await resolveEnsAddress(artifacts, ens, namehash(`${daoAragonId}.aragonid.eth`)),
    dao.address,
    `Aragon ID ${yl(daoAragonId)} resolves to ${yl(dao.address)}`
  )

  log.splitter()

  assert.log(assert.addressEqual, await dao.getRecoveryVault(), agent.address, `dao.getRecoveryVault() is ${yl(agent.address)}`)

  log.splitter()

  assert.log(assert.equal, await daoToken.name(), settings.token.name, `daoToken.name is ${yl(settings.token.name)}`)

  assert.log(assert.equal, await daoToken.symbol(), settings.token.symbol, `daoToken.symbol is ${yl(settings.token.symbol)}`)

  assert.log(assert.bnEqual, await daoToken.decimals(), TOKEN_DECIMALS, `daoToken.decimals is ${yl(TOKEN_DECIMALS)}`)

  assert.log(assert.addressEqual, await daoToken.controller(), tokenManager.address, `daoToken.controller is ${yl(tokenManager.address)}`)

  assert.log(assert.equal, await daoToken.transfersEnabled(), TOKEN_TRANSFERABLE, `daoToken.transfersEnabled is ${yl(TOKEN_TRANSFERABLE)}`)

  log.splitter()
  await assertKernel(agent, 'agent')

  log.splitter()
  await assertKernel(voting, 'voting')

  assert.log(assert.addressEqual, await voting.token(), daoToken.address, `voting.token is ${yl(daoToken.address)}`)

  assert.log(
    assert.bnEqual,
    await voting.supportRequiredPct(),
    settings.voting.minSupportRequired,
    `voting.supportRequiredPct is ${yl(settings.voting.minSupportRequired)}`
  )

  assert.log(
    assert.bnEqual,
    await voting.minAcceptQuorumPct(),
    settings.voting.minAcceptanceQuorum,
    `voting.minAcceptQuorumPct is ${yl(settings.voting.minAcceptanceQuorum)}`
  )

  assert.log(
    assert.bnEqual,
    await voting.voteTime(),
    settings.voting.voteDuration,
    `voting.voteTime is ${yl(settings.voting.voteDuration)}`
  )

  DAO_LIVE || assert.log(assert.bnEqual, await voting.votesLength(), 0, `voting.votesLength is ${yl('0')}`)

  log.splitter()
  await assertKernel(tokenManager, 'tokenManager')

  assert.log(assert.addressEqual, await tokenManager.token(), daoToken.address, `tokenManager.token is ${yl(daoToken.address)}`)

  assert.log(
    assert.bnEqual,
    await tokenManager.maxAccountTokens(),
    TOKEN_MAX_PER_ACCOUNT,
    `tokenManager.maxAccountTokens is ${yl(TOKEN_MAX_PER_ACCOUNT)}`
  )

  log.splitter()
  await assertKernel(finance, 'finance')

  assert.log(
    assert.bnEqual,
    await finance.getPeriodDuration(),
    FINANCE_DEFAULT_PERIOD,
    `finance.getPeriodDuration() is ${yl(FINANCE_DEFAULT_PERIOD)}`
  )

  assert.log(assert.addressEqual, await finance.vault(), agent.address, `finance.vault is ${yl(agent.address)}`)

  log.splitter()
  await assertKernel(lido, 'lido')

  assert.log(assert.equal, await lido.name(), STETH_TOKEN_NAME, `lido.name is ${yl(STETH_TOKEN_NAME)}`)

  assert.log(assert.equal, await lido.symbol(), STETH_TOKEN_SYMBOL, `lido.symbol is ${yl(STETH_TOKEN_SYMBOL)}`)

  assert.log(assert.bnEqual, await lido.decimals(), STETH_TOKEN_DECIMALS, `lido.decimals is ${yl(STETH_TOKEN_DECIMALS)}`)

  // TODO
  // DAO_LIVE || assert.log(assert.bnEqual, await lido.totalSupply(), 0, `lido.totalSupply() is ${yl(0)}`)

  DAO_LIVE ||
    assert.log(assert.equal, await lido.isStopped(), PROTOCOL_PAUSED_AFTER_DEPLOY, `lido.isStopped is ${yl(PROTOCOL_PAUSED_AFTER_DEPLOY)}`)

  DAO_LIVE ||
    assert.log(
      assert.hexEqual,
      await lido.getWithdrawalCredentials(),
      `0x010000000000000000000000${state.withdrawalVault.address.slice(2)}`,
      `lido.getWithdrawalCredentials() is ${yl(await lido.getWithdrawalCredentials())}`
    )


  assert.log(
    assert.addressEqual,
    await stakingRouter.DEPOSIT_CONTRACT(),
    chainSpec.depositContract,
    `stakingRouter.DEPOSIT_CONTRACT() is ${yl(stakingRouter.DEPOSIT_CONTRACT())}`
  )

  assert.log(assert.addressEqual, await lido.getOracle(), legacyOracle.address, `lido.getOracle() is ${yl(legacyOracle.address)}`)


  assert.log(assert.addressEqual, await lido.getTreasury(), agent.address, `lido.getTreasury() is ${yl(agent.address)}`)

  log.splitter()
  await assertKernel(legacyOracle, 'oracle')

  assert.log(assert.addressEqual, await legacyOracle.getLido(), lido.address, `legacyOracle.getLido() is ${yl(lido.address)}`)

  const legacyOracleBeaconSpec = await legacyOracle.getBeaconSpec()
  assert.log(
    assert.bnEqual,
    legacyOracleBeaconSpec.slotsPerEpoch,
    chainSpec.slotsPerEpoch,
    `legacyOracle.getBeaconSpec().slotsPerEpoch is ${yl(chainSpec.slotsPerEpoch)}`
  )
  assert.log(
    assert.bnEqual,
    legacyOracleBeaconSpec.secondsPerSlot,
    chainSpec.secondsPerSlot,
    `legacyOracle.getBeaconSpec().secondsPerSlot is ${yl(chainSpec.secondsPerSlot)}`
  )
  assert.log(
    assert.bnEqual,
    legacyOracleBeaconSpec.genesisTime,
    chainSpec.genesisTime,
    `legacyOracle.getBeaconSpec().genesisTime is ${yl(chainSpec.genesisTime)}`
  )

  // DAO_LIVE || assert.log(assert.bnEqual, await legacyOracle.getQuorum(), 1, `oracle.getQuorum() is ${yl(1)}`)

  log.splitter()
  await assertKernel(nopsRegistry, 'nopsRegistry')

  DAO_LIVE || assert.log(assert.bnEqual, await nopsRegistry.getNodeOperatorsCount(), 0, `nopsRegistry.getNodeOperatorsCount() is ${yl(0)}`)

  DAO_LIVE ||
    assert.log(
      assert.bnEqual,
      await nopsRegistry.getActiveNodeOperatorsCount(),
      0,
      `nopsRegistry.getActiveNodeOperatorsCount() is ${yl(0)}`
    )
}

async function assertAragonPermissions({ kernel, lido, legacyOracle, nopsRegistry, agent, finance, tokenManager, voting, burner, stakingRouter }, fromBlock = 4532202) {
  const aclAddress = await kernel.acl()
  const acl = await artifacts.require('ACL').at(aclAddress)
  const allAclEvents = await acl.getPastEvents('allEvents', { fromBlock })

  const assertRoles = async ({ app, appName, groups, manager, missingRoleNames = [] }) => {
    for (const group of groups) {
      for (const roleName of group.roleNames) {
        await assertRole(
          {
            acl,
            allAclEvents,
            app,
            appName,
            roleName,
            granteeAddress: group.grantee.address,
            managerAddress: group.manager === undefined ? manager.address : group.manager.address,
            onlyGrantee: group.onlyGrantee === undefined ? true : group.onlyGrantee
          },
          fromBlock
        )
      }
    }
    for (const roleName of missingRoleNames) {
      await assertMissingRole({ acl, allAclEvents, app, appName, roleName }, fromBlock)
    }
  }

  await assertRole(
    {
      acl,
      allAclEvents,
      app: acl,
      appName: 'kernel.acl',
      roleName: 'CREATE_PERMISSIONS_ROLE',
      managerAddress: voting.address,
      granteeAddress: voting.address,
      onlyGrantee: true
    },
    fromBlock
  )

  await assertRole(
    {
      acl,
      allAclEvents,
      app: kernel,
      appName: 'kernel',
      roleName: 'APP_MANAGER_ROLE',
      managerAddress: voting.address,
      granteeAddress: voting.address,
      onlyGrantee: true
    },
    fromBlock
  )

  log.splitter()

  const evmScriptRegistryAddress = await acl.getEVMScriptRegistry()
  const evmScriptRegistry = await artifacts.require('EVMScriptRegistry').at(evmScriptRegistryAddress)

  await assertRoles({
    app: evmScriptRegistry,
    appName: 'evmScriptRegistry',
    manager: voting,
    groups: [
      {
        roleNames: ['REGISTRY_MANAGER_ROLE', 'REGISTRY_ADD_EXECUTOR_ROLE'],
        grantee: voting
      }
    ]
  })

  log.splitter()

  await assertRoles({
    app: agent,
    appName: 'agent',
    manager: voting,
    groups: [
      {
        roleNames: ['EXECUTE_ROLE', 'RUN_SCRIPT_ROLE'],
        grantee: voting
      }
    ],
    missingRoleNames: [
      'SAFE_EXECUTE_ROLE',
      'ADD_PROTECTED_TOKEN_ROLE',
      'REMOVE_PROTECTED_TOKEN_ROLE',
      'ADD_PRESIGNED_HASH_ROLE',
      'DESIGNATE_SIGNER_ROLE'
    ]
  })

  log.splitter()

  await assertRoles({
    app: finance,
    appName: 'finance',
    manager: voting,
    groups: [
      {
        roleNames: ['CREATE_PAYMENTS_ROLE', 'EXECUTE_PAYMENTS_ROLE', 'MANAGE_PAYMENTS_ROLE'],
        grantee: voting
      }
    ],
    missingRoleNames: ['CHANGE_PERIOD_ROLE', 'CHANGE_BUDGETS_ROLE']
  })

  log.splitter()

  await assertRoles({
    app: tokenManager,
    appName: 'tokenManager',
    manager: voting,
    groups: [
      {
        roleNames: ['ASSIGN_ROLE'],
        grantee: voting
      }
    ],
    missingRoleNames: ['MINT_ROLE', 'ISSUE_ROLE', 'REVOKE_VESTINGS_ROLE']
  })

  log.splitter()

  await assertRoles({
    app: voting,
    appName: 'voting',
    manager: voting,
    groups: [
      {
        roleNames: ['MODIFY_SUPPORT_ROLE', 'MODIFY_QUORUM_ROLE'],
        grantee: voting
      },
      {
        roleNames: ['CREATE_VOTES_ROLE'],
        grantee: tokenManager
      }
    ]
  })

  log.splitter()

  await assertRoles({
    app: lido,
    appName: 'lido',
    manager: voting,
    groups: [
      {
        roleNames: [
          'PAUSE_ROLE',
          'RESUME_ROLE',
          'STAKING_PAUSE_ROLE',
          'STAKING_CONTROL_ROLE',
          'UNSAFE_CHANGE_DEPOSITED_VALIDATORS_ROLE'
        ],
        grantee: voting
      }
    ]
  })

  log.splitter()

  await assertRoles({
    app: nopsRegistry,
    appName: 'nopsRegistry',
    manager: voting,
    groups: [
      {
        roleNames: [
          'MANAGE_SIGNING_KEYS',
          'SET_NODE_OPERATOR_LIMIT_ROLE'
        ],
        grantee: voting
      },
      {
        roleNames: [
          'STAKING_ROUTER_ROLE',
        ],
        grantee: stakingRouter
      }
    ]
  })
}

function addressFromStateField(state, fieldOrAddress) {
  if (isAddress(fieldOrAddress)) {
    return fieldOrAddress
  }

  if (state[fieldOrAddress] === undefined) {
    throw new Error(`There is no field "${fieldOrAddress}" in state`)
  }

  if (state[fieldOrAddress].address) {
    return state[fieldOrAddress].address
  } else if (state[fieldOrAddress].proxy.address) {
    return state[fieldOrAddress].proxy.address
  } else {
    throw new Error(`Cannot get address for contract field "${fieldOrAddress}" from state file`)
  }
}

function getRoleBytes32ByName(roleName) {
  if (roleName === 'DEFAULT_ADMIN_ROLE') {
    return '0x0000000000000000000000000000000000000000000000000000000000000000'
  } else {
    return web3.utils.keccak256(roleName)
  }
}

async function assertHashConsensusMembers(hashConsensusAddress, expectedMembers) {
  const hashConsensus = await artifacts.require('HashConsensus').at(hashConsensusAddress)
  const actualMembers = (await hashConsensus.getMembers()).addresses
  assert.log(
    assert.arrayOfAddressesEqual,
    actualMembers,
    expectedMembers,
    `HashConsensus ${hashConsensusAddress} members are expected: [${expectedMembers.toString()}]`
  )
}

async function assertNonAragonPermissions(state, permissionsConfig) {
  for (const [stateField, permissionTypes] of Object.entries(permissionsConfig)) {
    for (const [contractType, permissionParams] of Object.entries(permissionTypes)) {
      const contract = await artifacts.require(contractType).at(addressFromStateField(state, stateField))
      if (contractType == OSSIFIABLE_PROXY) {
        const actualAdmin = await contract.proxy__getAdmin()
        assert.log(
          assert.addressEqual,
          actualAdmin,
          addressFromStateField(state, permissionParams.admin),
          `${stateField} ${contractType} admin is ${actualAdmin}`
        )
      } else if (contractType == ACCESS_CONTROL_ENUMERABLE) {
        for (const [role, theHolders] of Object.entries(permissionParams.roles)) {
          const roleHash = getRoleBytes32ByName(role)
          const actualRoleMemberCount = await contract.getRoleMemberCount(roleHash)
          assert.log(
            assert.bnEqual,
            theHolders.length,
            actualRoleMemberCount,
            `Contract ${stateField} ${contractType} has correct number of ${role} holders`
          )
          for (const holder of theHolders) {
            assert.log(assert.equal, true,
              await contract.hasRole(roleHash, addressFromStateField(state, holder)),
              `Contract ${stateField} ${contractType} has role ${role} holer ${holder}`)
          }
        }
      } else if (permissionParams.specificViews !== undefined) {
        for (const [methodName, expectedValue] of Object.entries(permissionParams.specificViews)) {
          const actualValue = await contract[methodName].call()
          if (isAddress(actualValue)) {
            assert.log(
              assert.addressEqual,
              actualValue,
              addressFromStateField(state, expectedValue),
              `${stateField} ${contractType} ${methodName} is ${actualValue}`
            )
          } else {
            throw new Error(`Unsupported view ${methodName} result type of ${expectedValue} of contract ${stateField}`)
          }
        }
      } else {
        throw new Error(`Unsupported ACL contract type "${contractType}"`)
      }
    }
  }
}

module.exports = runOrWrapScript(checkDAO, module)
