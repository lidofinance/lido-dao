import { abi as vaultAbi } from '@aragon/apps-finance/abi/Vault.json'

let web3
let context
export let vaultContract

export function init(c) {
  if (!context) {
    context = c
    web3 = context.web3
    vaultContract = new web3.eth.Contract(vaultAbi, getProxyAddress())
  }
}

export function getProxyAddress() {
  return context.apps.vaultApp.proxyAddress
}

export async function hasInitialized() {
  return await vaultContract.methods.hasInitialized().call()
}

export async function getBalance() {
  return await vaultContract.methods.balance()
}
