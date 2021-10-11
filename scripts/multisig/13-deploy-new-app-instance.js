const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveDeployTx } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES, APP_ARTIFACTS } = require('./constants')
const VALID_APP_NAMES = Object.entries(APP_NAMES).map((e) => e[1])

const APP = process.env.APP || ''
const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = ['lidoApmEnsName', 'lidoApmAddress']

async function upgradeApp({ web3, artifacts, appName = APP }) {
  if (!appName || !VALID_APP_NAMES.includes(appName)) {
    throw new Error('Wrong app name')
  }
  const appArtifact = APP_ARTIFACTS[appName]
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE.concat([`app:${appName}`]))

  logSplitter()

  await saveDeployTx(appArtifact, `tx-13-1-deploy-${appName}-base.json`, {
    from: DEPLOYER || state.multisigAddress
  })

  logSplitter()
  log(gr(`Before continuing the deployment, please send all contract creation transactions`))
  log(gr(`that you can find in the files listed above. You may use a multisig address`))
  log(gr(`if it supports deploying new contract instances.`))
  logSplitter()
}

module.exports = runOrWrapScript(upgradeApp, module)
