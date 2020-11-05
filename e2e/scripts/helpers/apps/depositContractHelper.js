import { abi, bytecode } from '../../../../artifacts/DepositContract.json'
import { depositContract as address } from '../constants'

let context
let contract

export function init(c) {
  if (!context) {
    context = c
    contract = new context.web3.eth.Contract(abi, address)
  }
}

export async function deposit(sender, value, depositData) {
  return await contract.methods
    .deposit(depositData.pubkey, depositData.withdrawal_credentials, depositData.signature, depositData.deposit_data_root)
    .send({
      value: value,
      from: sender
    })
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
