import { abi as stEthAbi } from '../../../apps/steth/artifacts/StETH.json'

let context
let stEthContract
let web3

function init(c) {
  if (!context) {
    context = c
    web3 = context.web3
    stEthContract = new web3.eth.Contract(stEthAbi, getProxyAddress())
  }
}
function getProxyAddress() {
  return context.apps.stEthApp.proxyAddress
}

async function getBalance(user) {
  return await stEthContract.methods.balanceOf(user).call()
}

async function getTotalSupply() {
  return await stEthContract.methods.totalSupply().call()
}

export { init, getBalance, getTotalSupply }
