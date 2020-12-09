const path = require('path')
const chalk = require('chalk')
const { assert } = require('chai')
const { getEvents } = require('@aragon/contract-helpers-test')
const { hash: namehash } = require('eth-ens-namehash')
const { toChecksumAddress } = require('web3-utils')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log } = require('../helpers/log')
const {
  readNetworkState,
  persistNetworkState,
  assertRequiredNetworkState
} = require('../helpers/persisted-network-state')
const { saveCallTxData } = require('../helpers/tx-data')
const { resolveLatestVersion: apmResolveLatest } = require('../components/apm')

const REQUIRED_NET_STATE = [
  'ensAddress',
  'multisigAddress',
  'daoTemplateAddress',
  'createAppReposTx',
  'lido_app_lido',
  'lido_app_lidooracle',
  'lido_app_node-operators-registry',
  'daoInitialSettings'
]

const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'

// Aragon app names
const ARAGON_AGENT_APP_NAME = 'aragon-agent'
const ARAGON_FINANCE_APP_NAME = 'aragon-finance'
const ARAGON_TOKEN_MANAGER_APP_NAME = 'aragon-token-manager'
const ARAGON_VOTING_APP_NAME = 'aragon-voting'

// Lido app names
const LIDO_APP_NAME = 'lido'
const NODE_OPERATORS_REGISTRY_APP_NAME = 'node-operators-registry'
const ORACLE_APP_NAME = 'oracle'

const APP_NAMES = [
  ARAGON_AGENT_APP_NAME,
  ARAGON_FINANCE_APP_NAME,
  ARAGON_TOKEN_MANAGER_APP_NAME,
  ARAGON_VOTING_APP_NAME,
  LIDO_APP_NAME,
  NODE_OPERATORS_REGISTRY_APP_NAME,
  ORACLE_APP_NAME
]

async function deployDAO({
  web3,
  artifacts,
  networkStateFile = NETWORK_STATE_FILE
}) {
  const netId = await web3.eth.net.getId()

  log.splitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(networkStateFile, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  log.splitter()
  log(`Using LidoTemplate: ${chalk.yellow(state.daoTemplateAddress)}`)
  log(`Using createRepos transaction: ${chalk.yellow(state.createAppReposTx)}`)

  log.splitter(`Checking preconditions...`)
  await checkAppRepos(state)

  log.splitter()

  const template = await artifacts.require('LidoTemplate3').at(state.daoTemplateAddress)
  const { daoInitialSettings } = state

  const votingSettings = [
    daoInitialSettings.votingSettings.minSupportRequired,
    daoInitialSettings.votingSettings.minAcceptanceQuorum,
    daoInitialSettings.votingSettings.voteDuration
  ]

  const beaconSpec = [
    daoInitialSettings.beaconSpec.epochsPerFrame,
    daoInitialSettings.beaconSpec.slotsPerEpoch,
    daoInitialSettings.beaconSpec.secondsPerSlot,
    daoInitialSettings.beaconSpec.genesisTime
  ]

  await saveCallTxData(`newDAO`, template, 'newDAO', `tx-07-deploy-dao.json`, {
    arguments: [
      daoInitialSettings.tokenName,
      daoInitialSettings.tokenSymbol,
      votingSettings,
      daoInitialSettings.beaconSpec.depositContractAddress,
      beaconSpec
    ],
    from: state.multisigAddress
  })
}

async function checkAppRepos(state) {
  const receipt = await web3.eth.getTransactionReceipt(state.createAppReposTx)
  if (!receipt) {
    assert(false, `transaction ${state.createAppReposTx} not found`)
  }

  const { abi: APMRegistryABI } = await artifacts.readArtifact('APMRegistry')
  const events = getEvents(receipt, 'NewRepo', { decodeForAbi: APMRegistryABI })

  const repoIds = events.map(evt => evt.args.id)
  const expectedIds = APP_NAMES.map(name => namehash(`${name}.${state.lidoApmEnsName}`))

  const idsCheckDesc = `all (and only) expected app repos are created`
  assert.sameMembers(repoIds, expectedIds, idsCheckDesc)
  log.success(idsCheckDesc)

  const Repo = artifacts.require('Repo')

  const appsInfo = await Promise.all(events.map(async (evt) => {
    const repo = await Repo.at(evt.args.repo)
    const latest = await repo.getLatest()
    return {
      appName: evt.args.name,
      contractAddress: latest.contractAddress,
      contentURI: latest.contentURI
    }
  }))

  const aragonApps = appsInfo.filter(info => info.appName.startsWith('aragon-'))
  const lidoApps = appsInfo.filter(info => !info.appName.startsWith('aragon-'))

  const stateNames = {
    'lido': 'lido_app_lido',
    'node-operators-registry': 'lido_app_node-operators-registry',
    'oracle': 'lido_app_lidooracle'
  }

  for (const app of lidoApps) {
    const appState = state[ stateNames[ app.appName ] ]
    const appDesc = `repo ${chalk.yellow(app.appName + '.' + state.lidoApmEnsName)}`

    const addrCheckDesc = `${appDesc}: latest version contract address is correct`
    assert.equal(app.contractAddress, appState.baseAddress, addrCheckDesc)
    log.success(addrCheckDesc)

    const contentCheckDesc = `${appDesc}: latest version content URI is correct`
    assert.equal(app.contentURI, appState.contentURI, contentCheckDesc)
    log.success(contentCheckDesc)
  }

  const ens = await artifacts.require('ENS').at(state.ensAddress)

  for (const app of aragonApps) {
    const upstreamRepoName = `${app.appName.substring(7)}.aragonpm.eth`
    const latestAragonVersion = await apmResolveLatest(namehash(upstreamRepoName), ens, artifacts)

    const appDesc = `repo ${chalk.yellow(app.appName + '.' + state.lidoApmEnsName)}`

    const addrCheckDesc = `${appDesc}: latest version contract address is the same as in repo ${chalk.yellow(upstreamRepoName)}`
    assert.equal(app.contractAddress, latestAragonVersion.contractAddress, addrCheckDesc)
    log.success(addrCheckDesc)

    const contentCheckDesc = `${appDesc}: latest version content URI is the same as in repo ${chalk.yellow(upstreamRepoName)}`
    assert.equal(app.contentURI, latestAragonVersion.contentURI, contentCheckDesc)
    log.success(contentCheckDesc)
  }
}

module.exports = runOrWrapScript(deployDAO, module)
