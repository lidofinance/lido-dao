import logger from './helpers/logger'
import { prepareContext } from './helpers'
import { loadGeneratedValidatorsData, ETH } from './helpers/utils'
import * as lidoHelper from './helpers/apps/lidoHelper'
import * as nodeOperatorsHelper from './helpers/apps/nodeOperatorsHelper'
import * as lidoOracleHelper from './helpers/apps/lidoOracleHelper'
import * as eth2Helper from './helpers/eth2/Eth2Helper'

const main = async () => {
  const context = await prepareContext()
  const { accounts } = context
  const voters = accounts.slice(0, 2)
  const proposer = accounts[0]
  const staker = accounts[0]
  const nos = accounts.slice(5, 7)
  const oracles = accounts.slice(30, 33)

  logger.info(`Holders: ${voters}`)
  logger.info(`Node operators: ${nos}`)
  logger.info(`Oracle members: ${oracles}`)
  let r

  lidoHelper.init(context)
  nodeOperatorsHelper.init(context)
  lidoOracleHelper.init(context)

  const depositData = await loadGeneratedValidatorsData('validators1')

  const wc = '0x' + depositData[0].withdrawal_credentials
  const keysPerNOS = 10

  const _wc = await lidoHelper.getWithdrawalCredentials()
  if (_wc !== wc) {
    r = await lidoHelper.setWithdrawalCredentials(wc, proposer, voters)
    r = await lidoHelper.setFee('10000', proposer, voters)
    r = await lidoHelper.setFeeDistribution('1000', '1000', '8000', proposer, voters)
    // console.log(r.events)
  }

  // const _nosCount = await nodeOperatorsHelper.getNodeOperatorsCount()
  // if (_nosCount < nos.length) {
  for (let i = 0; i < nos.length; i++) {
    let _nodeOperator
    try {
      _nodeOperator = await nodeOperatorsHelper.getNodeOperator(i)
    } catch (e) {
      _nodeOperator = null
    }
    if (!_nodeOperator) {
      r = await nodeOperatorsHelper.addNodeOperator(`NOS#${i}`, nos[i], 0x100, proposer, voters)
      // console.log(r.events)
      _nodeOperator = await nodeOperatorsHelper.getNodeOperator(i)
    }
    logger.info(`Node operator: ${_nodeOperator.name}`)
    if (!+_nodeOperator.totalSigningKeys) {
      logger.info(`Add ${keysPerNOS} keys...`)
      const data = depositData.slice(i * keysPerNOS, (i + 1) * keysPerNOS).reduce(
        (a, d) => {
          a.pubKeys.push(d.pubkey)
          a.signatures.push(d.signature)
          return a
        },
        { pubKeys: [], signatures: [] }
      )
      console.log(data)
      r = await nodeOperatorsHelper.addSigningKeysOperatorBH(i, data, nos[i])
      // console.log(r.events)
      logger.info(` keys: ${keysPerNOS}`)
    } else {
      logger.info(` keys: ${_nodeOperator.totalSigningKeys}`)
    }
  }
  // }

  // oracles

  const _bsContract = await lidoOracleHelper.getBeaconSpec()
  const _bsNet = await eth2Helper.getBeaconSpec()
  // assume compare only genesis time is enough
  if (parseInt(parseInt(_bsContract.genesisTime)) !== parseInt(_bsNet.genesisTime)) {
    r = await lidoOracleHelper.setBeaconSpec(_bsNet, proposer, voters)
    // console.log(r.events)
  }

  const members = (await lidoOracleHelper.getAllOracleMembers()).map((m) => m.toLowerCase())
  for (let i = 0; i < oracles.length; i++) {
    if (!members.includes(oracles[i].toLowerCase())) {
      r = await lidoOracleHelper.addOracleMember(oracles[i], proposer, voters)
      // console.log(r.events)
    }
  }
  // console.log('LATEST DATA', await lidoOracleHelper.methods.getLatestData().call())

  const _q = await lidoOracleHelper.getQuorum()
  if (parseInt(_q) !== oracles.length) {
    r = await lidoOracleHelper.setQuorum(oracles.length, proposer, voters)
    // console.log(r.events)
  }

  // test deoposit
  logger.info(`Make deposit 123ETH...`)
  r = await lidoHelper.depositToLidoContract(staker, ETH(123))
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
