const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveDeployTx } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('./constants')

const DEPLOYER = process.env.DEPLOYER || ''

const REQUIRED_NET_STATE = [
  'lidoApmEnsName',
  'ensAddress',
  'daoAddress',
  `app:${APP_NAMES.ARAGON_VOTING}`,
  `app:${APP_NAMES.ORACLE}`
]

async function upgradeApp({ web3, artifacts }) {
  const appArtifact = 'CompositePostRebaseBeaconReceiver'
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const votingAddress = state[`app:${APP_NAMES.ARAGON_VOTING}`].proxyAddress
  const lidoOracleAddress = state[`app:${APP_NAMES.ORACLE}`].proxyAddress
  log(`Using Voting address:`, yl(votingAddress))
  log(`Using LidoOracle address:`, yl(lidoOracleAddress))
  logSplitter()

  const args = [ votingAddress, lidoOracleAddress ]

  await saveDeployTx(appArtifact, `tx-21-deploy-composite-post-rebase-beacon-receiver.json`, {
    arguments: args,
    from: DEPLOYER || state.multisigAddress
  })
  persistNetworkState(network.name, netId, state, {
    compositePostRebaseBeaconReceiverConstructorArgs: args
  })

  logSplitter()
  log(gr(`Before continuing the deployment, please send all contract creation transactions`))
  log(gr(`that you can find in the files listed above. You may use a multisig address`))
  log(gr(`if it supports deploying new contract instances.`))
  logSplitter()
}

module.exports = runOrWrapScript(upgradeApp, module)
