const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { readNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const DEPLOYER = process.env.DEPLOYER
const CHAIN_ID = parseInt(process.env.CHAIN_ID)
const GATE_SEAL_FACTORY = process.env.GATE_SEAL_FACTORY
const GENESIS_TIME = parseInt(process.env.GENESIS_TIME)
const DEPOSIT_CONTRACT = process.env.DEPOSIT_CONTRACT

async function saveDeployParameters({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  console.log('Using env values:')
  console.log({
    DEPLOYER,
    CHAIN_ID,
    GATE_SEAL_FACTORY,
    GENESIS_TIME,
    DEPOSIT_CONTRACT,
  })

  const state = readNetworkState(network.name, netId)
  const ldoHolder = Object.keys(state.vestingParams.holders)[0]
  const gateSealAddress = (GATE_SEAL_FACTORY === "" || GATE_SEAL_FACTORY === ZERO_ADDRESS)
    ? ZERO_ADDRESS : ''

  state.chainId = CHAIN_ID
  state.deployer = DEPLOYER
  state.gateSeal = {
    ...state.gateSeal,
    factoryAddress: GATE_SEAL_FACTORY,
    sealingCommittee: ldoHolder,
    address: gateSealAddress,
  }
  state.chainSpec = {
    ...state.chainSpec,
    genesisTime: GENESIS_TIME,
    depositContract: DEPOSIT_CONTRACT,
  }
  persistNetworkState(network.name, netId, state)
}

module.exports = runOrWrapScript(saveDeployParameters, module)
