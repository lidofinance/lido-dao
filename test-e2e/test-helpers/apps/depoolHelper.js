import { abi as DePoolAbi } from '../../../apps/depool/artifacts/DePool.json'
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

function getTotalSigningKeys() {
  return dePoolContract.methods.getTotalSigningKeyCount().call()
}
function getUnusedSigningKeyCount() {
  return dePoolContract.methods.getUnusedSigningKeyCount().call()
}

async function putEthToDePoolContract(from, value) {
  await eth1Helper.sendTransaction(web3, getProxyAddress(), from, value)
}

function getTotalControlledEther() {
  return dePoolContract.methods.getTotalControlledEther().call()
}
function getBufferedEther() {
  return dePoolContract.methods.getBufferedEther().call()
}
async function getSigningKey(index) {
  return await dePoolContract.methods.getSigningKey(index).call()
}

// async function initDepoolObject() {
//   const myObj = {}
//   dePoolContract.methods.forEach((m) => {
//     myObj[m.name] = (...args) => {
//       return dePoolContract.methods[m.name].call(...args)
//     }
//   })
//   return myObj
// }

export {
  init,
  getWithdrawalCredentials,
  setWithdrawalCredentials,
  addSigningKeys,
  getTotalSigningKeys,
  getUnusedSigningKeyCount,
  putEthToDePoolContract,
  getBufferedEther,
  getTotalControlledEther,
  getSigningKey
}
