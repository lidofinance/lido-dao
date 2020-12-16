// import { abi as stEthAbi } from '../../../../artifacts/StETH.json'
//
// let context
// let stEthContract
//
// export function init(c) {
//   if (!context) {
//     context = c
//     stEthContract = new context.web3.eth.Contract(stEthAbi, getProxyAddress())
//   }
// }
// export function getProxyAddress() {
//   return context.apps.stEthApp.proxyAddress
// }
//
// export async function hasInitialized() {
//   return await stEthContract.methods.hasInitialized().call()
// }
//
// export async function getBalance(user, block_identifier = context.web3.eth.defaultBlock) {
//   return await stEthContract.methods.balanceOf(user).call(block_identifier)
// }
//
// export async function getTotalSupply() {
//   return await stEthContract.methods.totalSupply().call()
// }
//
// export async function approve(address, amount, sender) {
//   await stEthContract.methods.approve(address, amount).send({ from: sender })
// }
//
// export async function allowance(user, address) {
//   return await stEthContract.methods.allowance(user, address).call()
// }
//
// export async function calculateNewUserBalance(holder) {
//   const sharesByHolder = await getSharesByHolder(holder)
//   return await getPooledEthByShares(sharesByHolder)
// }
//
// export async function getTotalShares() {
//   return stEthContract.methods.getTotalShares().call()
// }
//
// export function getSharesByHolder(owner) {
//   return stEthContract.methods.getSharesByHolder(owner).call()
// }
//
// export function getPooledEthByShares(shares) {
//   return stEthContract.methods.getPooledEthByShares(shares).call()
// }
