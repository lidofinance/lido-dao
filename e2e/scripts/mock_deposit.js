require('dotenv').config()

const { prepareContext } = require('./helpers')
const logger = require('./helpers/logger')
const { loadGeneratedValidatorsData, objHexlify } = require('./helpers/utils')
const depositContractHelper = require('./helpers/apps/depositContractHelper')

const args = process.argv.slice(2)
const dir = args[0]


const main = async () => {
  if (!dir) {
    throw new Error('Validator keys dir not specified')
  }
  logger.info(`Reading deposit data from: ${dir}`)
  const context = await prepareContext()
  const { web3, accounts } = context
  depositContractHelper.init(context)
  const data = await loadGeneratedValidatorsData(dir)

  return await Promise.all(data.map((d, i) => depositContractHelper.deposit(accounts[i], web3.utils.toWei('32', 'ether'), objHexlify(d))))
}

main()
  .then((receipts) => {
    receipts.forEach((r) => {
      logger.info(`Validator ${r.events.DepositEvent.returnValues.pubkey} deposited, txHash: ${r.transactionHash}`)
    })
    process.exit(0)
  })
  .catch((e) => {
    logger.error(e)
    process.exit(1)
  })
