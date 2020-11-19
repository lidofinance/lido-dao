import { abi as votingAbi } from '@aragon/apps-voting/abi/Voting.json'
import { abi as tokenManagerAbi } from '@aragon/apps-token-manager/abi/TokenManager.json'
const tokenManagerAbiExt = tokenManagerAbi.concat(votingAbi.filter((i) => i.type === 'event'))

let context
export let tokenManagerContract

export function init(c) {
  if (!context) {
    context = c
    tokenManagerContract = new context.web3.eth.Contract(tokenManagerAbiExt, getProxyAddress())
  }
}

export function getProxyAddress() {
  return context.apps.tokenManagerApp.proxyAddress
}

export async function hasInitialized() {
  return await tokenManagerContract.methods.hasInitialized().call()
}
