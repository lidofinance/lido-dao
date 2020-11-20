import { abi as LidoOracleAbi } from '../../../../artifacts/LidoOracle.json'
import { createVote, voteForAction } from './votingHelper'
import { encodeCallScript } from '@aragon/contract-helpers-test/src/aragon-os'
import logger from '../logger'

let web3
let context
export let lidoOracleContract

export function init(c) {
  if (!context) {
    context = c
    web3 = context.web3
    lidoOracleContract = new web3.eth.Contract(LidoOracleAbi, getProxyAddress())
  }
}

export function getProxyAddress() {
  return context.apps.lidoOracleApp.proxyAddress
}

export async function hasInitialized() {
  return await lidoOracleContract.methods.hasInitialized().call()
}

export async function pushData(epoch, amount, sender) {
  return await lidoOracleContract.methods.pushData(epoch, amount).send({ from: sender, gas: '8000000' })
}

export async function setQuorum(quorum, holder, holders) {
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: await lidoOracleContract.methods.setQuorum(quorum).encodeABI()
    }
  ])

  const voteId = await createVote(callData1, holder, 'Set quorum')
  return await voteForAction(voteId, holders, 'Set quorum')
}

export async function setReportIntervalDuration(duration, holder, holders) {
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: await lidoOracleContract.methods.setReportIntervalDuration(duration).encodeABI()
    }
  ])

  const voteId = await createVote(callData1, holder, 'Set report interval duration')
  return await voteForAction(voteId, holders, 'Set report interval duration')
}

export async function getAllOracleMembers() {
  return await lidoOracleContract.methods.getOracleMembers().call()
}

// TODO delete?
export async function getCurrentReportInterval() {
  return await lidoOracleContract.methods.getCurrentReportInterval().call()
}

export async function getReportIntervalDuration() {
  return await lidoOracleContract.methods.getReportIntervalDurationSeconds().call()
}

export async function addOracleMember(member, holder, holders) {
  logger.debug('oracle member ' + member)
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: await lidoOracleContract.methods.addOracleMember(member).encodeABI()
    }
  ])

  const voteId = await createVote(callData1, holder, 'Add oracle member')
  return await voteForAction(voteId, holders, 'Add oracle member')
}

export async function addOracleMembers(members, holder, holders) {
  for (const member of members) {
    await addOracleMember(member, holder, holders)
  }
}

export async function getQuorum() {
  return await lidoOracleContract.methods.getQuorum().call()
}

export async function getLatestData() {
  return await lidoOracleContract.methods.getLatestData().call()
}
