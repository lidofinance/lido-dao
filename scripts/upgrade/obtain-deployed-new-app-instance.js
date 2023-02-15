const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, logHeader, yl } = require('../helpers/log')
const { useOrGetDeployed, assertDeployedBytecode } = require('../helpers/deploy')
const { assert } = require('../helpers/assert')
const { readNetworkState, persistNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES, APP_ARTIFACTS } = require('./constants')
const VALID_APP_NAMES = Object.entries(APP_NAMES).map((e) => e[1])

const APP = process.env.APP || ''
const REQUIRED_NET_STATE = ['ensAddress', 'multisigAddress', 'lidoBaseDeployTx', 'oracleBaseDeployTx', 'nodeOperatorsRegistryBaseDeployTx']

async function obtainInstance({ web3, artifacts, appName = APP }) {
  if (!appName || !VALID_APP_NAMES.includes(appName)) {
    throw new Error('Wrong app name')
  }
  const appArtifact = APP_ARTIFACTS[appName]
  // convert dash-ed appName to camel case-d
  const appNameCC = appName.toLowerCase().replace(/-(.)/g, (m, g) => g.toUpperCase())
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE.concat([`${appNameCC}BaseDeployTx`, `app:${appName}`]))

  logHeader(`${appArtifact} app base`)
  const appBase = await useOrGetDeployed(appArtifact, null, state[`${appNameCC}BaseDeployTx`])
  log(`Checking...`)
  await assertSameBaseAddress(state[`app:${appName}`].baseAddress, appBase.address, appArtifact)
  await assertDeployedBytecode(appBase.address, appArtifact)
  await assertAragonProxyBase(appBase, `${appNameCC}Base`)
  persistNetworkState(network.name, netId, state, {
    [`app:${appName}`]: {
      ...state[`app:${appName}`],
      baseAddress: appBase.address
    }
  })
}

async function assertAragonProxyBase(instance, desc) {
  assert.equal(await instance.hasInitialized(), false, `${desc}: is not initialized`)
  assert.equal(await instance.isPetrified(), true, `${desc}: is petrified`)
  log.success(`is a petrified Aragon base`)
}

async function assertSameBaseAddress(baseAddressOld, baseAddressNew, desc) {
  assert.notEqual(baseAddressOld, baseAddressNew, `${desc}: has the same base address`)
  log.success(`is not the same base address`)
}

module.exports = runOrWrapScript(obtainInstance, module)
