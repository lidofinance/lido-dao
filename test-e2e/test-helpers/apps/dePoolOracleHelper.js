import { abi as DePoolOracleAbi } from '../../../apps/depooloracle/artifacts/DePoolOracle.json'
import { encodeCallScript } from '@aragon/contract-helpers-test/src/aragon-os'
import { createVote } from './votingHelper'

let web3
let context
let dePoolOracleContract

function init(c) {
  if (!context) {
    context = c
    web3 = context.web3
    dePoolOracleContract = new web3.eth.Contract(DePoolOracleAbi, getProxyAddress())
  }
}

function getProxyAddress() {
  return context.apps.dePoolOracleApp.proxyAddress
}

function pushData(epoch, amount, sender) {
  return dePoolOracleContract.methods.pushData(epoch, amount).send({
    from: sender
  })
}

async function getAllOracleMembers() {
  return await dePoolOracleContract.methods.getOracleMembers().call()
}

async function getCurrentReportInterval() {
  return await dePoolOracleContract.methods.getCurrentReportInterval().send({
    from: sender
  })
}

async function getOracleMember(address) {
  return await dePoolOracleContract.methods.findMember(address).call()
}

async function createVoteToAddOracleMember(member, holder) {
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: await dePoolOracleContract.methods.addOracleMember(member).encodeABI()
    }
  ])

  await createVote(callData1, holder)
}
export { init, dePoolOracleContract, pushData, getAllOracleMembers, createVoteToAddOracleMember, getOracleMember, getCurrentReportInterval }
