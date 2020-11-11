const Web3 = require('web3')

const RPC_ENDPOINT = process.argv[2] || 'http://localhost:8545'
const ACCOUNTS = process.argv[3].split(',')

fundAccounts(ACCOUNTS, RPC_ENDPOINT)
  .then(() => {
    process.exit(0)
  })
  .catch((e) => {
    console.error(e.stack)
    process.exit(1)
  })

async function fundAccounts(accounts, rpcEndpoint) {
  const provider = new Web3.providers.HttpProvider(rpcEndpoint)
  const web3 = new Web3(provider)
  const [firstAccount] = await web3.eth.getAccounts()

  for (let i = 0; i < accounts.length; ++i) {
    const account = accounts[i]
    console.log(`  funding account ${account} (${i + 1}/${accounts.length})`)
    await web3.eth.sendTransaction({
      from: firstAccount,
      to: account,
      value: web3.utils.toWei(`${10000}`, 'ether')
    })
  }

  console.log(`  done!`)
}
