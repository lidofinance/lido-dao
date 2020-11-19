require('dotenv').config()
const fs = require('fs')
const path = require('path')
const ethers = require('ethers')

const RPC_ENDPOINT = process.argv[2] || 'http://localhost:8545'
const NUM_ACCOUNTS = +(process.argv[3] || '10')
const OUT_DIR = process.argv[4] || './'
const MNEMONIC = process.argv[5] || ''
const PASSWORD = process.argv[6] || '123'

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const checkAcc = async (address, provider) => {
  const accounts = await provider.listAccounts()
  return accounts.map((a) => a.toLowerCase()).includes(address.toLowerCase())
}

const tryFindAcc = async (address, provider) => {
  let found = false
  let n = 0
  while (n < 5 && !found) {
    n++
    found = await checkAcc(address, provider)
    await sleep(300)
  }
  return found
}

const main = async (numAccounts = NUM_ACCOUNTS, rpcEndpoint = RPC_ENDPOINT, outDir = OUT_DIR, mnemonic = MNEMONIC, password = PASSWORD) => {
  console.log('Generating accounts')
  const provider = new ethers.providers.JsonRpcProvider(rpcEndpoint)
  const sysSigner = await provider.getSigner(0)
  let found
  // console.log(await provider.listAccounts(0))
  // return
  const value = ethers.utils.parseEther('10000')

  for (let i = 0; i < numAccounts; i++) {
    const wallet = ethers.Wallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${i}`)
    if (!(await checkAcc(wallet.address, provider))) {
      console.log(`  creating account ${i + 1}/${numAccounts}: ${wallet.address}`)
      const json = await wallet.encrypt(password)
      const { 'x-ethers': params } = JSON.parse(json)
      fs.writeFileSync(path.resolve(outDir, 'keystore', params.gethFilename), json, { flag: 'w' })
      found = await tryFindAcc(wallet.address, provider)
    } else {
      console.log(`  account exist ${i + 1}/${numAccounts}: ${wallet.address}`)
      found = true
    }
    if (found) {
      // console.log(await provider.listAccounts())
      const signer = await provider.getSigner(wallet.address)
      const bal = await signer.getBalance()
      if (bal.lt(value)) {
        console.log(`   transferring funds`)
        const tx = await sysSigner.sendTransaction({
          to: await signer.getAddress(),
          value
        })
      }
      // await tx.wait()
      // console.log(ethers.utils.formatEther(await provider.getBalance(wallet.address)))
      console.log(`   unlocking...`)
      await signer.unlock(password)
    } else {
      console.log(`  error creating account ${i + 1}/${numAccounts}: ${wallet.address}`)
    }
  }

  // const value = ethers.utils.parseEther('1')
  // const tx = await provider.getSigner(2).sendTransaction({
  //   to: await provider.getSigner(3).getAddress(),
  //   // gas: '21000',
  //   // gasPrice: '20000000000'
  //   value: '0x100',
  // })
  // console.log(tx)
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((e) => {
    console.log(e)
    process.exit(1)
  })
