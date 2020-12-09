task(`tx`, `Performs a transaction`)
  .addParam(`file`, `The transaction JSON file`)
  .addOptionalParam(`from`, `The transaction sender address`)
  .setAction(async ({ file, from: fromArg }) => {
    const netId = await web3.eth.net.getId()

    console.error('====================')
    console.error(`Network ID: ${netId}`)
    console.error('====================')

    const data = JSON.parse(require('fs').readFileSync(file))

    if (fromArg) {
      console.error(`Using the sender address provided via the commandline argument: ${fromArg}`)
      data.from = fromArg
    }

    if (!data.from) {
      const [firstAccount] = await web3.eth.getAccounts()
      if (!firstAccount) {
        throw new Error('no accounts provided')
      }
      console.error(`No sender address given, using the first provided account: ${firstAccount}`)
      data.from = firstAccount
    }

    try {
      const gas = await web3.eth.estimateGas(data)
      console.error(`The projected gas usage is ${gas}`)
      console.error(`Press Ctrl+C within 5 seconds to cancel sending the transaction...`)
      await new Promise(r => setTimeout(r, 5000))
    } catch (err) {
      console.error(`ERROR Gas estimation failed: ${err.message}`)
      process.exit(1)
    }

    console.error(`Sending the transaction...`)
    // console.error(data)

    const receiptPromise = await web3.eth.sendTransaction(data, (err, hash) => {
      console.error('====================')
      if (err) {
        console.error(`Failed to send transaction: ${err && err.message || err}`)
      } else {
        console.error(`Transaction sent: ${hash}`)
        console.error(`Waiting for inclusion...`)
      }
    })

    const receipt = await receiptPromise
    console.error('====================')
    console.error(`Transaction included in a block, receipt: ${JSON.stringify(receipt, null, '  ')}`)

    if (!receipt.status) {
      console.error('====================')
      console.error(`An error occured:`, receipt.error)
    }

    if (receipt.contractAddress) {
      console.error('====================')
      console.error(`The contract deployed to:`, receipt.contractAddress)
    }
  })
