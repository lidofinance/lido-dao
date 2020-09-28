import { abi as votingAbi } from '@aragon/apps-voting/abi/Voting.json'
import { abi as tokenManagerAbi } from '@aragon/apps-token-manager/abi/TokenManager.json'
const tokenManagerAbiExt = tokenManagerAbi.concat(votingAbi.filter((i) => i.type === 'event'))

let web3
let context
let tokenManagerContract

function init(c) {
  if (!context) {
    context = c
    web3 = context.web3
    tokenManagerContract = new web3.eth.Contract(tokenManagerAbiExt, getProxyAddress())
  }
}

function getProxyAddress() {
  return context.apps.tokenManagerApp.proxyAddress
}
export { init, tokenManagerContract }
