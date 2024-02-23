const { artifacts } = require('hardhat')
const { getEventArgument } = require('@aragon/contract-helpers-test')
const { encodeCallScript } = require('@aragon/contract-helpers-test/src/aragon-os')
const { advanceChainTime } = require('./blockchain')
const Voting = artifacts.require('Voting')

async function createVote(voting, tokenManager, voteDesc, evmScript, txOpts) {
  const newVoteEvmScript = encodeCallScript([
    {
      to: voting.address,
      calldata: await voting.contract.methods.newVote(evmScript, voteDesc).encodeABI(),
    },
  ])
  const tx = await tokenManager.forward(newVoteEvmScript, txOpts)
  return getEventArgument(tx, 'StartVote', 'voteId', { decodeForAbi: Voting.abi })
}

async function enactVote(voting, voteId, txOpts) {
  const voteTime = (await voting.voteTime()).toNumber()
  await advanceChainTime(voteTime)
  return await voting.executeVote(voteId, txOpts)
}

module.exports = {
  createVote,
  enactVote,
}
