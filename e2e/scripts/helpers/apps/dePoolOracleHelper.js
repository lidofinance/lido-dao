import { abi as DePoolOracleAbi } from '../../../../artifacts/DePoolOracle.json'
import { createVote, voteForAction } from './votingHelper'
import { encodeCallScript } from '@aragon/contract-helpers-test/src/aragon-os'

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

async function hasInitialized() {
  return await dePoolOracleContract.methods.hasInitialized().call()
}

async function pushData(epoch, amount, sender) {
  console.log('ppoolc ' + (await dePoolOracleContract.methods.pool().call()))
  console.log('INTERVAL ' + (await getCurrentReportInterval()))
  return await dePoolOracleContract.methods.pushData(epoch, amount).send({ from: sender, gas: '3000000' })
}

async function setQuorum(quorum, holder, holders) {
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: await dePoolOracleContract.methods.setQuorum(quorum).encodeABI()
    }
  ])

  const voteId = await createVote(callData1, holder, 'Set quorum')
  await voteForAction(voteId, holders, 'Set quorum')
}

async function getAllOracleMembers() {
  return await dePoolOracleContract.methods.getOracleMembers().call()
}

// TODO delete?
async function getCurrentReportInterval() {
  return await dePoolOracleContract.methods.getCurrentReportInterval().call()
}

async function addOracleMembers(members, holder, holders) {
  for (const member of members) {
    const callData1 = encodeCallScript([
      {
        to: getProxyAddress(),
        calldata: await dePoolOracleContract.methods.addOracleMember(member).encodeABI()
      }
    ])

    const voteId = await createVote(callData1, holder, 'Add oracle member')
    await voteForAction(voteId, holders, 'Add oracle member')
  }
}

async function getQuorum() {
  console.log('LATEST DATA', await dePoolOracleContract.methods.getLatestData().call())
  return await dePoolOracleContract.methods.getQuorum().call()
}

export {
  init,
  getProxyAddress,
  dePoolOracleContract,
  pushData,
  getAllOracleMembers,
  addOracleMembers,
  getCurrentReportInterval,
  getQuorum,
  setQuorum,
  hasInitialized
}
