import { prepareContext } from './helpers'
import logger from './helpers/logger'
import { sendTransaction } from './helpers/eth1Helper'
import { ETH } from './helpers/utils'

const main = async () => {
  logger.info(`Sending ETH to mock users`)
  const context = await prepareContext()
  const { web3, accounts } = context
  const value = ETH(1000)
  const start = 2
  const senders = 9
  const recipientsPerSender = 5
  for (let i = start; i <= senders; i++) {
    for (let j = 0; j < recipientsPerSender; j++) {
      const n = j + (i - start) * recipientsPerSender + senders + 1
      logger.debug(`1000ETH from ${accounts[i]} (${i}) to ${accounts[n]} (${n})}`)
      const r = await sendTransaction(web3, accounts[i], accounts[n], value, '21000')
      logger.debug(`txHash: ${r.transactionHash}`)
    }
  }
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((e) => {
    logger.error(e)
    process.exit(1)
  })
