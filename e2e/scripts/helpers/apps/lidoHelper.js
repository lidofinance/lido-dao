import { abi as LidoAbi } from '../../../../artifacts/Lido.json'
import { createVote, voteForAction, init as voteInit } from './votingHelper'
import { encodeCallScript } from '@aragon/contract-helpers-test/src/aragon-os'
import { BN } from '../utils'
import { TREASURY_FEE, INSURANCE_FEE, ZERO_ADDRESS } from '../constants'

let context
export let lidoContract
let web3

export function init(c) {
  if (!context) {
    context = c
    web3 = context.web3
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
  await depositBufferedEther(sender, maxDepositCalls)
}

export async function getEther2Stat() {
  return await lidoContract.methods.getEther2Stat().call()
}

export async function getUsedEther() {
  const totalControledEther = await getTotalControlledEther()
  const bufferedEther = await getBufferedEther()
  return BN(totalControledEther).sub(BN(bufferedEther)).toString()
}

export async function getTreasury() {
  return await lidoContract.methods.getTreasury().call()
}

export async function depositToLidoContract(from, value, referral = '0x0000000000000000000000000000000000000000', maxDepositCalls = 16) {
  await submit(from, value, referral)
  await depositBufferedEther(from, maxDepositCalls)
  // return await eth1Helper.sendTransaction(web3, getProxyAddress(), from, value)
}

export async function depositBufferedEther(from, maxDepositCalls = 16) {
  await lidoContract.methods.depositBufferedEther(maxDepositCalls).send({ from, gas: '8000000' })
}

export function getTotalControlledEther() {
  return lidoContract.methods.getTotalControlledEther().call()
}
export function getBufferedEther() {
  return lidoContract.methods.getBufferedEther().call()
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
  return lidoContract.methods.reportEther2(epoch, value).send({ from: sender, gas: '2000000' })
}
