const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveDeployTx } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('./constants')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = ['daoInitialSettings', 'depositorParams', `app:${APP_NAMES.LIDO}`, `app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`]

async function upgradeApp({ web3, artifacts }) {
  const appArtifact = 'DepositSecurityModule'
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const lidoAddress = state[`app:${APP_NAMES.LIDO}`].proxyAddress
  log(`Using Lido address:`, yl(lidoAddress))
  const nosAddress = state[`app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`].proxyAddress
  log(`Using NOS address:`, yl(nosAddress))
  const { depositContractAddress } = state.daoInitialSettings.beaconSpec
  log(`Using Deposit Contract:`, yl(depositContractAddress))
  logSplitter()

  const { maxDepositsPerBlock, minDepositBlockDistance, pauseIntentValidityPeriodBlocks } = state.depositorParams
  const args = [
    lidoAddress,
    depositContractAddress,
    nosAddress,
    netId,
    maxDepositsPerBlock,
    minDepositBlockDistance,
    pauseIntentValidityPeriodBlocks
  ]
  await saveDeployTx(appArtifact, `tx-16-deploy-depositor.json`, {
    arguments: args,
    from: DEPLOYER || state.multisigAddress
  })
  persistNetworkState(network.name, netId, state, {
    depositorConstructorArgs: args
  })

  logSplitter()
  log(gr(`Before continuing the deployment, please send all contract creation transactions`))
  log(gr(`that you can find in the files listed above. You may use a multisig address`))
  log(gr(`if it supports deploying new contract instances.`))
  logSplitter()
}

module.exports = runOrWrapScript(upgradeApp, module)
