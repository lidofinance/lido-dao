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
  // console.log(accounts)
  const donator = accounts[0]
  const data = await loadGeneratedValidatorsData('mock_validators')

  const receipts = await Promise.all(data.map((d, i) => deposit(donator, web3.utils.toWei('32', 'ether'), objHexlify(d))))
  receipts.forEach((r) => {
    logger.info(`Validator ${r.events.DepositEvent.returnValues.pubkey} deposited, txHash: ${r.transactionHash}`)
  })

  logger.info(`Send stub tx`)
  return await sendTransaction(web3, donator, donator, 0)
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((e) => {
    logger.error(e)
    process.exit(1)
  })
