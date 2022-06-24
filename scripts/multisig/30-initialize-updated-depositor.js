const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logWideSplitter, logHeader, yl, gr } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { assert } = require('chai')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = ['depositorAddress', 'depositorPreviousAddress']

async function initializeDepositor({ web3, artifacts }) {
  const appArtifact = 'DepositSecurityModule'
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const oldDepositor = await artifacts.require(appArtifact).at(state.depositorPreviousAddress)
  const guardians = await oldDepositor.getGuardians()
  const quorum = +(await oldDepositor.getGuardianQuorum()).toString()

  console.log("Going to set these params in addGuardians(guardians, quorum):")
  console.log({ guardians, quorum })
  console.log()

  const depositor = await artifacts.require(appArtifact).at(state.depositorAddress)
  assert.notEqual(depositor.getGuardians(), guardians, 'Guardians list on the new contract are supposed to be empty')

  await saveCallTxData(`Set guardians`, depositor, 'addGuardians', `tx-30-initialize-updated-depositor.json`, {
    arguments: [guardians, quorum],
    from: DEPLOYER || state.multisigAddress
  })

  log.splitter()
  log(gr(`Before continuing the deployment, please send all transactions listed above.`))
  log(gr(`You must complete it positively and execute before continuing with the deployment!`))
  log.splitter()
}
module.exports = runOrWrapScript(initializeDepositor, module)
