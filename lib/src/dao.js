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
  createVote
}
