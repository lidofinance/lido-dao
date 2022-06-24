const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logWideSplitter, logHeader, yl, gr } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = ['depositorAddress', 'depositorParams']

async function obtainInstance({ web3, artifacts }) {
  // convert dash-ed appName to camel case-d
  const appArtifact = 'DepositSecurityModule'
  const netId = await web3.eth.net.getId()

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const { guardians = [], quorum = 1 } = state.depositorParams
  
  logWideSplitter()
  log(`Network ID:`, yl(netId))
  console.log("Going to set these params in addGuardians(guardians, quorum):")
  console.log({ guardians, quorum })
  console.log()

  const depositor = await artifacts.require(appArtifact).at(state.depositorAddress)
  await saveCallTxData(`Set guardians`, depositor, 'addGuardians', `tx-18-depositor-add-guardians.json`, {
    arguments: [guardians, quorum],
    from: DEPLOYER || state.multisigAddress
  })

  log.splitter()
  log(gr(`Before continuing the deployment, please send all transactions listed above.`))
  log(gr(`You must complete it positively and execute before continuing with the deployment!`))
  log.splitter()
}
module.exports = runOrWrapScript(obtainInstance, module)
