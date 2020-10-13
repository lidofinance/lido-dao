require('dotenv').config()

const { prepareContext, loadDepositData } = require('./helpers')
const { depositContract } = require('./helpers/constants')

const args = process.argv.slice(2)
const dir = args[0]

const depositContractAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: 'bytes', name: 'pubkey', type: 'bytes' },
      {
        indexed: false,
        internalType: 'bytes',
        name: 'withdrawal_credentials',
        type: 'bytes'
      },
      { indexed: false, internalType: 'bytes', name: 'amount', type: 'bytes' },
      {
        indexed: false,
        internalType: 'bytes',
        name: 'signature',
        type: 'bytes'
      },
      { indexed: false, internalType: 'bytes', name: 'index', type: 'bytes' }
    ],
    name: 'DepositEvent',
    type: 'event'
  },
  {
    inputs: [
      { internalType: 'bytes', name: 'pubkey', type: 'bytes' },
      { internalType: 'bytes', name: 'withdrawal_credentials', type: 'bytes' },
      { internalType: 'bytes', name: 'signature', type: 'bytes' },
      { internalType: 'bytes32', name: 'deposit_data_root', type: 'bytes32' }
    ],
    name: 'deposit',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  }
]

const main = async () => {
  console.log('Reading deposit data from: ', dir)
  const { web3, accounts } = await prepareContext()
  const depositData = await loadDepositData(dir)
  const DepositContract = new web3.eth.Contract(depositContractAbi, depositContract)

  // const nonce = await web3.eth.getTransactionCount(accounts[0])
  return await Promise.all(
    depositData.map(({ pubkey, withdrawal_credentials, signature, deposit_data_root }, i) =>
      DepositContract.methods.deposit(`0x${pubkey}`, `0x${withdrawal_credentials}`, `0x${signature}`, `0x${deposit_data_root}`).send({
        value: web3.utils.toWei('32', 'ether'),
        from: accounts[i],
        // nonce: nonce + i
      })
    )
  )
}

main()
  .then((receipts) => {
    receipts.forEach((r) => {
      console.log(`Validator ${r.events.DepositEvent.returnValues.pubkey} deposited, txHash: ${r.transactionHash}`)
    })
    process.exit(0)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
