import { abi as vaultAbi } from '@aragon/apps-finance/abi/Vault.json'
import { abi as votingAbi } from '@aragon/apps-voting/abi/Voting.json'
import { abi as financeAbi } from '@aragon/apps-finance/abi/Finance.json'
import { encodeCallScript } from '@aragon/contract-helpers-test/src/aragon-os'
import { init as tokenManagerInit, tokenManagerContract } from './tokenManagerHelper'

const financeAbiExt = financeAbi.concat(vaultAbi.filter((i) => i.type === 'event'))
const votingAbiExt = votingAbi.concat(financeAbiExt.filter((i) => i.type === 'event'))

let context
let voteContract
let tokenManager
let logger

function init(c) {
  if (!context) {
    context = c
    tokenManagerInit(context)
    tokenManager = tokenManagerContract
    voteContract = new context.web3.eth.Contract(votingAbiExt, getProxyAddress())
    logger = context.logger
  }
}
function getProxyAddress() {
  return context.apps.votingApp.proxyAddress
}
async function hasInitialized() {
  return await voteContract.methods.hasInitialized().call()
}

async function createVote(callData1, holder, voteName = '') {
  logger.info('Create vote to ' + voteName)
  const callData2 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: await voteContract.methods.forward(callData1).encodeABI()
    }
  ])
  const receipt = await tokenManager.methods.forward(callData2).send({
    from: holder,
    gas: '1000000'
  })
  const { voteId } = receipt.events.StartVote.returnValues

  return voteId
}
async function voteForAction(voteId, holders, voteName = '') {
  logger.info('Vote for ' + voteName)
  for (let i = 0; i < holders.length; i++) {
    logger.debug(`Voting from holder - (${i + 1}) ~ ${holders[i]}`)
    await voteContract.methods.vote(voteId, true, true).send({ from: holders[i], gas: '1000000' })
  }

  // TODO vote assert?
}

export { init, createVote, voteForAction, hasInitialized }
