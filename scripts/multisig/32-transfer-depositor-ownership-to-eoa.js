const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, logHeader, yl, gr } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('./constants')
const { encodeCallScript } = require('@aragon/contract-helpers-test/src/aragon-os')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = ['depositorAddress', 'depositorParams', 'app:aragon-agent']

async function transferOwnership({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const depositorAddress = state.depositorAddress
  const depositor = await artifacts.require('DepositSecurityModule').at(depositorAddress)
  const votingAddress = state[`app:${APP_NAMES.ARAGON_VOTING}`].proxyAddress
  const agentAddress = state[`app:${APP_NAMES.ARAGON_AGENT}`].proxyAddress
  const tokenManagerAddress = state[`app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`].proxyAddress
  const voting = await artifacts.require('Voting').at(votingAddress)
  const agent = await artifacts.require('Agent').at(agentAddress)
  const tokenManager = await artifacts.require('TokenManager').at(tokenManagerAddress)
  const newOwner = '0x258eD4acC9d4c0bDb481d7f2329c7Bbd52292b01'

  const ownershipCallData = {
    to: depositorAddress,
    calldata: await depositor.contract.methods.setOwner(newOwner).encodeABI()
  }

  const agentCallData = {
    to: agentAddress,
    calldata: await agent.contract.methods.forward(encodeCallScript([ownershipCallData])).encodeABI()
  }

  const votingCallData = encodeCallScript([
    {
      to: votingAddress,
      calldata: await voting.contract.methods.forward(encodeCallScript([agentCallData])).encodeABI()
    }
  ])

  const txName = `tx-32-transfer-depositor-ownership-to-eoa.json`
  const votingDesc = `Transfer ownership to ${newOwner}`

  await saveCallTxData(votingDesc, tokenManager, 'forward', txName, {
    arguments: [votingCallData],
    from: DEPLOYER || state.multisigAddress
  })

  log.splitter()
  log(gr(`Before continuing the deployment, please send all transactions listed above.`))
  log(gr(`You must complete it positively and execute before continuing with the deployment!`))
  log.splitter()
}

module.exports = runOrWrapScript(transferOwnership, module)
