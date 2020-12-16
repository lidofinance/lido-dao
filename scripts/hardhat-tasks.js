task(`tx`, `Performs a transaction`)
  .addParam(`file`, `The transaction JSON file`)
  .addOptionalParam(`from`, `The transaction sender address`)
  .addOptionalParam(`wait`, `The number of seconds to wait before sending the transaction`)
  .setAction(async ({ file, from: fromArg, wait: waitSec = 5 }) => {
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
      if (waitSec !== 0) {
        console.error(`Press Ctrl+C within ${waitSec} seconds to cancel sending the transaction...`)
        await new Promise((r) => setTimeout(r, 1000 * waitSec))
      }
    } catch (err) {
      console.error(`ERROR Gas estimation failed: ${err.message}`)
      process.exit(1)
    }

    console.error(`Sending the transaction...`)
    // console.error(data)

    const receiptPromise = await web3.eth.sendTransaction(data, (err, hash) => {
      console.error('====================')
      if (err) {
        console.error(`Failed to send transaction: ${(err && err.message) || err}`)
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

task('ens-assign', `Assigns/transfers ENS node owner`)
  .addParam(`domain`, `The ENS domain name, e.g. my.domain.eth`)
  .addParam(`to`, `The new owner address`)
  .addParam(`from`, `The address that currently owns the domain or the parent domain`)
  .addOptionalParam(`ens`, `ENS address`)
  .setAction(async (params) => {
    const ensAddress = params.ens || network.config.ensAddress
    const chalk = require('chalk')
    console.log(`Using ENS: ${chalk.yellow(ensAddress)}`)
    const ens = await artifacts.require('ENS').at(ensAddress)
    const dotIndex = params.domain.indexOf('.')
    const { node, txResult } = await require('./components/ens').assignENSName({
      labelName: params.domain.substring(0, dotIndex),
      parentName: params.domain.substring(dotIndex + 1),
      owner: params.from,
      assigneeAddress: params.to,
      ens
    })
    console.error(`Transaction has been included in a block, tx hash: ${chalk.yellow(txResult.tx)}`)
    const owner = await ens.owner(node)
    if (owner.toLowerCase() !== params.to.toLowerCase()) {
      throw new Error(`the owner '${owner}' is different from the expected '${params.to}'`)
    }
    console.error(chalk.green('✓'), `the ownsership was successfully updated`)
  })

task('list-accts', `List accounts and their balances`)
  .addOptionalParam(`max`, `Limit the number of listed accounts to the specified value`)
  .setAction(async ({ max = undefined }) => {
    const accts = (await web3.eth.getAccounts()).slice(0, max)
    const balances = await Promise.all(accts.map(acct => web3.eth.getBalance(acct)))
    const padLen = accts.length > 100 ? 3 : 2
    const yl = require('chalk').yellow
    accts.forEach((acct, i) => {
      const balance = web3.utils.fromWei(balances[i], 'ether')
      console.error(`${String(i).padStart(padLen, ' ')}, ${yl(acct)}: ${balance}`)
    })
  })
