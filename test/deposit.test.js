import test from 'ava'
import {
  getLocalWeb3,
  getApmOptions,
  getAccounts,
  daoAddress,
  owner,
  depositContract
} from "./test-helpers";

const depositContractAbi = [{"inputs":[],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"bytes","name":"pubkey","type":"bytes"},{"indexed":false,"internalType":"bytes","name":"withdrawal_credentials","type":"bytes"},{"indexed":false,"internalType":"bytes","name":"amount","type":"bytes"},{"indexed":false,"internalType":"bytes","name":"signature","type":"bytes"},{"indexed":false,"internalType":"bytes","name":"index","type":"bytes"}],"name":"DepositEvent","type":"event"},{"inputs":[{"internalType":"bytes","name":"pubkey","type":"bytes"},{"internalType":"bytes","name":"withdrawal_credentials","type":"bytes"},{"internalType":"bytes","name":"signature","type":"bytes"},{"internalType":"bytes32","name":"deposit_data_root","type":"bytes32"}],"name":"deposit","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[],"name":"get_deposit_count","outputs":[{"internalType":"bytes","name":"","type":"bytes"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"get_deposit_root","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes4","name":"interfaceId","type":"bytes4"}],"name":"supportsInterface","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"pure","type":"function"}]

import {
  ether,
  BN,           // Big Number support
  constants,    // Common constants, like the zero address and largest integers
  expectEvent,  // Assertions for emitted events
  expectRevert, // Assertions for transactions that should fail
  time
} from '@openzeppelin/test-helpers'

test.before('Connecting Web3', async (t) => {
  const web3 = await getLocalWeb3()
  // Retrieve web3 accounts.
  const accounts = await getAccounts(web3)
  const options = await getApmOptions()
  t.context = {
    web3,
    accounts,
    options
  }
})


test('DepositContract',
  async t => {
    const { web3, accounts } = t.context
    // Use the different accounts, which are unlocked and funded with Ether
    const [owner, ...holders] = accounts;

    const DepositContract = new web3.eth.Contract(depositContractAbi, depositContract);

    //mock data for validator
    const pubkey = "0x8769d4a1f8e2a58b0ffbfa73baea6b388bbed44c3a0d3d188be98ae94c7b0287c2e73233330e1a3ad740b276e9c2a983"
    const withdrawal_credentials = "0x0039ccd625b584a84322b2b5288b2062d8ce27a33351b5713e67234ae57a6745"
    const signature = "0x964c30bd77831ccf926ffc4879cdaf6a89b540a5bed5006256af35c3e0fabe77892d5f478bfc6748149e63a842f9ff4e162bcef4324fe1dd254a9f8651a30b193b0d567aee2ae446b3d32014de6afaf6278463dd942b353a346f361fc2d50eed"
    const deposit_data_root = "0x57f0444e89f6849ea26eb9720a92bd38cc3e95cb8f26eeaa1dec9477b5aed497"

    let receipt = await DepositContract.methods.deposit(pubkey, withdrawal_credentials, signature, deposit_data_root).send({
      value: ether('32'),
      from: holders[0]
    })
    // console.log(receipt)
    expectEvent(receipt, 'DepositEvent', {
      pubkey: pubkey,
      withdrawal_credentials: withdrawal_credentials,
      signature: signature,
      amount: '0x0040597307000000' // 32eth in gweis converted to little endian bytes
    });
    t.pass()
  }
)
