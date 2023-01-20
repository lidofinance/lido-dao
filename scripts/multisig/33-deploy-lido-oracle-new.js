const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { deployBehindOssifiableProxy } = require('../helpers/deploy-shapella')
const REQUIRED_NET_STATE = [
]
const DEPLOYER = process.env.DEPLOYER

async function deployLidoOracleNew({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()
  logWideSplitter()
  log(`Network ID:`, yl(netId))
  console.log({DEPLOYER})

  let state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  logWideSplitter()

  await deployBehindOssifiableProxy("lidoOracle", "LidoOracleNew", DEPLOYER, DEPLOYER, [])
  logWideSplitter()
}

module.exports = runOrWrapScript(deployLidoOracleNew, module)
