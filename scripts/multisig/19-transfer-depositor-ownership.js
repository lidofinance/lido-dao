const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, logHeader, yl } = require('../helpers/log')
const { useOrGetDeployed, assertDeployedBytecode } = require('../helpers/deploy')
const { assert } = require('../helpers/assert')
const { saveCallTxData } = require('../helpers/tx-data')
const { readNetworkState, persistNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('./constants')

const APP = process.env.APP || ''
const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = [
  'depositorDeployTx',
  'daoInitialSettings',
  'depositorParams',
  'app:aragon-agent'
]

async function transferOwnership({ web3, artifacts, appName = APP }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const tokenManagerAddress = state[`app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`].proxyAddress
  const depositor = await artifacts.require('DepositSecurityModule').at(tokenManagerAddress)
  const agentAddress = state[`app:${APP_NAMES.ARAGON_AGENT}`].proxyAddress
  
  const txName = `tx-19-transfer-depositor-ownership.json`
  const desc = 'Transfer ownership to Agent'
  await saveCallTxData(desc, depositor, 'setOwner', txName, {
    arguments: [agentAddress],
    from: DEPLOYER || state.multisigAddress
  })

  log.splitter()
  log(gr(`Before continuing the deployment, please send all transactions listed above.`))
  log(gr(`A new voting will be created to add a new "${appName}" implementation to Lido APM.`))
  log(gr(`You must complete it positively and execute before continuing with the deployment!`))
  log.splitter()

}

module.exports = runOrWrapScript(transferOwnership, module)
