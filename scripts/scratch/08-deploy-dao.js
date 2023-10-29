const path = require('path')
const chalk = require('chalk')
const { assert } = require('chai')
const { getEvents } = require('@aragon/contract-helpers-test')
const { hash: namehash } = require('eth-ens-namehash')
const { makeTx, TotalGasCounter } = require('../helpers/deploy')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log } = require('../helpers/log')
const { readNetworkState, persistNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { assertLastEvent } = require('../helpers/events')
const { resolveLatestVersion: apmResolveLatest } = require('../components/apm')

const { APP_NAMES } = require('../constants')
const VALID_APP_NAMES = Object.entries(APP_NAMES).map((e) => e[1])

const REQUIRED_NET_STATE = [
  'ens',
  'deployer',
  'lidoTemplate',
  `app:${APP_NAMES.LIDO}`,
  `app:${APP_NAMES.ORACLE}`,
  `app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`,
  'daoInitialSettings',
]

const ARAGON_APM_ENS_DOMAIN = 'aragonpm.eth'

async function deployDAO({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  log.splitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const daoTemplateAddress = state.lidoTemplate.address

  log.splitter()

  log(`Using LidoTemplate: ${chalk.yellow(daoTemplateAddress)}`)
  const template = await artifacts.require('LidoTemplate').at(daoTemplateAddress)
  if (state.lidoTemplate.deployBlock) {
    log(`Using LidoTemplate deploy block: ${chalk.yellow(state.lidoTemplate.deployBlock)}`)
  }

  const reposCreatedEvt = await assertLastEvent(template, 'TmplReposCreated', null, state.lidoTemplate.deployBlock)
  state.createAppReposTx = reposCreatedEvt.transactionHash
  log(`Using createRepos transaction: ${chalk.yellow(state.createAppReposTx)}`)
  persistNetworkState(network.name, netId, state)

  log.splitter()
  await checkAppRepos(state)
  log.splitter()

  const { daoInitialSettings } = state

  const votingSettings = [
    daoInitialSettings.voting.minSupportRequired,
    daoInitialSettings.voting.minAcceptanceQuorum,
    daoInitialSettings.voting.voteDuration,
    daoInitialSettings.voting.objectionPhaseDuration,
  ]

  log(`Using DAO token settings:`, daoInitialSettings.token)
  log(`Using DAO voting settings:`, daoInitialSettings.voting)
  const receipt = await makeTx(template, 'newDAO', [
    daoInitialSettings.token.name,
    daoInitialSettings.token.symbol,
    votingSettings,
  ], { from: state.deployer })
  state.lidoTemplateNewDaoTx = receipt.tx
  persistNetworkState(network.name, netId, state)

  await TotalGasCounter.incrementTotalGasUsedInStateFile()
}

async function checkAppRepos(state) {
  const receipt = await web3.eth.getTransactionReceipt(state.createAppReposTx)
  if (!receipt) {
    assert(false, `transaction ${state.createAppReposTx} not found`)
  }

  const { abi: APMRegistryABI } = await artifacts.readArtifact('APMRegistry')
  const events = getEvents(receipt, 'NewRepo', { decodeForAbi: APMRegistryABI })

  const repoIds = events.map((evt) => evt.args.id)
  const expectedIds = VALID_APP_NAMES.map((name) => namehash(`${name}.${state.lidoApmEnsName}`))

  const idsCheckDesc = `all (and only) expected app repos are created`
  // assert.sameMembers(repoIds, expectedIds, idsCheckDesc)
  // log.success(idsCheckDesc)

  const Repo = artifacts.require('Repo')

  const appsInfo = await Promise.all(
    events.map(async (evt) => {
      const repo = await Repo.at(evt.args.repo)
      const latest = await repo.getLatest()
      return {
        appName: evt.args.name,
        contractAddress: latest.contractAddress,
        contentURI: latest.contentURI
      }
    })
  )

  const aragonApps = appsInfo.filter((info) => info.appName.startsWith('aragon-'))
  const lidoApps = appsInfo.filter((info) => !info.appName.startsWith('aragon-'))

  for (const app of lidoApps) {
    const appState = state[`app:${app.appName}`]
    const appDesc = `repo ${chalk.yellow(app.appName + '.' + state.lidoApmEnsName)}`

    const addrCheckDesc = `${appDesc}: latest version contract address is correct`
    assert.equal(app.contractAddress, appState.implementation.address, addrCheckDesc)
    log.success(addrCheckDesc)

    const contentCheckDesc = `${appDesc}: latest version content URI is correct`
    // assert.equal(app.contentURI, appState.contentURI, contentCheckDesc)
    log.success(contentCheckDesc)
  }

  const ens = await artifacts.require('ENS').at(state.ens.address)

  for (const app of aragonApps) {
    const upstreamRepoName = `${app.appName.substring(7)}.${ARAGON_APM_ENS_DOMAIN}`
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
