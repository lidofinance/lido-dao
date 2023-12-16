const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')
const { getEventArgument } = require('@aragon/contract-helpers-test')
const { makeTx, TotalGasCounter } = require('../helpers/deploy')

const { APP_NAMES } = require('../constants')

const REQUIRED_NET_STATE = [
  "deployer",
  "gateSeal",
  "validatorsExitBusOracle",
  "withdrawalQueueERC721",
]

async function deployNewContracts({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()
  logWideSplitter()
  log(`Network ID:`, yl(netId))
  let state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  if (state.gateSeal.address !== "") {
    console.log(`Using the specified GateSeal address ${state.gateSeal.address}`)
    return
  }

  const gateSealFactoryAddress = state.gateSeal.factoryAddress
  const deployer = state.deployer
  const sealables = [
    state.withdrawalQueueERC721.proxy.address,
    state.validatorsExitBusOracle.proxy.address,
  ]

  const GateSealFactory = await artifacts.require("IGateSealFactory")
  const gateSealFactory = await GateSealFactory.at(gateSealFactoryAddress)
  const receipt = await makeTx(gateSealFactory, "create_gate_seal", [
    state.gateSeal.sealingCommittee,
    state.gateSeal.sealDuration,
    sealables,
    state.gateSeal.expiryTimestamp,
  ], { from: deployer })
  const gateSealAddress = await getEventArgument(receipt, 'GateSealCreated', 'gate_seal')
  console.log(`GateSeal created: ${gateSealAddress}`)
  state.gateSeal.address = gateSealAddress
  persistNetworkState(network.name, netId, state)

  await TotalGasCounter.incrementTotalGasUsedInStateFile()
}

module.exports = runOrWrapScript(deployNewContracts, module)
