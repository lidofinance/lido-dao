import { abi as stEthAbi } from '../../../../artifacts/StETH.json'

let context
let stEthContract

export function init(c) {
  if (!context) {
    context = c
    stEthContract = new context.web3.eth.Contract(stEthAbi, getProxyAddress())
  }
}
export function getProxyAddress() {
  return context.apps.stEthApp.proxyAddress
}

export async function hasInitialized() {
  return await stEthContract.methods.hasInitialized().call()
}

export async function getBalance(user) {
  return await stEthContract.methods.balanceOf(user).call()
}

export async function getTotalSupply() {
  return await stEthContract.methods.totalSupply().call()
}
