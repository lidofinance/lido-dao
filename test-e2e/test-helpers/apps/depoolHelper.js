import { abi as DePoolAbi } from '../../../artifacts/DePool.json'
import { createVote, voteForAction, init as voteInit } from './votingHelper'
import { encodeCallScript } from '@aragon/contract-helpers-test/src/aragon-os'
import * as eth1Helper from '../eth1Helper'

let context
let dePoolContract
let web3
let logger

function init(c) {
  if (!context) {
    context = c
    web3 = context.web3
    dePoolContract = new web3.eth.Contract(DePoolAbi, getProxyAddress())
    voteInit(context)
    logger = context.logger
  }
}
function getProxyAddress() {
  return context.apps.dePoolApp.proxyAddress
}

async function hasInitialized() {
  return await dePoolContract.methods.hasInitialized().call()
}

async function setWithdrawalCredentials(withdrawalCredentials, holder, holders) {
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: dePoolContract.methods.setWithdrawalCredentials(withdrawalCredentials).encodeABI()
    }
  ])
  const voteId = await createVote(callData1, holder, 'Set withdrawal credentials')
  await voteForAction(voteId, holders, 'Set withdrawal credentials')
}

async function addSigningKeys(validatorsTestData, holder, count, holders) {
  const validatorsPubKeys = validatorsTestData.pubKey
  const validatorsSignatures = validatorsTestData.signature
  logger.debug('PubKeys to add ' + validatorsPubKeys)
  logger.debug('Signatures to add' + validatorsSignatures)
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: await dePoolContract.methods.addSigningKeys(count, validatorsPubKeys, validatorsSignatures).encodeABI()
    }
  ])

  const voteId = await createVote(callData1, holder, 'Add signing keys')
  await voteForAction(voteId, holders, 'Add signing keys')
}

function getWithdrawalCredentials() {
  return dePoolContract.methods.getWithdrawalCredentials().call()
}

async function getTreasury() {
  return await dePoolContract.methods.getTreasury().call()
}

async function depositToDePoolContract(from, value) {
  return await eth1Helper.sendTransaction(web3, getProxyAddress(), from, value)
}

function getTotalControlledEther() {
  return dePoolContract.methods.getTotalControlledEther().call()
}
function getBufferedEther() {
  return dePoolContract.methods.getBufferedEther().call()
}

function reportEther(sender, epoch, value) {
  return dePoolContract.methods.reportEther2(epoch, value).send({ from: sender, gas: '2000000' })
}

export {
  init,
  getWithdrawalCredentials,
  setWithdrawalCredentials,
  addSigningKeys,
  depositToDePoolContract,
  getBufferedEther,
  getTotalControlledEther,
  getProxyAddress,
  getTreasury,
  hasInitialized,
  reportEther
}
