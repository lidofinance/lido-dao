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
  const accounts = await web3.eth.getAccounts()

  for (let i = 1; i < numAccounts; ++i) {
    console.log(`  account ${i + 1}/${numAccounts}`)
    const needsCreating = i >= accounts.length
    let account
    const passwd = `${i - 1}`
    if (needsCreating) {
      console.log(`    creating`)
      account = await web3.eth.personal.newAccount(passwd)
    } else {
      account = accounts[i]
    }
    console.log(`    unlocking ${account}`)
    await web3.eth.personal.unlockAccount(account, passwd, 0)
    if (needsCreating) {
      console.log(`    transferring funds`)
      await web3.eth.sendTransaction({
        from: accounts[0],
        to: account,
        value: web3.utils.toWei(`${10000}`, 'ether')
      })
    }
    const balance = await web3.eth.getBalance(account)
    console.log(`    balance: ${web3.utils.fromWei(balance, 'ether')} ETH`)
  }
  console.log(`  done!`)
}
