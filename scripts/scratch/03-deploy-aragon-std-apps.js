const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { deployImplementation, TotalGasCounter } = require('../helpers/deploy')

const REQUIRED_NET_STATE = [
  'deployer',
]

async function deployAragonStdApps({ web3, artifacts, }) {
  const netId = await web3.eth.net.getId()
  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const deployer = state.deployer
  await deployImplementation("app:aragon-agent", "Agent", deployer)
  await deployImplementation("app:aragon-finance", "Finance", deployer)
  await deployImplementation("app:aragon-token-manager", "TokenManager", deployer)
  await deployImplementation("app:aragon-voting", "Voting", deployer)

  await TotalGasCounter.incrementTotalGasUsedInStateFile()
}


module.exports = runOrWrapScript(deployAragonStdApps, module)
