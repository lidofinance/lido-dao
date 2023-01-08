const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveDeployTx } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('./constants')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = [
  'daoInitialSettings',
  `app:${APP_NAMES.LIDO}`
]

async function deployELRewardsVault({ web3, artifacts }) {
  const appArtifact = 'LidoExecutionLayerRewardsVault'
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const lidoAddress = state[`app:${APP_NAMES.LIDO}`].proxyAddress
  log(`Using Lido contract address:`, yl(lidoAddress))

  const lido = await artifacts.require('Lido').at(lidoAddress)
  const treasuryAddr = await lido.getTreasury()

  log(`Using Lido Treasury contract address:`, yl(treasuryAddr))
  logSplitter()

  persistNetworkState(network.name, netId, state, {
    executionLayerRewardsVaultDeployTx: ''
  })

  await saveDeployTx(appArtifact, `tx-26-deploy-execution-layer-rewards-vault.json`, {
    arguments: [lidoAddress, treasuryAddr],
    from: DEPLOYER || state.multisigAddress
  })

  logSplitter()
  log(gr(`Before continuing the deployment, please send all contract creation transactions`))
  log(gr(`that you can find in the files listed above. You may use a multisig address`))
  log(gr(`if it supports deploying new contract instances.`))
  logSplitter()
}

module.exports = runOrWrapScript(deployELRewardsVault, module)
