import { abi, bytecode } from '../../../../artifacts/DepositContract.json'
import { bETHAddress as address } from '../constants'

let context
let contract

export function init(c) {
  if (!context) {
    context = c
    contract = new context.web3.eth.Contract(abi, address)
  }
}

export function deploy(from) {
  return new Promise((resolve, reject) => {
    contract
      .deploy({
        data: bytecode
      })
      .send({
        from,
        gas: '0x20acc4',
        gasPrice: '0x4a817c800'
      })
      .on('error', reject)
      .on('receipt', resolve)
      .then((instance) => {
        contract = instance
      })
  })
}
