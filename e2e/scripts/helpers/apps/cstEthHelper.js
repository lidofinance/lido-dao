import { abi as CstEthAbi } from '../../../../artifacts/CstETH.json'
import { cstETHAddress } from '../constants'

let web3
let context
export let cstEthContract

export function init(c) {
  if (!context) {
    context = c
    web3 = context.web3
    cstEthContract = new web3.eth.Contract(CstEthAbi, getProxyAddress())
  }
}

export function getProxyAddress() {
  return cstETHAddress
}

export async function wrap(amount, sender) {
  return await cstEthContract.methods.wrap(amount).send({ from: sender })
}

export async function unwrap(amount, sender) {
  return await cstEthContract.methods.unwrap(amount).send({ from: sender })
}

export async function getBalance(user) {
  return await cstEthContract.methods.balanceOf(user).call()
}

export async function allowance(user, address) {
  return await cstEthContract.methods.allowance(user, address).call()
}
