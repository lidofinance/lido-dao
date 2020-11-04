import { prepareContext } from './helpers'
import logger from './helpers/logger'
import { loadGeneratedValidatorsData, objHexlify } from './helpers/utils'
import { sendTransaction } from './helpers/eth1Helper'
import { init, deposit } from './helpers/apps/depositContractHelper'

const main = async () => {
  logger.info(`Reading mock validators deposit data`)
  const context = await prepareContext()
  const { web3, accounts } = context
  init(context)
  const donators = accounts.slice(5)
  const data = await loadGeneratedValidatorsData('mock_validators')

  const receipts = await Promise.all(data.map((d, i) => deposit(donators[i], web3.utils.toWei('32', 'ether'), objHexlify(d))))
  receipts.forEach((r) => {
    logger.info(`Validator ${r.events.DepositEvent.returnValues.pubkey} deposited, txHash: ${r.transactionHash}`)
  })

  logger.info(`Send stub tx`)
  return await sendTransaction(web3, donators[0], donators[0], 0)
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((e) => {
    logger.error(e)
    process.exit(1)
  })
