import { abi as vaultAbi } from '@aragon/apps-finance/abi/Vault.json'
import { stakingProviderContract } from './stakingProviderHelper'

let web3
let context
let vaultContract

function init(c) {
  if (!context) {
    context = c
    web3 = context.web3
    vaultContract = new web3.eth.Contract(vaultAbi, getProxyAddress())
  }
}

function getProxyAddress() {
  return context.apps.vaultApp.proxyAddress
}

async function hasInitialized() {
  return await vaultContract.methods.hasInitialized().call()
}

async function getBalance() {
  return await vaultContract.methods.balance()
}
export { init, getBalance, hasInitialized }
