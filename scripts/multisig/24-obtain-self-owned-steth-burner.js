const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, logHeader, yl } = require('../helpers/log')
const { useOrGetDeployed } = require('../helpers/deploy')
const { assert } = require('../helpers/assert')
const {
  readNetworkState,
  persistNetworkState,
  assertRequiredNetworkState
} = require('../helpers/persisted-network-state')

const { APP_NAMES, APP_ARTIFACTS } = require('./constants')

const APP = process.env.APP || ''
const REQUIRED_NET_STATE = [
  'selfOwnedStETHBurnerDeployTx',
  'lidoApmEnsName',
  'ensAddress',
  'daoAddress',
  'compositePostRebaseBeaconReceiverAddress',
  'selfOwnedStETHBurnerParams',
  `app:${APP_NAMES.ARAGON_VOTING}`,
  `app:${APP_NAMES.ORACLE}`,
  `app:${APP_NAMES.ARAGON_AGENT}`
]

async function obtainInstance({ web3, artifacts, appName = APP }) {
  // convert dash-ed appName to camel case-d
  const appArtifact = 'SelfOwnedStETHBurner'
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  logHeader(`${appArtifact} app base`)
  const selfOwnedStETHBurner = await useOrGetDeployed(appArtifact, null, state.selfOwnedStETHBurnerDeployTx)
  log(`Checking...`)
  const lidoAddress = state[`app:${APP_NAMES.LIDO}`].proxyAddress
  const votingAddress = state[`app:${APP_NAMES.ARAGON_VOTING}`].proxyAddress
  const treasuryAddress = state[`app:${APP_NAMES.ARAGON_AGENT}`].proxyAddress

  await assertParams(state.selfOwnedStETHBurnerParams, selfOwnedStETHBurner, appArtifact)
  await assertAddresses({ lidoAddress, votingAddress, treasuryAddress }, selfOwnedStETHBurner, appArtifact)
  persistNetworkState(network.name, netId, state, {
    selfOwnedStETHBurnerAddress: selfOwnedStETHBurner.address
  })
}

async function assertParams(
  {
    totalCoverSharesBurnt,
    totalNonCoverSharesBurnt,
    maxBurnAmountPerRunBasisPoints
  },
  instance, desc
) {
  assert.bnEqual(
    await instance.getCoverSharesBurnt(),
    totalCoverSharesBurnt,
    `${desc}: wrong totalCoverSharesBurnt`
  )
  assert.bnEqual(
    await instance.getNonCoverSharesBurnt(),
    totalNonCoverSharesBurnt,
    `${desc}: wrong totalNonCoverSharesBurnt`
  )
  assert.bnEqual(
    await instance.getBurnAmountPerRunQuota(),
    maxBurnAmountPerRunBasisPoints,
    `${desc}: wrong burn amount per run quota`
  )
}

async function assertAddresses({ treasuryAddress, lidoAddress, votingAddress }, instance, desc) {
  assert.addressEqual(await instance.LIDO(), lidoAddress, `${desc}: wrong lido address`)
  assert.addressEqual(await instance.TREASURY(), treasuryAddress, `${desc}: wrong treasury address`)
  assert.addressEqual(await instance.VOTING(), votingAddress, `${desc}: wrong voting address`)
}

module.exports = runOrWrapScript(obtainInstance, module)
