const { hash: namehash } = require('eth-ens-namehash')
const { encodeCallScript } = require('@aragon/contract-helpers-test/src/aragon-os')
const { BN } = require('bn.js')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('./constants')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = [
  'daoAddress',
  `app:${APP_NAMES.ARAGON_VOTING}`,
  `app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`,
  `app:${APP_NAMES.LIDO}`,
]

async function createVoting({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  logSplitter()

  const votingAddress = state[`app:${APP_NAMES.ARAGON_VOTING}`].proxyAddress
  const voting = await artifacts.require('Voting').at(votingAddress)
  const tokenManager = await artifacts.require('TokenManager')
    .at(state[`app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`].proxyAddress)
  const lidoAddress = state[`app:lido`].proxyAddress
  const lido = await artifacts.require('Lido').at(lidoAddress)


  const dailyStakingLimit = ETH(150000)
  const stakeLimitIncreasePerBlock = calcStakeLimitIncreasePerBlock(dailyStakingLimit)

  log(`dailyStakeLimit: `, yl(dailyStakingLimit))
  log(`stakeLimitIncreasePerBlock: `, yl(stakeLimitIncreasePerBlock))

  log.splitter()

  const resumeProtocolCallData = {
    to: lidoAddress,
    calldata: await lido.contract.methods.resume().encodeABI()
  }

  const resumeStakingCallData = {
    to: lidoAddress,
    calldata: await lido.contract.methods.resumeStaking().encodeABI()
  }

  const setStakingLimitCallData = {
    to: lidoAddress,
    calldata: await lido.contract.methods.setStakingLimit(dailyStakingLimit, stakeLimitIncreasePerBlock).encodeABI()
  }


  const encodedUpgradeCallData = encodeCallScript([
    resumeProtocolCallData,
    resumeStakingCallData,
    setStakingLimitCallData,
  ])

  log(`encodedUpgradeCallData:`, yl(encodedUpgradeCallData))
  const votingCallData = encodeCallScript([
    {
      to: votingAddress,
      calldata: await voting.contract.methods.forward(encodedUpgradeCallData).encodeABI()
    }
  ])

  const txName = `tx-31-start-protocol.json`
  const votingDesc = `1) Unpause protocol
2) Unpause staking 
3) Set daily staking limit to ${fromE18ToString(dailyStakingLimit)}`

  await saveCallTxData(votingDesc, tokenManager, 'forward', txName, {
    arguments: [votingCallData],
    from: DEPLOYER || state.multisigAddress
  })

  log.splitter()
  log(gr(`Before continuing the deployment, please send all transactions listed above.`))
  log(gr(`You must complete it positively and execute before continuing with the deployment!`))
  log.splitter()
}

function calcStakeLimitIncreasePerBlock(dailyLimit) {
  const secondsPerBlock = 12
  const secondsPerDay = 24 * 60 * 60
  const blocksPerDay = secondsPerDay / secondsPerBlock
  return Math.floor(dailyLimit / blocksPerDay).toString()
}

function fromE18ToString(x) {
  return `${(x / 1e18).toFixed(3)} ETH (${x} wei)`
}

module.exports = runOrWrapScript(createVoting, module)
