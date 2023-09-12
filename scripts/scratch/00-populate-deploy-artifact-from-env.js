const chalk = require('chalk')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, yl, gr } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const DEPLOYER = process.env.DEPLOYER
const CHAIN_ID = process.env.CHAIN_ID
const GATE_SEAL = process.env.GATE_SEAL
const GENESIS_TIME = process.env.GENESIS_TIME
const DEPOSIT_CONTRACT = process.env.DEPOSIT_CONTRACT

async function saveDeployParameters({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  const state = readNetworkState(network.name, netId)
  persistNetworkState(network.name, netId, state, {
    chainId: CHAIN_ID,
    multisigAddress: DEPLOYER,
    owner: DEPLOYER,
    gateSealAddress: GATE_SEAL,
    chainSpec: {
      ...state.chainSpec,
      genesisTime: GENESIS_TIME,
      depositContract: DEPOSIT_CONTRACT,
    },
  })
}

module.exports = runOrWrapScript(saveDeployParameters, module)
