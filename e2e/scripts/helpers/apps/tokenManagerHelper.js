import { abi as votingAbi } from '@aragon/apps-voting/abi/Voting.json'
import { abi as tokenManagerAbi } from '@aragon/apps-token-manager/abi/TokenManager.json'
const tokenManagerAbiExt = tokenManagerAbi.concat(votingAbi.filter((i) => i.type === 'event'))

let context
let tokenManagerContract

function init(c) {
  if (!context) {
    context = c
    tokenManagerContract = new context.web3.eth.Contract(tokenManagerAbiExt, getProxyAddress())
  }
}

function getProxyAddress() {
  return context.apps.tokenManagerApp.proxyAddress
}

async function hasInitialized() {
  return await tokenManagerContract.methods.hasInitialized().call()
}
export { init, tokenManagerContract, getProxyAddress, hasInitialized }
