import logger from './helpers/logger'
import { prepareContext } from './helpers'
import * as lidoOracleHelper from './helpers/apps/lidoOracleHelper'
import * as eth2Helper from './helpers/eth2/Eth2Helper'

const main = async () => {
  const context = await prepareContext()
  const { accounts } = context
  const voters = accounts.slice(0, 2)
  const proposer = accounts[0]

  lidoOracleHelper.init(context)

  logger.info(`Check beacon spec`)
  const _bsContract = await lidoOracleHelper.getBeaconSpec()
  const _bsNet = await eth2Helper.getBeaconSpec()
  // assume compare only genesis time is enough
  if (parseInt(parseInt(_bsContract.genesisTime)) !== parseInt(_bsNet.genesisTime)) {
    await lidoOracleHelper.setBeaconSpec(_bsNet, proposer, voters)
    logger.info(`New spec set:`, _bsNet)
  }
  return true
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
