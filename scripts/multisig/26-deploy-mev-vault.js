const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveDeployTx } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('./constants')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = ['daoInitialSettings', 'depositorParams', `app:${APP_NAMES.LIDO}`, `app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`]


async function upgradeApp({ web3, artifacts }) {
  const appArtifact = 'LidoMevTxFeeVault'
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const lidoAddress = state[`app:${APP_NAMES.LIDO}`].proxyAddress
  log(`Using Lido address:`, yl(lidoAddress))
  logSplitter()

  const args = [
    lidoAddress,
  ]
  await saveDeployTx(appArtifact, `tx-21-deploy-mev-vault.json`, {
    arguments: args,
    from: DEPLOYER || state.multisigAddress
  })
}

module.exports = runOrWrapScript(upgradeApp, module)
