import { abi as DePoolAbi } from '../../../../artifacts/DePool.json'
import { createVote, voteForAction, init as voteInit } from './votingHelper'
import { encodeCallScript } from '@aragon/contract-helpers-test/src/aragon-os'
import * as eth1Helper from '../eth1Helper'
import { BN } from '../utils'
import { TREASURY_FEE, INSURANCE_FEE, ZERO_ADDRESS } from '../constants'

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

async function setFee(fee, holder, holders) {
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: dePoolContract.methods.setFee(fee).encodeABI()
    }
  ])
  const voteId = await createVote(callData1, holder, 'setFee')
  await voteForAction(voteId, holders, 'setFee')
}

async function setFeeDistribution(treasuryFee, insuranceFee, SPFee, holder, holders) {
  const callData1 = encodeCallScript([
    {
      to: getProxyAddress(),
      calldata: dePoolContract.methods.setFeeDistribution(treasuryFee, insuranceFee, SPFee).encodeABI()
    }
  ])
  const voteId = await createVote(callData1, holder, 'setFeeDistribution')
  await voteForAction(voteId, holders, 'setFeeDistribution')
}

function getDepositIterationLimit() {
  return dePoolContract.methods.getDepositIterationLimit().call()
}

function getWithdrawalCredentials() {
  return dePoolContract.methods.getWithdrawalCredentials().call()
}

function getFee() {
  return dePoolContract.methods.getFee().call()
}

function getFeeDistribution() {
  return dePoolContract.methods.getFeeDistribution().call()
}

async function getTreasuryAddress() {
  return await dePoolContract.methods.getTreasury().call()
}

async function getInsuranceFundAddress() {
  return await dePoolContract.methods.getInsuranceFund().call()
}

async function submit(sender, value) {
  return await dePoolContract.methods.submit(ZERO_ADDRESS).send({ from: sender, value: value, gas: '1000000' })
}

async function getBeaconStat() {
  return await dePoolContract.methods.getBeaconStat().call()
}

async function getUsedEther() {
  const totalControledEther = await getTotalPooledEther()
  const bufferedEther = await getBufferedEther()
  return BN(totalControledEther).sub(BN(bufferedEther)).toString()
}

async function depositToDePoolContract(from, value) {
  return await eth1Helper.sendTransaction(web3, getProxyAddress(), from, value)
}

function getTotalPooledEther() {
  return dePoolContract.methods.getTotalPooledEther().call()
}
function getBufferedEther() {
  return dePoolContract.methods.getBufferedEther().call()
}

function calculateNewTreasuryBalance(stakeProfit, balanceBeforePushData) {
  const reward = calculateTreasuryReward(stakeProfit)
  return BN(balanceBeforePushData).add(reward).toString()
}

function calculateTreasuryReward(stakeProfit) {
  // TODO change treasury/insurance
  return BN(stakeProfit)
    .mul(BN((TREASURY_FEE / 100) * 2))
    .div(BN(100))
}
export {
  init,
  getWithdrawalCredentials,
  setWithdrawalCredentials,
  depositToDePoolContract,
  getBufferedEther,
  getTotalPooledEther,
  getProxyAddress,
  getTreasuryAddress,
  hasInitialized,
  setFee,
  setFeeDistribution,
  getFee,
  getFeeDistribution,
  getInsuranceFundAddress,
  getUsedEther,
  calculateNewTreasuryBalance,
  getDepositIterationLimit,
  submit,
  getBeaconStat
}
