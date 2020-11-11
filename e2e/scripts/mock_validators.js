import logger from './helpers/logger'
import { prepareContext } from './helpers'
import { loadGeneratedValidatorsData, ETH } from './helpers/utils'
import * as depoolHelper from './helpers/apps/depoolHelper'
import * as stakingProviderHelper from './helpers/apps/stakingProviderHelper'
import * as dePoolOracleHelper from './helpers/apps/dePoolOracleHelper'

const duration = parseInt(process.env.REPORT_INTERVAL_DURATION || '160')

const main = async () => {
  const context = await prepareContext()
  const { accounts } = context
  const voters = accounts.slice(0, 3)
  const proposer = accounts[0]
  const staker = accounts[0]
  const sps = accounts.slice(5, 7)
  const oracles = accounts.slice(30, 33)

  logger.info(voters)
  logger.info(sps)
  logger.info(oracles)
  let r

  depoolHelper.init(context)
  stakingProviderHelper.init(context)
  dePoolOracleHelper.init(context)

  const depositData = await loadGeneratedValidatorsData('validators1')

  const wc = '0x' + depositData[0].withdrawal_credentials
  const keysPerSP = 20

  const _duration = parseInt(await dePoolOracleHelper.getReportIntervalDuration())
  if (_duration !== duration) {
    r = await dePoolOracleHelper.setReportIntervalDuration(duration, proposer, voters)
  }

  // return
  const _wc = await depoolHelper.getWithdrawalCredentials()
  if (_wc !== wc) {
    r = await depoolHelper.setWithdrawalCredentials(wc, proposer, voters)
    r = await depoolHelper.setFee('10000', proposer, voters)
    r = await depoolHelper.setFeeDistribution('1000', '1000', '8000', proposer, voters)
    // console.log(r.events)
  }

  // const _spcnt = await stakingProviderHelper.getNodeOperatorsCount()
  // if (_spcnt < sps.length) {
  for (let i = 0; i < sps.length; i++) {
    let _sp
    try {
      _sp = await stakingProviderHelper.getNodeOperator(i)
    } catch (e) {
      _sp = null
    }
    if (!_sp) {
      r = await stakingProviderHelper.addNodeOperator(`SP#${i}`, sps[i], 0x100, proposer, voters)
      // console.log(r.events)
      _sp = await stakingProviderHelper.getNodeOperator(i)
    }
    logger.info(`name: ${_sp.name}`)
    if (!+_sp.totalSigningKeys) {
      logger.info(`Add keys...`)
      const data = depositData.slice(i * keysPerSP, (i + 1) * keysPerSP).reduce(
        (a, d) => {
          a.pubKeys.push(d.pubkey)
          a.signatures.push(d.signature)
          return a
        },
        { pubKeys: [], signatures: [] }
      )
      r = await stakingProviderHelper.addSigningKeysOperatorBH(i, data, sps[i])
      // console.log(r.events)
      logger.info(`keys: ${keysPerSP}`)
    } else {
      logger.info(`keys: ${_sp.totalSigningKeys}`)
    }
  }
  // }

  // oracles

  const members = (await dePoolOracleHelper.getAllOracleMembers()).map((m) => m.toLowerCase())
  for (let i = 0; i < oracles.length; i++) {
    if (!members.includes(oracles[i].toLowerCase())) {
      r = await dePoolOracleHelper.addOracleMember(oracles[i], proposer, voters)
      // console.log(r.events)
    }
  }
  // console.log('LATEST DATA', await dePoolOracleContract.methods.getLatestData().call())

  const _q = await dePoolOracleHelper.getQuorum()
  if (parseInt(_q) !== oracles.length) {
    r = await dePoolOracleHelper.setQuorum(oracles.length, proposer, voters)
    console.log(r.events)
  }

  // test deoposit
  r = await depoolHelper.depositToLidoContract(staker, ETH(333))
  console.log(r.events)
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
