const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { readNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const DEPLOYER = process.env.DEPLOYER
const CHAIN_ID = parseInt(process.env.CHAIN_ID)
const GATE_SEAL_FACTORY = process.env.GATE_SEAL_FACTORY || ZERO_ADDRESS
const GENESIS_TIME = parseInt(process.env.GENESIS_TIME)
const DEPOSIT_CONTRACT = process.env.DEPOSIT_CONTRACT

async function saveDeployParameters({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  const state = readNetworkState(network.name, netId)
  const ldoHolder = Object.keys(state.vestingParams.holders)[0]
  const gateSealAddress = (GATE_SEAL_FACTORY === "" || GATE_SEAL_FACTORY === ZERO_ADDRESS)
    ? ZERO_ADDRESS : ""
  persistNetworkState(network.name, netId, state, {
    chainId: CHAIN_ID,
    multisigAddress: DEPLOYER,
    owner: DEPLOYER,
    gateSeal: {
      ...state.gateSeal,
      factoryAddress: GATE_SEAL_FACTORY,
      sealingCommittee: ldoHolder,
      address: gateSealAddress,
    },
    chainSpec: {
      ...state.chainSpec,
      genesisTime: GENESIS_TIME,
      depositContract: DEPOSIT_CONTRACT,
    },
  })
}

module.exports = runOrWrapScript(saveDeployParameters, module)
