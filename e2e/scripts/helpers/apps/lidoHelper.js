import { abi as LidoAbi } from '../../../../artifacts/Lido.json'
import { createVote, voteForAction, init as voteInit } from './votingHelper'
import { encodeCallScript } from '@aragon/contract-helpers-test/src/aragon-os'
import { BN } from '../utils'
import { init as stEthHelperInit, getPooledEthByShares, getSharesByHolder } from './stEthHelper'

let context
export let lidoContract
let web3

export function init(c) {
  if (!context) {
    context = c
    web3 = context.web3
    stEthHelperInit(context)
    lidoContract = new web3.eth.Contract(LidoAbi, getProxyAddress())
    voteInit(context)
  }
}

export function getProxyAddress() {
  return context.apps.lidoApp.proxyAddress
}

export async function hasInitialized() {
  return await lidoContract.methods.hasInitialized().call()
}

export async function setWithdrawalCredentials(withdrawalCredentials, holder, holders) {
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: lidoContract.methods.setWithdrawalCredentials(withdrawalCredentials).encodeABI()
    }
  ])
  const voteId = await createVote(callData1, holder, 'Set withdrawal credentials')
  return await voteForAction(voteId, holders, 'Set withdrawal credentials')
}

export async function setFee(fee, holder, holders) {
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: lidoContract.methods.setFee(fee).encodeABI()
    }
  ])
  const voteId = await createVote(callData1, holder, 'setFee')
  await voteForAction(voteId, holders, 'setFee')
}

export async function setFeeDistribution(treasuryFee, insuranceFee, NOSFee, holder, holders) {
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: lidoContract.methods.setFeeDistribution(treasuryFee, insuranceFee, NOSFee).encodeABI()
    }
  ])
  const voteId = await createVote(callData1, holder, 'setFeeDistribution')
  await voteForAction(voteId, holders, 'setFeeDistribution')
}

export async function addSigningKeys(validatorsTestData, holder, count, holders) {
  const validatorsPubKeys = validatorsTestData.pubKey
  const validatorsSignatures = validatorsTestData.signature
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: await lidoContract.methods.addSigningKeys(count, validatorsPubKeys, validatorsSignatures).encodeABI()
    }
  ])

  const voteId = await createVote(callData1, holder, 'Add signing keys')
  await voteForAction(voteId, holders, 'Add signing keys')
}

export function getWithdrawalCredentials() {
  return lidoContract.methods.getWithdrawalCredentials().call()
}
export function getFee() {
  return lidoContract.methods.getFee().call()
}

export function getFeeDistribution() {
  return lidoContract.methods.getFeeDistribution().call()
}

export async function getTreasuryAddress() {
  return await lidoContract.methods.getTreasury().call()
}

export async function getInsuranceFundAddress() {
  return await lidoContract.methods.getInsuranceFund().call()
}

export async function submit(sender, value, referral, maxDepositCalls = 16) {
  await lidoContract.methods.submit(referral).send({ from: sender, value: value, gas: '8000000' })
}

export async function getBeaconStat() {
  return await lidoContract.methods.getBeaconStat().call()
}

export async function getUsedEther() {
  const totalControledEther = await getTotalPooledEther()
  const bufferedEther = await getBufferedEther()
  return BN(totalControlledEther).sub(BN(bufferedEther)).toString()
}

export async function depositToLidoContract(from, value, referral = '0x0000000000000000000000000000000000000000', maxDepositCalls = 16) {
  await submit(from, value, referral)
  return await depositBufferedEther(from, maxDepositCalls)
  // return await eth1Helper.sendTransaction(web3, getProxyAddress(), from, value)
}

export async function depositBufferedEther(from, maxDepositCalls = 16) {
  return await lidoContract.methods.depositBufferedEther(maxDepositCalls).send({ from, gas: '8000000' })
}

export function getTotalPooledEther() {
  return lidoContract.methods.getTotalPooledEther().call()
}

export function getBufferedEther() {
  return lidoContract.methods.getBufferedEther().call()
}

export async function calculateNewInsuranceBalance(holder) {
  const sharesByHolder = await getSharesByHolder(holder)
  return await getPooledEthByShares(sharesByHolder)
}
