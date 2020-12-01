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

export async function reportBeacon(epoch, oracleData, beaconValidatorsCount, sender) {
  return await lidoOracleContract.methods.reportBeacon(epoch, oracleData, beaconValidatorsCount).send({ from: sender, gas: '8000000' })
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

export async function setBeaconSpec({ epochsPerFrame, slotsPerEpoch, secondsPerSlot, genesisTime }, holder, holders) {
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: await lidoOracleContract.methods.setBeaconSpec(epochsPerFrame, slotsPerEpoch, secondsPerSlot, genesisTime).encodeABI()
    }
  ])

  const voteId = await createVote(callData1, holder, 'Set beacon spec')
  return await voteForAction(voteId, holders, 'Set beacon spec')
}

export async function getAllOracleMembers() {
  return await lidoOracleContract.methods.getOracleMembers().call()
}

// TODO delete?
export async function getCurrentReportInterval() {
  return await lidoOracleContract.methods.getCurrentReportInterval().call()
}

export async function getBeaconSpec() {
  return await lidoOracleContract.methods.beaconSpec().call()
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

export async function waitForReportBeacon() {
  const fromBlock = await web3.eth.getBlockNumber()
  return new Promise((resolve, reject) => {
    lidoOracleContract.once(
      'Completed',
      {
        fromBlock
      },
      (error, event) => (error ? reject(error) : resolve(event.returnValues))
    )
  })
}
