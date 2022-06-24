const runOrWrapScript = require("../helpers/run-or-wrap-script");
const { log, logWideSplitter, logHeader, yl } = require('../helpers/log')
const { useOrGetDeployed } = require('../helpers/deploy')
const { assert } = require('../helpers/assert')
const { readNetworkState, persistNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('./constants');
const { network } = require("hardhat");

const APP = process.env.APP || ''
const REQUIRED_NET_STATE = [
  'compositePostRebaseBeaconReceiverDeployTx',
  'lidoApmEnsName',
  'ensAddress',
  'daoAddress',
  `app:${APP_NAMES.ARAGON_VOTING}`,
  `app:${APP_NAMES.ORACLE}`
]

async function obtainInstance({ web3, artifacts, appName = APP }) {
  // convert dash-ed appName to camel case-d
  const appArtifact = 'CompositePostRebaseBeaconReceiver'
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  logHeader(`${appArtifact} app base`)
  const compositePostRebaseBeaconReceiver = await useOrGetDeployed(
    appArtifact,
    null,
    state.compositePostRebaseBeaconReceiverDeployTx
  )
  log(`Checking...`)
  const votingAddress = state[`app:${APP_NAMES.ARAGON_VOTING}`].proxyAddress
  const lidoOracleAddress = state[`app:${APP_NAMES.ORACLE}`].proxyAddress

  await assertAddresses({
    votingAddress,
    lidoOracleAddress
  }, compositePostRebaseBeaconReceiver, appArtifact)

  persistNetworkState(network.name, netId, state, {
    compositePostRebaseBeaconReceiverAddress: compositePostRebaseBeaconReceiver.address
  })
}

async function assertAddresses({ votingAddress, lidoOracleAddress }, instance, desc) {
  assert.addressEqual(await instance.VOTING(), votingAddress, `${desc}: wrong address`)
  assert.addressEqual(await instance.ORACLE(), lidoOracleAddress, `${desc}: wrong address`)
  log.success(`Lido addresses are correct`)
}

module.exports = runOrWrapScript(obtainInstance, module)
