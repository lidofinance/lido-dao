const path = require('path')
const chalk = require('chalk')
const BN = require('bn.js')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { getEvents } = require('@aragon/contract-helpers-test')
const { hash: namehash } = require('eth-ens-namehash')
const { toChecksumAddress } = require('web3-utils')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, yl } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { assertRole, assertMissingRole } = require('../helpers/aragon')
const { assertLastEvent, assertSingleEvent } = require('../helpers/events')
const { assert } = require('../helpers/assert')
const { percentToBP } = require('../helpers/index')
const { resolveEnsAddress } = require('../components/ens')

const { APP_NAMES } = require('./constants')

const { assertAPMRegistryPermissions } = require('./checks/apm')
const { assertInstalledApps } = require('./checks/apps')
const { assertVesting } = require('./checks/dao-token')

const REQUIRED_NET_STATE = ['ensAddress', 'lidoApmEnsName', 'daoAragonId', 'vestingParams', 'daoInitialSettings', 'daoTemplateAddress']

const TOKEN_TRANSFERABLE = true
const TOKEN_DECIMALS = 18
// uint256(-1)
const TOKEN_MAX_PER_ACCOUNT = '115792089237316195423570985008687907853269984665640564039457584007913129639935'
const FINANCE_DEFAULT_PERIOD = 60 * 60 * 24 * 30 // 30 days

const STETH_TOKEN_NAME = 'Liquid staked Ether 2.0'
const STETH_TOKEN_SYMBOL = 'stETH'
const STETH_TOKEN_DECIMALS = 18

const ZERO_WITHDRAWAL_CREDS = '0x0000000000000000000000000000000000000000000000000000000000000000'
const PROTOCOL_PAUSED_AFTER_DEPLOY = true

const DAO_LIVE = /^true|1$/i.test(process.env.DAO_LIVE)

async function checkDAO({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  log.splitter()
  log(`Network ID: ${yl(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  log.splitter()

  log(`Using ENS:`, yl(state.ensAddress))
  const ens = await artifacts.require('ENS').at(state.ensAddress)

  log.splitter()

  log(`Using LidoTemplate: ${yl(state.daoTemplateAddress)}`)
  const template = await artifacts.require('LidoTemplate').at(state.daoTemplateAddress)
  if (state.daoTemplateDeployBlock) {
    log(`Using LidoTemplate deploy block: ${chalk.yellow(state.daoTemplateDeployBlock)}`)
  }
  await assertLastEvent(template, 'TmplDaoFinalized', null, state.daoTemplateDeployBlock)

  const apmDeployedEvt = await assertSingleEvent(template, 'TmplAPMDeployed', null, state.daoTemplateDeployBlock)
  const daoDeployedEvt = await assertSingleEvent(template, 'TmplDAOAndTokenDeployed', null, state.daoTemplateDeployBlock)

  state.lidoApmAddress = apmDeployedEvt.args.apm
  state.daoAddress = daoDeployedEvt.args.dao
  state.daoTokenAddress = daoDeployedEvt.args.token

  log.splitter()

  log(`Using APMRegistry:`, yl(state.lidoApmAddress))
  const registry = await artifacts.require('APMRegistry').at(state.lidoApmAddress)

  log(`Using Kernel:`, yl(state.daoAddress))
  const dao = await artifacts.require('Kernel').at(state.daoAddress)

  log(`Using MiniMeToken:`, yl(state.daoTokenAddress))
  const daoToken = await artifacts.require('MiniMeToken').at(state.daoTokenAddress)

  log.splitter()

  const apps = await assertInstalledApps(
    {
      template,
      dao,
      lidoApmEnsName: state.lidoApmEnsName,
      appProxyUpgradeableArtifactName: 'external:AppProxyUpgradeable_DAO'
    },
    state.daoTemplateDeployBlock
  )

  log.splitter()

  for (const appName of Object.keys(apps)) {
    const app = apps[appName]
    log(`Using ${yl(appName)} app proxy: ${yl(app.proxyAddress)}`)
    const key = `app:${appName}`
    state[key] = { ...state[key], ...app }
  }

  const [lido, oracle, nopsRegistry, agent, finance, tokenManager, voting] = await Promise.all([
    artifacts.require('Lido').at(apps[APP_NAMES.LIDO].proxyAddress),
    artifacts.require('LidoOracle').at(apps[APP_NAMES.ORACLE].proxyAddress),
    artifacts.require('NodeOperatorsRegistry').at(apps[APP_NAMES.NODE_OPERATORS_REGISTRY].proxyAddress),
    artifacts.require('Agent').at(apps[APP_NAMES.ARAGON_AGENT].proxyAddress),
    artifacts.require('Finance').at(apps[APP_NAMES.ARAGON_FINANCE].proxyAddress),
    artifacts.require('TokenManager').at(apps[APP_NAMES.ARAGON_TOKEN_MANAGER].proxyAddress),
    artifacts.require('Voting').at(apps[APP_NAMES.ARAGON_VOTING].proxyAddress)
  ])

  log.splitter()

  await assertDAOConfig({
    ens,
    dao,
    daoToken,
    lido,
    oracle,
    nopsRegistry,
    agent,
    finance,
    tokenManager,
    voting,
    daoAragonId: state.daoAragonId,
    daoInitialSettings: state.daoInitialSettings
  })

  log.splitter()

  await assertDaoPermissions(
    {
      kernel: dao,
      lido,
      oracle,
      nopsRegistry,
      agent,
      finance,
      tokenManager,
      voting
    },
    state.daoTemplateDeployBlock
  )

  log.splitter()

  const { registryACL } = await assertLidoAPMPermissions({ registry, votingAddress: voting.address }, state.daoTemplateDeployBlock)

  log.splitter()

  await assertReposPermissions({ registry, registryACL, votingAddress: voting.address }, state.daoTemplateDeployBlock)

  log.splitter()

  await assertVesting({
    tokenManager,
    token: daoToken,
    vestingParams: state.vestingParams,
    unvestedTokensManagerAddress: agent.address
  })

  log.splitter()
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
  const newRepoEvts = await registry.getPastEvents('NewRepo', { fromBlock })

  for (const evt of newRepoEvts) {
    const repo = await Repo.at(evt.args.repo)
    await assertRole(
      {
        acl: registryACL,
        app: repo,
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
  oracle,
  nopsRegistry,
  agent,
  finance,
  tokenManager,
  voting,
  daoInitialSettings: settings
}) {
  const assertKernel = async (app, appName) => {
    assert.log(assert.addressEqual, await app.kernel(), dao.address, `${appName}.kernel is ${yl(dao.address)}`)
  }

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

  DAO_LIVE || assert.log(assert.bnEqual, await lido.totalSupply(), 0, `lido.totalSupply() is ${yl(0)}`)

  DAO_LIVE ||
    assert.log(assert.equal, await lido.isStopped(), PROTOCOL_PAUSED_AFTER_DEPLOY, `lido.isStopped is ${yl(PROTOCOL_PAUSED_AFTER_DEPLOY)}`)

  DAO_LIVE ||
    assert.log(
      assert.bnEqual,
      await lido.getWithdrawalCredentials(),
      ZERO_WITHDRAWAL_CREDS,
      `lido.getWithdrawalCredentials() is ${yl(ZERO_WITHDRAWAL_CREDS)}`
    )

  const expectedTotalFee = percentToBP(settings.fee.totalPercent)
  assert.log(assert.bnEqual, await lido.getFee(), expectedTotalFee, `lido.getFee() is ${yl(expectedTotalFee)}`)

  const feeDistr = await lido.getFeeDistribution()
  const expectedTreasuryFee = percentToBP(settings.fee.treasuryPercent)
  const expectedInsuranceFee = percentToBP(settings.fee.insurancePercent)
  const expectedOpsFee = percentToBP(settings.fee.nodeOperatorsPercent)
  assert.log(
    assert.bnEqual,
    feeDistr.treasuryFeeBasisPoints,
    expectedTreasuryFee,
    `lido.getFeeDistribution().treasuryFeeBasisPoints is ${yl(expectedTreasuryFee)}`
  )
  assert.log(
    assert.bnEqual,
    feeDistr.insuranceFeeBasisPoints,
    expectedInsuranceFee,
    `lido.getFeeDistribution().insuranceFeeBasisPoints is ${yl(expectedInsuranceFee)}`
  )
  assert.log(
    assert.bnEqual,
    feeDistr.operatorsFeeBasisPoints,
    expectedOpsFee,
    `lido.getFeeDistribution().operatorsFeeBasisPoints is ${yl(expectedOpsFee)}`
  )

  assert.log(
    assert.addressEqual,
    await lido.getDepositContract(),
    settings.beaconSpec.depositContractAddress,
    `lido.getValidatorRegistrationContract() is ${yl(settings.beaconSpec.depositContractAddress)}`
  )

  assert.log(assert.addressEqual, await lido.getOracle(), oracle.address, `lido.getOracle() is ${yl(oracle.address)}`)

  assert.log(assert.addressEqual, await lido.getOperators(), nopsRegistry.address, `lido.getOperators() is ${yl(nopsRegistry.address)}`)

  assert.log(assert.addressEqual, await lido.getTreasury(), agent.address, `lido.getTreasury() is ${yl(agent.address)}`)

  assert.log(assert.addressEqual, await lido.getInsuranceFund(), agent.address, `lido.getInsuranceFund() is ${yl(agent.address)}`)

  log.splitter()
  await assertKernel(oracle, 'oracle')

  assert.log(assert.addressEqual, await oracle.getLido(), lido.address, `oracle.getLido() is ${yl(lido.address)}`)

  DAO_LIVE || assert.log(assert.isEmpty, await oracle.getOracleMembers(), `oracle.getOracleMembers() is []`)

  const beaconSpec = await oracle.getBeaconSpec()
  assert.log(
    assert.bnEqual,
    beaconSpec.epochsPerFrame,
    settings.beaconSpec.epochsPerFrame,
    `oracle.getBeaconSpec().epochsPerFrame is ${yl(settings.beaconSpec.epochsPerFrame)}`
  )
  assert.log(
    assert.bnEqual,
    beaconSpec.slotsPerEpoch,
    settings.beaconSpec.slotsPerEpoch,
    `oracle.getBeaconSpec().slotsPerEpoch is ${yl(settings.beaconSpec.slotsPerEpoch)}`
  )
  assert.log(
    assert.bnEqual,
    beaconSpec.secondsPerSlot,
    settings.beaconSpec.secondsPerSlot,
    `oracle.getBeaconSpec().secondsPerSlot is ${yl(settings.beaconSpec.secondsPerSlot)}`
  )
  assert.log(
    assert.bnEqual,
    beaconSpec.genesisTime,
    settings.beaconSpec.genesisTime,
    `oracle.getBeaconSpec().genesisTime is ${yl(settings.beaconSpec.genesisTime)}`
  )

  DAO_LIVE || assert.log(assert.bnEqual, await oracle.getQuorum(), 1, `oracle.getQuorum() is ${yl(1)}`)

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

async function assertDaoPermissions({ kernel, lido, oracle, nopsRegistry, agent, finance, tokenManager, voting }, fromBlock = 4532202) {
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
    missingRoleNames: ['MINT_ROLE', 'BURN_ROLE', 'ISSUE_ROLE', 'REVOKE_VESTINGS_ROLE']
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
          'MANAGE_FEE',
          'MANAGE_WITHDRAWAL_KEY',
          'SET_ORACLE', 'BURN_ROLE',
          'SET_TREASURY',
          'SET_INSURANCE_FUND',
          'STAKING_PAUSE_ROLE',
          'STAKING_CONTROL_ROLE',
          'SET_EL_REWARDS_VAULT_ROLE',
          'SET_EL_REWARDS_WITHDRAWAL_LIMIT_ROLE'
        ],
        grantee: voting
      }
    ]
  })

  log.splitter()

  await assertRoles({
    app: oracle,
    appName: 'oracle',
    manager: voting,
    groups: [
      {
        roleNames: ['MANAGE_MEMBERS', 'MANAGE_QUORUM', 'SET_BEACON_SPEC'],
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
          'ADD_NODE_OPERATOR_ROLE',
          'SET_NODE_OPERATOR_ACTIVE_ROLE',
          'SET_NODE_OPERATOR_NAME_ROLE',
          'SET_NODE_OPERATOR_ADDRESS_ROLE',
          'SET_NODE_OPERATOR_LIMIT_ROLE',
          'REPORT_STOPPED_VALIDATORS_ROLE'
        ],
        grantee: voting
      }
    ]
  })
}

module.exports = runOrWrapScript(checkDAO, module)
