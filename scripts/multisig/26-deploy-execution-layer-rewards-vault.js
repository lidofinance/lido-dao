const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveDeployTx } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('./constants')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = ['daoInitialSettings', 'depositorParams', `app:${APP_NAMES.LIDO}`, `app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`]

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

  const args = [lidoAddress, treasuryAddr]
  await saveDeployTx(appArtifact, `tx-26-deploy-execution-layer-rewards-vault.json`, {
    arguments: args,
    from: DEPLOYER || state.multisigAddress
  })
}

module.exports = runOrWrapScript(deployELRewardsVault, module)
