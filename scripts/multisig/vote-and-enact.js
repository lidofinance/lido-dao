const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('./constants')

const REQUIRED_NET_STATE = ['daoInitialSettings', `app:${APP_NAMES.ARAGON_VOTING}`, 'owner']

const maxWaitVoteTimeSecs = 60

const timer = ms => new Promise( res => setTimeout(res, ms))

async function voteAndEnact({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  logSplitter()

  log(`Using ENS:`, yl(state.ensAddress))
  log.splitter()

  const votingAddress = state[`app:${APP_NAMES.ARAGON_VOTING}`].proxyAddress
  const voting = await artifacts.require('Voting').at(votingAddress)

  // Get voteId from env or use the latest vote id
  let voteId = process.env.VOTE_ID || ''
  if (voteId === '') {
    voteId = ((await voting.votesLength()).toString() - 1).toString()
  }

  const ldoMegaHolder = state['owner']
  log.splitter()

  log(`Voting for vote ${voteId}...`)
  await voting.vote(voteId, true, false, { from: ldoMegaHolder })

  const voteTimeSecs = +(await voting.voteTime()).toString()
  if (voteTimeSecs <= maxWaitVoteTimeSecs) {
    console.log(`Wait ${voteTimeSecs} seconds till the voting is over`)
    await timer(voteTimeSecs * 1000)

    // NB: the vote won't execute till the voting time passes
    //     for a local hardhat node we can trick the time with
    //     `await ethers.provider.send("evm_mine", [newTimestampInSeconds]);`
    //     but cannot for a geth node
    await voting.executeVote(voteId, { from: ldoMegaHolder })
    log(`Vote ${voteId} executed!`)
  } else {
    console.log(`The voting time ${voteTimeSecs} secs for vote ${voteId} is too long to wait in this script.
You'd need to enact it manually`)
  }
}

module.exports = runOrWrapScript(voteAndEnact, module)
