const Web3 = require('web3')

const NUM_ACCOUNTS = +(process.argv[2] || '10')
const RPC_ENDPOINT = process.argv[3] || 'http://localhost:8545'

createAccounts(NUM_ACCOUNTS, RPC_ENDPOINT)
  .then(() => {
    process.exit(0)
  })
  .catch((e) => {
    console.error(e.stack)
    process.exit(1)
  })

async function createAccounts(numAccounts, rpcEndpoint) {
  const provider = new Web3.providers.HttpProvider(rpcEndpoint)
  const web3 = new Web3(provider)
  const [firstAccount] = await web3.eth.getAccounts()

  for (let i = 0; i < numAccounts; ++i) {
    console.log(`  creating account ${i + 1}/${numAccounts}`)
    const passwd = `${i}`
    const newAccount = await web3.eth.personal.newAccount(passwd)
    console.log(`    unlocking`)
    await web3.eth.personal.unlockAccount(newAccount, passwd, 0)
    console.log(`    transferring funds`)
    await web3.eth.sendTransaction({
      from: firstAccount,
      to: newAccount,
      value: web3.utils.toWei(`${10000}`, 'ether')
    })
  }
  console.log(`  done!`)
}
