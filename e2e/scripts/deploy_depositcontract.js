import { prepareContext } from './helpers'
import logger from './helpers/logger'
import { init, deploy } from './helpers/apps/depositContractHelper'

const main = async () => {
  logger.info(`Deploying DepositContract`)
  const context = await prepareContext()
  const { accounts } = context
  init(context)
  const receipt = await deploy(accounts[0])
  console.log(receipt.contractAddress, receipt.blockNumber)
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((e) => {
    logger.error(e)
    process.exit(1)
  })
