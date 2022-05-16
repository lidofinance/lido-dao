const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, logHeader, yl } = require('../helpers/log')
const { useOrGetDeployed, assertDeployedBytecode } = require('../helpers/deploy')
const { assert } = require('../helpers/assert')
const { readNetworkState, persistNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES, APP_ARTIFACTS } = require('./constants')

const REQUIRED_NET_STATE = [
  'executionLayerRewardsVaultDeployTx',
  `app:${APP_NAMES.LIDO}`,
]

async function obtainInstance({ web3, artifacts }) {
  // convert dash-ed appName to camel case-d
  const appArtifact = 'LidoExecutionLayerRewardsVault'
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  logHeader(`${appArtifact} app base`)
  const vault = await useOrGetDeployed(appArtifact, null, state.executionLayerRewardsVaultDeployTx)
  log(`Checking...`)
  const lidoAddress = state[`app:${APP_NAMES.LIDO}`].proxyAddress
  await assertAddresses({ lidoAddress }, vault, appArtifact)
  persistNetworkState(network.name, netId, state, {
    executionLayerRewardsVaultAddress: vault.address
  })
}


async function assertAddresses({ lidoAddress }, instance, desc) {
  assert.equal(await instance.LIDO(), lidoAddress, `${desc}: wrong lido`)
  log.success(`Lido address is correct`)
}

module.exports = runOrWrapScript(obtainInstance, module)
