const BN = require('bn.js')
const { getEventArgument } = require('@aragon/contract-helpers-test')
const { encodeCallScript } = require('@aragon/contract-helpers-test/src/aragon-os')

const { getContract, getABI } = require('./abi')

const Voting = getContract('Voting')
const TokenManager = getContract('TokenManager')

async function getVoting(web3, address) {
  Voting.setProvider(web3.currentProvider)
  return await Voting.at(address)
}

async function getTokenManager(web3, address) {
  TokenManager.setProvider(web3.currentProvider)
  return await TokenManager.at(address)
}

async function proposeChangingVotingQuorum(voting, tokenManager, newQuorumPct, txOpts) {
  const newQuorumBp = percentToBp18(newQuorumPct)
  const calldata = await voting.contract.methods.changeMinAcceptQuorumPct(newQuorumBp).encodeABI()
  const evmScript = encodeCallScript([{ to: voting.address, calldata }])
  const voteDesc = `Change min acceptance quorum to ${newQuorumPct}%`
  return await createVote(voting, tokenManager, voteDesc, evmScript, txOpts)
}

async function proposeChangingVotingSupport(voting, tokenManager, newSupportPct, txOpts) {
  const newSupportBp = percentToBp18(newSupportPct)
  const calldata = await voting.contract.methods.changeSupportRequiredPct(newSupportBp).encodeABI()
  const evmScript = encodeCallScript([{ to: voting.address, calldata }])
  const voteDesc = `Change min support required to ${newSupportPct}%`
  return await createVote(voting, tokenManager, voteDesc, evmScript, txOpts)
}

const TEN_TO_16 = new BN(10).pow(new BN(16))

function percentToBp18(percent) {
  if (percent < 0 || percent > 100) {
    throw new Error(`invalid percentage value ${percent}%`)
  }
  return TEN_TO_16.muln(percent | 0).toString()
}

async function createVote(voting, tokenManager, voteDesc, evmScript, txOpts) {
  const newVoteEvmScript = encodeCallScript([
    {
      to: voting.address,
      calldata: await voting.contract.methods.newVote(evmScript, voteDesc, false, false).encodeABI()
    }
  ])
  const result = await tokenManager.forward(newVoteEvmScript, txOpts)
  const voteId = getEventArgument(result, 'StartVote', 'voteId', { decodeForAbi: getABI('Voting') })
  return { result, voteId }
}

module.exports = {
  Voting,
  TokenManager,
  getVoting,
  getTokenManager,
  proposeChangingVotingQuorum,
  proposeChangingVotingSupport,
  createVote
}
