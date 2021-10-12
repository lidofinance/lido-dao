const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, logHeader, yl, gr } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('./constants')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = ['depositorAddress', 'depositorParams', 'app:aragon-agent']

async function transferOwnership({ web3, artifacts }) {
  const appArtifact = 'DepositSecurityModule'
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const depositor = await artifacts.require(appArtifact).at(state.depositorAddress)
  const agentAddress = state[`app:${APP_NAMES.ARAGON_AGENT}`].proxyAddress

  const txName = `tx-19-transfer-depositor-ownership.json`
  const desc = 'Transfer ownership to Agent'
  await saveCallTxData(desc, depositor, 'setOwner', txName, {
    arguments: [agentAddress],
    from: DEPLOYER || state.multisigAddress
  })

  log.splitter()
  log(gr(`Before continuing the deployment, please send all transactions listed above.`))
  log(gr(`You must complete it positively and execute before continuing with the deployment!`))
  log.splitter()
}

module.exports = runOrWrapScript(transferOwnership, module)
