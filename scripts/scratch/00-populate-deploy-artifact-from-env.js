const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { readNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const DEPLOYER = process.env.DEPLOYER
const GATE_SEAL_FACTORY = process.env.GATE_SEAL_FACTORY
const GENESIS_TIME = parseInt(process.env.GENESIS_TIME)
const DEPOSIT_CONTRACT = process.env.DEPOSIT_CONTRACT
const WITHDRAWAL_QUEUE_BASE_URI = process.env.WITHDRAWAL_QUEUE_BASE_URI

async function saveDeployParameters({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  console.log('Using env values:')
  console.log({
    DEPLOYER,
    GATE_SEAL_FACTORY,
    GENESIS_TIME,
    DEPOSIT_CONTRACT,
    WITHDRAWAL_QUEUE_BASE_URI,
  })

  const state = readNetworkState(network.name, netId)
  const ldoHolder = Object.keys(state.vestingParams.holders)[0]
  const gateSealAddress = (GATE_SEAL_FACTORY === null || GATE_SEAL_FACTORY === ZERO_ADDRESS)
    ? ZERO_ADDRESS : ''

  state.networkId = await web3.eth.net.getId()
  state.chainId = (await ethers.provider.getNetwork()).chainId
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
  if (WITHDRAWAL_QUEUE_BASE_URI !== undefined) {
    state.withdrawalQueueERC721.deployParameters = {
      ...state.withdrawalQueueERC721.deployParameters,
      baseUri: WITHDRAWAL_QUEUE_BASE_URI,
    }
  }
  persistNetworkState(network.name, netId, state)
}

module.exports = runOrWrapScript(saveDeployParameters, module)
