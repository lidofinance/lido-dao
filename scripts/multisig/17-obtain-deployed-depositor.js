const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, logHeader, yl } = require('../helpers/log')
const { useOrGetDeployed, assertDeployedBytecode } = require('../helpers/deploy')
const { assert } = require('../helpers/assert')
const { readNetworkState, persistNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES, APP_ARTIFACTS } = require('./constants')
const VALID_APP_NAMES = Object.entries(APP_NAMES).map((e) => e[1])

const APP = process.env.APP || ''
const REQUIRED_NET_STATE = [
  'depositorDeployTx',
  'daoInitialSettings',
  'depositorParams',
  `app:${APP_NAMES.LIDO}`,
  `app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`
]

async function obtainInstance({ web3, artifacts, appName = APP }) {
  // convert dash-ed appName to camel case-d
  const appArtifact = 'DepositSecurityModule'
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  logHeader(`${appArtifact} app base`)
  const depositor = await useOrGetDeployed(appArtifact, null, state.depositorDeployTx)
  log(`Checking...`)
  const lidoAddress = state[`app:${APP_NAMES.LIDO}`].proxyAddress
  const nosAddress = state[`app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`].proxyAddress
  const { depositContractAddress } = state.daoInitialSettings.beaconSpec

  await assertParams(state.depositorParams, depositor, appArtifact)
  await assertAddresses({ lidoAddress, nosAddress, depositContractAddress }, depositor, appArtifact)

  // If the depositor is already deployed save its previous address
  const depositorCurrentAddress = state['depositorAddress']
  const newDepositorState =  {
    depositorAddress: depositor.address
  }
  if (depositorCurrentAddress !== undefined && depositor.address !== depositorCurrentAddress) {
    newDepositorState['depositorPreviousAddress'] = depositorCurrentAddress
  }
  persistNetworkState(network.name, netId, state, newDepositorState)
}

async function assertParams({ maxDepositsPerBlock, minDepositBlockDistance, pauseIntentValidityPeriodBlocks }, instance, desc) {
  assert.equal(
    await instance.getPauseIntentValidityPeriodBlocks(),
    pauseIntentValidityPeriodBlocks,
    `${desc}: wrong pauseIntentValidityPeriodBlocks`
  )
  assert.equal(await instance.getMaxDeposits(), maxDepositsPerBlock, `${desc}: wrong maxDepositsPerBlock`)
  assert.equal(await instance.getMinDepositBlockDistance(), minDepositBlockDistance, `${desc}: wrong minDepositBlockDistance`)
  log.success(`params are correct`)
}

async function assertAddresses({ lidoAddress, nosAddress, depositContractAddress }, instance, desc) {
  assert.equal(await instance.getNodeOperatorsRegistry(), nosAddress, `${desc}: wrong nosAddress`)
  assert.equal(await instance.LIDO(), lidoAddress, `${desc}: wrong lidoAddress`)
  assert.equal(await instance.DEPOSIT_CONTRACT(), depositContractAddress, `${desc}: wrong depositContractAddress`)
  log.success(`Lido addresses are correct`)
}

module.exports = runOrWrapScript(obtainInstance, module)
