import { depositContractAbi } from './abi'
import { depositContract as depositContractAddress } from '../../constants'

let context
let depositContract

function init(c) {
  if (!context) {
    context = c
    depositContract = new context.web3.eth.Contract(depositContractAbi, depositContractAddress)
  }
}

async function deposit(sender, value, depositData) {
  return await depositContract.methods
    .deposit(depositData.pubkey, depositData.withdrawal_credentials, depositData.signature, depositData.deposit_data_root)
    .send({
      value: value,
      from: sender
    })
}
export { init, deposit }
