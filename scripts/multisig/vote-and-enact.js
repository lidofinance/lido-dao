const { hash: namehash } = require('eth-ens-namehash')
const { encodeCallScript } = require('@aragon/contract-helpers-test/src/aragon-os')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('./constants')

const VOTE_ID = process.env.VOTE_ID || ''
const REQUIRED_NET_STATE = ['daoInitialSettings', 'owner', `app:${APP_NAMES.ARAGON_VOTING}`]


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

  log.splitter()
  log(`Executing vote ${VOTE_ID}`)
  const ldoMegaHolder = state['owner']
  await voting.vote(VOTE_ID, true, false, { from: ldoMegaHolder })
  await voting.executeVote(VOTE_ID, { from: ldoMegaHolder })

}

module.exports = runOrWrapScript(voteAndEnact, module)
