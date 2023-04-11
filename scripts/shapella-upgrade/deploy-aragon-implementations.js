const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveDeployTx, getTotalGasUsed } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { deployWithoutProxy, deployBehindOssifiableProxy, updateProxyImplementation } = require('../helpers/deploy')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const { APP_NAMES } = require('../constants')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = [
  `app:${APP_NAMES.LIDO}`,
  `app:${APP_NAMES.ORACLE}`,
  `app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`,
  // not used, but just to get sure the Merge was undergone
  // `executionLayerRewardsVaultAddress`,
]

async function deployNewContracts({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()
  logWideSplitter()
  log(`Network ID:`, yl(netId))
  let state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  if (!DEPLOYER) {
    throw new Error('Deployer is not specified')
  }
  const deployer = DEPLOYER

  await deployWithoutProxy(`app:${APP_NAMES.LIDO}`, 'Lido', deployer, [], 'implementation')

  await deployWithoutProxy(`app:${APP_NAMES.ORACLE}`, 'LegacyOracle', deployer, [], 'implementation')

  await deployWithoutProxy(`app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`, 'NodeOperatorsRegistry', deployer, [], 'implementation')

  console.log(`Total gas used by this deploy script: ${getTotalGasUsed()}`)
}

module.exports = runOrWrapScript(deployNewContracts, module)
