import { abi as LidoAbi } from '../../../../artifacts/Lido.json'
import { createVote, voteForAction, init as voteInit } from './votingHelper'
import { encodeCallScript } from '@aragon/contract-helpers-test/src/aragon-os'
import * as eth1Helper from '../eth1Helper'
import { BN } from '../utils'
import { TREASURY_FEE, INSURANCE_FEE, ZERO_ADDRESS } from '../constants'
import logger from '../logger'

let context
export let dePoolContract
let web3

export function init(c) {
  if (!context) {
    context = c
    web3 = context.web3
    dePoolContract = new web3.eth.Contract(LidoAbi, getProxyAddress())
    voteInit(context)
  }
}

export function getProxyAddress() {
  return context.apps.dePoolApp.proxyAddress
}

export async function hasInitialized() {
  return await dePoolContract.methods.hasInitialized().call()
}

export async function setWithdrawalCredentials(withdrawalCredentials, holder, holders) {
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: dePoolContract.methods.setWithdrawalCredentials(withdrawalCredentials).encodeABI()
    }
  ])
  const voteId = await createVote(callData1, holder, 'Set withdrawal credentials')
  return await voteForAction(voteId, holders, 'Set withdrawal credentials')
}

export async function setFee(fee, holder, holders) {
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: dePoolContract.methods.setFee(fee).encodeABI()
    }
  ])
  const voteId = await createVote(callData1, holder, 'setFee')
  await voteForAction(voteId, holders, 'setFee')
}

export async function setFeeDistribution(treasuryFee, insuranceFee, SPFee, holder, holders) {
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: dePoolContract.methods.setFeeDistribution(treasuryFee, insuranceFee, SPFee).encodeABI()
    }
  ])
  const voteId = await createVote(callData1, holder, 'setFeeDistribution')
  await voteForAction(voteId, holders, 'setFeeDistribution')
}

export function getDepositIterationLimit() {
  return dePoolContract.methods.getDepositIterationLimit().call()
}

export async function addSigningKeys(validatorsTestData, holder, count, holders) {
  const validatorsPubKeys = validatorsTestData.pubKey
  const validatorsSignatures = validatorsTestData.signature
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: await dePoolContract.methods.addSigningKeys(count, validatorsPubKeys, validatorsSignatures).encodeABI()
    }
  ])

  const voteId = await createVote(callData1, holder, 'Add signing keys')
  await voteForAction(voteId, holders, 'Add signing keys')
}

export function getWithdrawalCredentials() {
  return dePoolContract.methods.getWithdrawalCredentials().call()
}
export function getFee() {
  return dePoolContract.methods.getFee().call()
}

export function getFeeDistribution() {
  return dePoolContract.methods.getFeeDistribution().call()
}

export async function getTreasuryAddress() {
  return await dePoolContract.methods.getTreasury().call()
}

export async function getInsuranceFundAddress() {
  return await dePoolContract.methods.getInsuranceFund().call()
}

export async function submit(sender, value) {
  return await dePoolContract.methods.submit(ZERO_ADDRESS).send({ from: sender, value: value, gas: '1000000' })
}

export async function getEther2Stat() {
  return await dePoolContract.methods.getEther2Stat().call()
}

export async function getUsedEther() {
  const totalControledEther = await getTotalControlledEther()
  const bufferedEther = await getBufferedEther()
  return BN(totalControledEther).sub(BN(bufferedEther)).toString()
}

export async function getTreasury() {
  return await dePoolContract.methods.getTreasury().call()
}

export async function depositToLidoContract(from, value, referral = '0x0000000000000000000000000000000000000000') {
  return await dePoolContract.methods.submit(referral).send({ from, value, gas: '8000000' })
  // return await eth1Helper.sendTransaction(web3, getProxyAddress(), from, value)
}

export function getTotalControlledEther() {
  return dePoolContract.methods.getTotalControlledEther().call()
}
export function getBufferedEther() {
  return dePoolContract.methods.getBufferedEther().call()
}

export function calculateNewTreasuryBalance(stakeProfit, balanceBeforePushData) {
  const reward = calculateTreasuryReward(stakeProfit)
  return BN(balanceBeforePushData).add(reward).toString()
}

export function calculateTreasuryReward(stakeProfit) {
  // TODO change treasury/insurance
  return BN(stakeProfit)
    .mul(BN((TREASURY_FEE / 100) * 2))
    .div(BN(100))
}

export function reportEther(sender, epoch, value) {
  return dePoolContract.methods.reportEther2(epoch, value).send({ from: sender, gas: '2000000' })
}
