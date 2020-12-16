import { abi as nosAbi } from '../../../../artifacts/NodeOperatorsRegistry.json'
import { encodeCallScript } from '@aragon/contract-helpers-test/src/aragon-os'
import { createVote, voteForAction } from './votingHelper'
import { concatKeys } from '../utils'
// import { init as stEthHelperInit, getPooledEthByShares, getSharesByHolder } from './stEthHelper'
import logger from '../logger'

let web3
let context
export let nodeOperatorsContract

export function init(c) {
  if (!context) {
    context = c
    web3 = context.web3
    // stEthHelperInit(context)
    nodeOperatorsContract = new web3.eth.Contract(nosAbi, getProxyAddress())
  }
}

export function getProxyAddress() {
  return context.apps.nodeOperatorsApp.proxyAddress
}

export async function hasInitialized() {
  return await nodeOperatorsContract.methods.hasInitialized().call()
}

export async function reportStoppedValidator(nodeOperatorId, increment, sender) {
  return await nodeOperatorsContract.methods.reportStoppedValidators(nodeOperatorId, increment).send({ from: sender, gas: '1000000' })
}

export async function setNodeOperatorActive(nodeOperatorId, status, sender) {
  await nodeOperatorsContract.methods.setNodeOperatorActive(nodeOperatorId, status).send({ from: sender, gas: '1000000' })
}

export async function setNodeOperatorName(nodeOperatorId, name, sender) {
  await nodeOperatorsContract.methods.setNodeOperatorName(nodeOperatorId, name).send({ from: sender, gas: '1000000' })
}

export async function setNodeOperatorRewardAddress(nodeOperatorId, rewardAddress, sender) {
  await nodeOperatorsContract.methods.setNodeOperatorRewardAddress(nodeOperatorId, rewardAddress).send({ from: sender, gas: '1000000' })
}

export async function setNodeOperatorStakingLimit(nodeOperatorId, limit, sender) {
  await nodeOperatorsContract.methods.setNodeOperatorStakingLimit(nodeOperatorId, limit).send({ from: sender, gas: '1000000' })
}

export async function addNodeOperator(name, member, stakingLimit, holder, holders) {
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: await nodeOperatorsContract.methods.addNodeOperator(name, member, stakingLimit).encodeABI()
    }
  ])

  const voteId = await createVote(callData1, holder, 'Add node operator - ' + name)
  return await voteForAction(voteId, holders, 'Add node operator  - ' + name)
}

export async function addSigningKeys(nodeOperatorId, validatorsTestData, holder, holders) {
  const validatorsPubKeys = concatKeys(validatorsTestData.pubKeys)
  const validatorsSignatures = concatKeys(validatorsTestData.signatures)
  logger.debug('PubKeys to add ' + validatorsPubKeys)
  logger.debug('Signatures to add' + validatorsSignatures)
  // TODO can be replaced without vote
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: await nodeOperatorsContract.methods
        .addSigningKeys(nodeOperatorId, validatorsTestData.pubKeys.length, validatorsPubKeys, validatorsSignatures)
        .encodeABI()
    }
  ])

  const voteId = await createVote(callData1, holder, 'Add signing keys')
  return await voteForAction(voteId, holders, 'Add signing keys')
}

export async function addSigningKeysOperatorBH(nodeOperatorId, validatorsTestData, nosMember) {
  const validatorsPubKeys = concatKeys(validatorsTestData.pubKeys)
  const validatorsSignatures = concatKeys(validatorsTestData.signatures)
  // logger.debug('PubKeys to add ' + validatorsPubKeys)
  // logger.debug('Signatures to add' + validatorsSignatures)
  return await nodeOperatorsContract.methods
    .addSigningKeysOperatorBH(nodeOperatorId, validatorsTestData.pubKeys.length, validatorsPubKeys, validatorsSignatures)
    .send({ from: nosMember })
}

export async function getUnusedSigningKeyCount(nodeOperatorId) {
  return await nodeOperatorsContract.methods.getUnusedSigningKeyCount(nodeOperatorId).call()
}

export async function getNodeOperator(nodeOperatorId, fullInfo = true) {
  return await nodeOperatorsContract.methods.getNodeOperator(nodeOperatorId, fullInfo).call()
}
export async function getSigningKey(nodeOperatorId, signingKeyId) {
  return await nodeOperatorsContract.methods.getSigningKey(nodeOperatorId, signingKeyId).call()
}

export async function getAllSigningKeys(nodeOperator, nodeOperatorId) {
  const signingKeysCount = nodeOperator.totalSigningKeys
  const pubKeys = []
  const signatures = []
  for (let i = 0; i < signingKeysCount; i++) {
    const signingKeyInfo = await getSigningKey(nodeOperatorId, i)
    pubKeys.push(signingKeyInfo.key)
    signatures.push(signingKeyInfo.depositSignature)
  }
  return {
    pubKeys,
    signatures
  }
}

export async function getNodeOperatorsCount() {
  return await nodeOperatorsContract.methods.getNodeOperatorsCount().call()
}

export async function getActiveSigningKeys(nodeOperator, nosSigningKeys) {
  const usedSigningKeysCount = nodeOperator.usedSigningKeys
  const activeSigningKeys = []
  for (let i = 0; i < usedSigningKeysCount; i++) {
    activeSigningKeys.push(nosSigningKeys.pubKeys[i])
  }
  return activeSigningKeys
}

export async function getActiveNodeOperatorsCount() {
  return await nodeOperatorsContract.methods.getActiveNodeOperatorsCount().call()
}

export async function getTotalSigningKeyCount(nodeOperatorId) {
  return await nodeOperatorsContract.methods.getTotalSigningKeyCount(nodeOperatorId).call()
}

export async function calculateNewNodeOperatorBalance(holder) {
  const sharesByHolder = await getSharesByHolder(holder)
  return await getPooledEthByShares(sharesByHolder)
}

export async function getTotalActiveKeysCount() {
  let effectiveStakeTotal = ''
  for (let nodeOperatorId = 0; nodeOperatorId < (await getNodeOperatorsCount()); nodeOperatorId++) {
    const nodeOperator = await getNodeOperator(nodeOperatorId, true)
    if (!nodeOperator.active) continue

    const effectiveStake = +nodeOperator.usedSigningKeys - +nodeOperator.stoppedValidators
    effectiveStakeTotal = +effectiveStakeTotal + +effectiveStake
  }
  return effectiveStakeTotal.toString()
}
