const path = require('path')
const chalk = require('chalk')
const BN = require('bn.js')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { getEvents } = require('@aragon/contract-helpers-test')
const { hash: namehash } = require('eth-ens-namehash')
const { toChecksumAddress } = require('web3-utils')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, yl } = require('../helpers/log')
const { readNetworkState, persistNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { assertRole, assertMissingRole } = require('../helpers/aragon')
const { assertLastEvent } = require('../helpers/events')
const { assert } = require('../helpers/assert')
const { percentToBP } = require('../helpers/index')
const { resolveEnsAddress } = require('../components/ens')

const { APP_NAMES } = require('./constants')

const { assertAPMRegistryPermissions } = require('./checks/apm')
const { assertInstalledApps } = require('./checks/apps')
const { assertVesting } = require('./checks/dao-token')

const REQUIRED_NET_STATE = [
  'ensAddress',
  'lidoApmAddress',
  'lidoApmEnsName',
  'daoAddress',
  'daoTokenAddress',
  'daoAragonId',
  'vestingParams',
  'daoInitialSettings',
  `app:${APP_NAMES.LIDO}`,
  `app:${APP_NAMES.ORACLE}`,
  `app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`,
  `app:${APP_NAMES.ARAGON_AGENT}`,
  `app:${APP_NAMES.ARAGON_FINANCE}`,
  `app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`,
  `app:${APP_NAMES.ARAGON_VOTING}`
]

const TOKEN_TRANSFERABLE = true
const TOKEN_DECIMALS = 18
// uint256(-1)
const TOKEN_MAX_PER_ACCOUNT = '115792089237316195423570985008687907853269984665640564039457584007913129639935'
const FINANCE_DEFAULT_PERIOD = 60 * 60 * 24 * 30 // 30 days

const STETH_TOKEN_NAME = 'Liquid staked Ether 2.0'
const STETH_TOKEN_SYMBOL = 'stETH'
const STETH_TOKEN_DECIMALS = 18

const ZERO_WITHDRAWAL_CREDS = '0x0000000000000000000000000000000000000000000000000000000000000000'
const PROTOCOL_PAUSED_AFTER_DEPLOY = false

const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'

async function checkDAO({ web3, artifacts, networkStateFile = NETWORK_STATE_FILE }) {
  const netId = await web3.eth.net.getId()

  log.splitter()
  log(`Network ID: ${yl(netId)}`)

  const state = readNetworkState(networkStateFile, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  log.splitter()

  log(`Using LidoTemplate: ${yl(state.daoTemplateAddress)}`)
  const template = await artifacts.require('LidoTemplate').at(state.daoTemplateAddress)
  await assertLastEvent(template, 'TmplDaoFinalized')

  log.splitter()

  log(`Using ENS:`, yl(state.ensAddress))
  const ens = await artifacts.require('ENS').at(state.ensAddress)

  log(`Using APMRegistry:`, yl(state.lidoApmAddress))
  const registry = await artifacts.require('APMRegistry').at(state.lidoApmAddress)

  log(`Using Kernel:`, yl(state.daoAddress))
  const dao = await artifacts.require('Kernel').at(state.daoAddress)

  log(`Using MiniMeToken:`, yl(state.daoTokenAddress))
  const daoToken = await artifacts.require('MiniMeToken').at(state.daoTokenAddress)

  log.splitter()

  const lidoAddress = state[`app:${APP_NAMES.LIDO}`].proxyAddress
  log(`Using ${yl(APP_NAMES.LIDO)} app proxy: ${yl(lidoAddress)}`)

  const oracleAddress = state[`app:${APP_NAMES.ORACLE}`].proxyAddress
  log(`Using ${yl(APP_NAMES.ORACLE)} app proxy: ${yl(oracleAddress)}`)

  const nopsRegistryAddress = state[`app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`].proxyAddress
  log(`Using ${yl(APP_NAMES.NODE_OPERATORS_REGISTRY)} app proxy: ${yl(nopsRegistryAddress)}`)

  const agentAddress = state[`app:${APP_NAMES.ARAGON_AGENT}`].proxyAddress
  log(`Using ${yl(APP_NAMES.ARAGON_AGENT)} app proxy: ${yl(agentAddress)}`)

  const financeAddress = state[`app:${APP_NAMES.ARAGON_FINANCE}`].proxyAddress
  log(`Using ${yl(APP_NAMES.ARAGON_FINANCE)} app proxy: ${yl(financeAddress)}`)

  const tokenManagerAddress = state[`app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`].proxyAddress
  log(`Using ${yl(APP_NAMES.ARAGON_TOKEN_MANAGER)} app proxy: ${yl(tokenManagerAddress)}`)

  const votingAddress = state[`app:${APP_NAMES.ARAGON_VOTING}`].proxyAddress
  log(`Using ${yl(APP_NAMES.ARAGON_VOTING)} app proxy: ${yl(votingAddress)}`)

  const [lido, oracle, nopsRegistry, agent, finance, tokenManager, voting] = await Promise.all([
    artifacts.require('Lido').at(lidoAddress),
    artifacts.require('LidoOracle').at(oracleAddress),
    artifacts.require('NodeOperatorsRegistry').at(nopsRegistryAddress),
    artifacts.require('Agent').at(agentAddress),
    artifacts.require('Finance').at(financeAddress),
    artifacts.require('TokenManager').at(tokenManagerAddress),
    artifacts.require('Voting').at(votingAddress)
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

  await assertDaoPermissions({
    kernel: dao,
    lido,
    oracle,
    nopsRegistry,
    agent,
    finance,
    tokenManager,
    voting
  })

  log.splitter()

  const { registryACL } = await checkAPM({ registry, votingAddress })

  log.splitter()

  await assertReposPermissions({ registry, registryACL, votingAddress })

  log.splitter()

  await assertInstalledApps({
    template,
    dao,
    lidoApmEnsName: state.lidoApmEnsName,
    appProxyUpgradeableArtifactName: 'external:AppProxyUpgradeable_DAO'
  })

  log.splitter()

  await assertVesting({
    tokenManagerAddress,
    tokenAddress: daoToken.address,
    vestingParams: state.vestingParams,
    unvestedTokensManagerAddress: agentAddress
  })

  log.splitter()
}

async function checkAPM({ registry, votingAddress }) {
  const [kernelAddress, registrarAddress] = await Promise.all([
    registry.kernel(),
    registry.registrar()
  ])

  const [registryKernel, registrar] = await Promise.all([
    artifacts.require('Kernel').at(kernelAddress),
    artifacts.require('ENSSubdomainRegistrar').at(registrarAddress)
  ])

  const registryACLAddress = await registryKernel.acl()
  const registryACL = await artifacts.require('ACL').at(registryACLAddress)

  await assertAPMRegistryPermissions({
    registry,
    registrar,
    registryACL,
    registryKernel,
    rootAddress: votingAddress
  })

  return { registryKernel, registryACL, registrar }
}

async function assertReposPermissions({ registry, registryACL, votingAddress }) {
  const Repo = artifacts.require('Repo')
  const newRepoEvts = await registry.getPastEvents('NewRepo', { fromBlock: 0 })

  for (const evt of newRepoEvts) {
    const repo = await Repo.at(evt.args.repo)
    await assertRole({
      acl: registryACL,
      app: repo,
      appName: `repo<${evt.args.name}>`,
      roleName: 'CREATE_VERSION_ROLE',
      managerAddress: votingAddress,
      granteeAddress: votingAddress
    })
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
    assert.log(
      assert.addressEqual,
      await app.kernel(),
      dao.address,
      `${appName}.kernel is ${yl(dao.address)}`
    )
  }

  assert.log(
    assert.addressEqual,
    await resolveEnsAddress(artifacts, ens, namehash(`${daoAragonId}.aragonid.eth`)),
    dao.address,
    `Aragon ID ${yl(daoAragonId)} resolves to ${yl(dao.address)}`
  )

  log.splitter()

  assert.log(
    assert.addressEqual,
    await dao.getRecoveryVault(),
    agent.address,
    `dao.getRecoveryVault() is ${yl(agent.address)}`
  )

  log.splitter()

  assert.log(
    assert.equal,
    await daoToken.name(),
    settings.token.name,
    `daoToken.name is ${yl(settings.token.name)}`
  )

  assert.log(
    assert.equal,
    await daoToken.symbol(),
    settings.token.symbol,
    `daoToken.symbol is ${yl(settings.token.symbol)}`
  )

  assert.log(
    assert.bnEqual,
    await daoToken.decimals(),
    TOKEN_DECIMALS,
    `daoToken.decimals is ${yl(TOKEN_DECIMALS)}`
  )

  assert.log(
    assert.addressEqual,
    await daoToken.controller(),
    tokenManager.address,
    `daoToken.controller is ${yl(tokenManager.address)}`
  )

  assert.log(
    assert.equal,
    await daoToken.transfersEnabled(),
    TOKEN_TRANSFERABLE,
    `daoToken.transfersEnabled is ${yl(TOKEN_TRANSFERABLE)}`
  )

  log.splitter()
  await assertKernel(agent, 'agent')

  log.splitter()
  await assertKernel(voting, 'voting')

  assert.log(
    assert.addressEqual,
    await voting.token(),
    daoToken.address,
    `voting.token is ${yl(daoToken.address)}`
  )

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

  assert.log(
    assert.bnEqual,
    await voting.votesLength(),
    0,
    `voting.votesLength is ${yl('0')}`
  )

  log.splitter()
  await assertKernel(tokenManager, 'tokenManager')

  assert.log(
    assert.addressEqual,
    await tokenManager.token(),
    daoToken.address,
    `tokenManager.token is ${yl(daoToken.address)}`
  )

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

  assert.log(
    assert.addressEqual,
    await finance.vault(),
    agent.address,
    `finance.vault is ${yl(agent.address)}`
  )

  log.splitter()
  await assertKernel(lido, 'lido')

  assert.log(
    assert.equal,
    await lido.name(),
    STETH_TOKEN_NAME,
    `lido.name is ${yl(STETH_TOKEN_NAME)}`
  )

  assert.log(
    assert.equal,
    await lido.symbol(),
    STETH_TOKEN_SYMBOL,
    `lido.symbol is ${yl(STETH_TOKEN_SYMBOL)}`
  )

  assert.log(
    assert.bnEqual,
    await lido.decimals(),
    STETH_TOKEN_DECIMALS,
    `lido.decimals is ${yl(STETH_TOKEN_DECIMALS)}`
  )

  assert.log(
    assert.bnEqual,
    await lido.totalSupply(),
    0,
    `lido.totalSupply() is ${yl(0)}`
  )

  assert.log(
    assert.equal,
    await lido.isStopped(),
    PROTOCOL_PAUSED_AFTER_DEPLOY,
    `lido.isStopped is ${yl(PROTOCOL_PAUSED_AFTER_DEPLOY)}`
  )

  assert.log(
    assert.bnEqual,
    await lido.getWithdrawalCredentials(),
    ZERO_WITHDRAWAL_CREDS,
    `lido.getWithdrawalCredentials() is ${yl(ZERO_WITHDRAWAL_CREDS)}`
  )

  const expectedTotalFee = percentToBP(settings.fee.totalPercent)
  assert.log(
    assert.bnEqual,
    await lido.getFee(),
    expectedTotalFee,
    `lido.getFee() is ${yl(expectedTotalFee)}`
  )

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
    await lido.getValidatorRegistrationContract(),
    settings.beaconSpec.depositContractAddress,
    `lido.getValidatorRegistrationContract() is ${yl(settings.beaconSpec.depositContractAddress)}`
  )

  assert.log(
    assert.addressEqual,
    await lido.getOracle(),
    oracle.address,
    `lido.getOracle() is ${yl(oracle.address)}`
  )

  assert.log(
    assert.addressEqual,
    await lido.getOperators(),
    nopsRegistry.address,
    `lido.getOperators() is ${yl(nopsRegistry.address)}`
  )

  assert.log(
    assert.addressEqual,
    await lido.getTreasury(),
    agent.address,
    `lido.getTreasury() is ${yl(agent.address)}`
  )

  assert.log(
    assert.addressEqual,
    await lido.getInsuranceFund(),
    agent.address,
    `lido.getInsuranceFund() is ${yl(agent.address)}`
  )

  log.splitter()
  await assertKernel(oracle, 'oracle')

  assert.log(
    assert.addressEqual,
    await oracle.getPool(),
    lido.address,
    `oracle.getPool() is ${yl(lido.address)}`
  )

  assert.log(
    assert.isEmpty,
    await oracle.getOracleMembers(),
    `oracle.getOracleMembers() is []`
  )

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

  assert.log(
    assert.bnEqual,
    await oracle.getQuorum(),
    0,
    `oracle.getQuorum() is ${yl(0)}`
  )

  log.splitter()
  await assertKernel(nopsRegistry, 'nopsRegistry')

  assert.log(
    assert.bnEqual,
    await nopsRegistry.getNodeOperatorsCount(),
    0,
    `nopsRegistry.getNodeOperatorsCount() is ${yl(0)}`
  )

  assert.log(
    assert.bnEqual,
    await nopsRegistry.getActiveNodeOperatorsCount(),
    0,
    `nopsRegistry.getActiveNodeOperatorsCount() is ${yl(0)}`
  )
}

async function assertDaoPermissions({
  kernel,
  lido,
  oracle,
  nopsRegistry,
  agent,
  finance,
  tokenManager,
  voting
}) {
  const aclAddress = await kernel.acl()
  const acl = await artifacts.require('ACL').at(aclAddress)
  const allAclEvents = await acl.getPastEvents('allEvents', { fromBlock: 0 })

  const assertRoles = async ({ app, appName, groups, manager, missingRoleNames = [] }) => {
    for (const group of groups) {
      for (const roleName of group.roleNames) {
        await assertRole({
          acl,
          allAclEvents,
          app,
          appName,
          roleName,
          granteeAddress: group.grantee.address,
          managerAddress: group.manager === undefined ? manager.address : group.manager.address,
          onlyGrantee: group.onlyGrantee === undefined ? true : group.onlyGrantee
        })
      }
    }
    for (const roleName of missingRoleNames) {
      await assertMissingRole({ acl, allAclEvents, app, appName, roleName })
    }
  }

  await assertRole({
    acl,
    allAclEvents,
    app: acl,
    appName: 'kernel.acl',
    roleName: 'CREATE_PERMISSIONS_ROLE',
    managerAddress: voting.address,
    granteeAddress: voting.address,
    onlyGrantee: true
  })

  await assertRole({
    acl,
    allAclEvents,
    app: kernel,
    appName: 'kernel',
    roleName: 'APP_MANAGER_ROLE',
    managerAddress: voting.address,
    granteeAddress: voting.address,
    onlyGrantee: true
  })

  log.splitter()

  const evmScriptRegistryAddress = await acl.getEVMScriptRegistry()
  const evmScriptRegistry = await artifacts.require('EVMScriptRegistry').at(evmScriptRegistryAddress)

  await assertRoles({
    app: evmScriptRegistry,
    appName: 'evmScriptRegistry',
    manager: voting,
    groups: [{
      roleNames: ['REGISTRY_MANAGER_ROLE', 'REGISTRY_ADD_EXECUTOR_ROLE'],
      grantee: voting
    }]
  })

  log.splitter()

  await assertRoles({
    app: agent,
    appName: 'agent',
    manager: voting,
    groups: [{
      roleNames: ['EXECUTE_ROLE', 'RUN_SCRIPT_ROLE'],
      grantee: voting
    }],
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
    groups: [{
      roleNames: ['CREATE_PAYMENTS_ROLE', 'EXECUTE_PAYMENTS_ROLE', 'MANAGE_PAYMENTS_ROLE'],
      grantee: voting
    }],
    missingRoleNames: ['CHANGE_PERIOD_ROLE', 'CHANGE_BUDGETS_ROLE']
  })

  log.splitter()

  await assertRoles({
    app: tokenManager,
    appName: 'tokenManager',
    manager: voting,
    groups: [{
      roleNames: ['ASSIGN_ROLE'],
      grantee: voting
    }],
    missingRoleNames: ['MINT_ROLE', 'BURN_ROLE', 'ISSUE_ROLE', 'REVOKE_VESTINGS_ROLE']
  })

  log.splitter()

  await assertRoles({
    app: voting,
    appName: 'voting',
    manager: voting,
    groups: [{
      roleNames: ['MODIFY_SUPPORT_ROLE', 'MODIFY_QUORUM_ROLE'],
      grantee: voting
    }, {
      roleNames: ['CREATE_VOTES_ROLE'],
      grantee: tokenManager
    }],
  })

  log.splitter()

  await assertRoles({
    app: lido,
    appName: 'lido',
    manager: voting,
    groups: [{
      roleNames: [
        'PAUSE_ROLE',
        'MANAGE_FEE',
        'MANAGE_WITHDRAWAL_KEY',
        'SET_ORACLE',
        'BURN_ROLE',
        'SET_TREASURY',
        'SET_INSURANCE_FUND'
      ],
      grantee: voting
    }]
  })

  log.splitter()

  await assertRoles({
    app: oracle,
    appName: 'oracle',
    manager: voting,
    groups: [{
      roleNames: ['MANAGE_MEMBERS', 'MANAGE_QUORUM', 'SET_BEACON_SPEC'],
      grantee: voting
    }]
  })

  log.splitter()

  await assertRoles({
    app: nopsRegistry,
    appName: 'nopsRegistry',
    manager: voting,
    groups: [{
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
    }]
  })
}

module.exports = runOrWrapScript(checkDAO, module)
