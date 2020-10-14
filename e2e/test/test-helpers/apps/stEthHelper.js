import { abi as stEthAbi } from '../../../artifacts/StETH.json'

let context
let stEthContract

function init(c) {
  if (!context) {
    context = c
    stEthContract = new context.web3.eth.Contract(stEthAbi, getProxyAddress())
  }
}
function getProxyAddress() {
  return context.apps.stEthApp.proxyAddress
}

async function hasInitialized() {
  return await stEthContract.methods.hasInitialized().call()
}

async function getBalance(user) {
  return await stEthContract.methods.balanceOf(user).call()
}

async function getTotalSupply() {
  return await stEthContract.methods.totalSupply().call()
}

export { init, getBalance, getTotalSupply, hasInitialized }
