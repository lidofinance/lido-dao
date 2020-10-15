import { abi as spsAbi } from '../../../../artifacts/StakingProvidersRegistry.json'
import { encodeCallScript } from '@aragon/contract-helpers-test/src/aragon-os'
import { createVote, voteForAction } from './votingHelper'
import { concatKeys } from '../utils'

let web3
let context
let stakingProviderContract
let logger

function init(c) {
  if (!context) {
    context = c
    web3 = context.web3
    stakingProviderContract = new web3.eth.Contract(spsAbi, getProxyAddress())
    logger = context.logger
  }
}

function getProxyAddress() {
  return context.apps.stakingProvidersApp.proxyAddress
}

async function hasInitialized() {
  return await stakingProviderContract.methods.hasInitialized().call()
}

async function addStakingProvider(name, member, stakingLimit, holder, holders) {
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: await stakingProviderContract.methods.addStakingProvider(name, member, stakingLimit).encodeABI()
    }
  ])

  const voteId = await createVote(callData1, holder, 'Add staking provider - ' + name)
  await voteForAction(voteId, holders, 'Add staking provider - ' + name)
}

async function addSigningKeys(spId, validatorsTestData, holder, holders) {
  const validatorsPubKeys = concatKeys(validatorsTestData.pubKeys)
  const validatorsSignatures = concatKeys(validatorsTestData.signatures)
  logger.debug('PubKeys to add ' + validatorsPubKeys)
  logger.debug('Signatures to add' + validatorsSignatures)
  // TODO can be replaced without vote
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: await stakingProviderContract.methods
        .addSigningKeys(spId, validatorsTestData.pubKeys.length, validatorsPubKeys, validatorsSignatures)
        .encodeABI()
    }
  ])

  const voteId = await createVote(callData1, holder, 'Add signing keys')
  await voteForAction(voteId, holders, 'Add signing keys')
}

async function addSigningKeysSP(spId, validatorsTestData, spMember) {
  const validatorsPubKeys = concatKeys(validatorsTestData.pubKeys)
  const validatorsSignatures = concatKeys(validatorsTestData.signatures)
  logger.debug('PubKeys to add ' + validatorsPubKeys)
  logger.debug('Signatures to add' + validatorsSignatures)
  await stakingProviderContract.methods
    .addSigningKeysSP(spId, validatorsTestData.pubKeys.length, validatorsPubKeys, validatorsSignatures)
    .send({ from: spMember, gas: '10000000' })
}

async function getUnusedSigningKeyCount(spId) {
  return await stakingProviderContract.methods.getUnusedSigningKeyCount(spId).call()
}

async function getStakingProvider(spId, fullInfo) {
  return await stakingProviderContract.methods.getStakingProvider(spId, fullInfo).call()
}
async function getSigningKey(spId, signingKeyId) {
  return await stakingProviderContract.methods.getSigningKey(spId, signingKeyId).call()
}

async function getAllSigningKeys(sp, spId) {
  const signingKeysCount = sp.totalSigningKeys
  const pubKeys = []
  const signatures = []
  for (let i = 0; i < signingKeysCount; i++) {
    const signingKeyInfo = await getSigningKey(spId, i)
    pubKeys.push(signingKeyInfo.key)
    signatures.push(signingKeyInfo.depositSignature)
  }
  return {
    pubKeys,
    signatures
  }
}

async function getActiveSigningKeys(sp, spSigningKeys) {
  const usedSigningKeysCount = sp.usedSigningKeys
  const activeSigningKeys = []
  for (let i = 0; i < usedSigningKeysCount; i++) {
    activeSigningKeys.push(spSigningKeys.pubKeys[i])
  }
  return activeSigningKeys
}

export {
  init,
  stakingProviderContract,
  getProxyAddress,
  hasInitialized,
  addSigningKeys,
  addStakingProvider,
  getStakingProvider,
  getSigningKey,
  getAllSigningKeys,
  addSigningKeysSP,
  getActiveSigningKeys,
  getUnusedSigningKeyCount
}
