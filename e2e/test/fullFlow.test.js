import test from 'ava'

import { prepareContext } from '../scripts/helpers'
import logger from '../scripts/helpers/logger'
import { expectEvent } from '@openzeppelin/test-helpers'
import {
  ETH,
  getSigningKeys,
  sleep as waitFor,
  getGeneratedWithdrawalAddress,
  concat0x,
  getDataToPerformDepositContract,
  BN
} from '../scripts/helpers/utils'

import * as aclHelper from '../scripts/helpers/apps/aclHelper'
import * as lidoHelper from '../scripts/helpers/apps/lidoHelper'
import * as eth2Helper from '../scripts/helpers/eth2/Eth2Helper'
import * as stEthHelper from '../scripts/helpers/apps/stEthHelper'
import * as votingHelper from '../scripts/helpers/apps/votingHelper'
import * as lidoOracleHelper from '../scripts/helpers/apps/lidoOracleHelper'
import * as nodeOperatorsHelper from '../scripts/helpers/apps/nodeOperatorsHelper'
import * as vaultHelper from '../scripts/helpers/apps/vaultHelper'
import * as tokenManagerHelper from '../scripts/helpers/apps/tokenManagerHelper'
import * as depositContractHelper from '../scripts/helpers/apps/depositContractHelper'
import {
  oracleAccounts as oracleMembers,
  nosAccounts as nosMembers,
  simpleAccounts as users,
  UNLIMITED_STAKING_LIMIT,
  BASIC_FEE,
  TREASURY_FEE,
  INSURANCE_FEE,
  NODE_OPERATOR_BASIC_FEE,
  SET_NODE_OPERATOR_NAME_ROLE,
  SET_NODE_OPERATOR_ADDRESS_ROLE,
  SET_NODE_OPERATOR_ACTIVE_ROLE,
  SET_NODE_OPERATOR_LIMIT_ROLE,
  REPORT_STOPPED_VALIDATORS_ROLE,
  ZERO_ADDRESS
} from '../scripts/helpers/constants'

test.before('Connecting Web3', async (t) => {
  t.context = await prepareContext({ numUnlock: 50 })
  lidoHelper.init(t.context)
  aclHelper.init(t.context)
  votingHelper.init(t.context)
  stEthHelper.init(t.context)
  lidoOracleHelper.init(t.context)
  nodeOperatorsHelper.init(t.context)
  vaultHelper.init(t.context)
  tokenManagerHelper.init(t.context)
  depositContractHelper.init(t.context)
})

test('Full flow test ', async (t) => {
  const { accounts } = t.context
  const [holder1, holder2, holder3] = accounts
  const quorumHolders = [holder1, holder2]
  const [nosMember1, nosMember2, nosMember3, nosMember4, nosMember5] = nosMembers
  const [oracleMember1, oracleMember2, oracleMember3] = oracleMembers
  const [user1, user2, user3, user4, user5] = users
  const nosFullPermissions = [
    SET_NODE_OPERATOR_NAME_ROLE,
    SET_NODE_OPERATOR_ADDRESS_ROLE,
    SET_NODE_OPERATOR_ACTIVE_ROLE,
    SET_NODE_OPERATOR_LIMIT_ROLE,
    REPORT_STOPPED_VALIDATORS_ROLE
  ]

  logger.info('Check dao apps are deployed')
  t.true(await lidoHelper.hasInitialized(), 'Check Lido deploy')
  t.true(await stEthHelper.hasInitialized(), 'Check stEth deploy')
  t.true(await nodeOperatorsHelper.hasInitialized(), 'Check nodeOperator deploy')
  t.true(await lidoOracleHelper.hasInitialized(), 'Check LidoOracle deploy')
  t.true(await votingHelper.hasInitialized(), 'Check voting deploy')
  t.true(await vaultHelper.hasInitialized(), 'Check vault deploy')
  t.true(await tokenManagerHelper.hasInitialized(), 'Check tokenManager deploy')
  t.true(await aclHelper.hasInitialized(), 'Check acl deploy')

  logger.info('Add oracle members')
  await lidoOracleHelper.addOracleMembers(oracleMembers, holder1, quorumHolders)
  const addedOracleMembers = await lidoOracleHelper.getAllOracleMembers()
  t.deepEqual(addedOracleMembers, oracleMembers, 'Check is oracle members were  set')

  logger.info('Set quorum')
  await lidoOracleHelper.setQuorum(3, holder1, quorumHolders)
  t.is(await lidoOracleHelper.getQuorum(), '3', 'Check that the quorum was set correctly')

  logger.info('Set withdrawal credentials')
  let withdrawalAddress = getGeneratedWithdrawalAddress('validators1')
  await lidoHelper.setWithdrawalCredentials(withdrawalAddress, holder1, quorumHolders)
  t.is(await lidoHelper.getWithdrawalCredentials(), withdrawalAddress, 'Check that withdrawal credentials were set correctly')

  logger.info('Set basic fee')
  await lidoHelper.setFee(BASIC_FEE, holder1, quorumHolders)
  t.is(await lidoHelper.getFee(), BASIC_FEE.toString(), 'Check that basic fee was set correctly')

  logger.info('Set fee distribution')
  await lidoHelper.setFeeDistribution(TREASURY_FEE, INSURANCE_FEE, NODE_OPERATOR_BASIC_FEE, holder1, quorumHolders)
  const result = await lidoHelper.getFeeDistribution()
  t.is(result[0], TREASURY_FEE.toString(), 'Check that treasury fee was set correctly')
  t.is(result[1], INSURANCE_FEE.toString(), 'Check that insurance fee was set correctly')
  t.is(result[2], NODE_OPERATOR_BASIC_FEE.toString(), 'Check that nodeOperator basic fee was set correctly')

  logger.info('Add nodeOperator1 and add signing keys')
  await nodeOperatorsHelper.addNodeOperator('test provider1', nosMember1, 2, holder1, quorumHolders)
  let validatorsTestDataForSp1 = getSigningKeys('validators1', 2, 0)
  await nodeOperatorsHelper.addSigningKeys(0, validatorsTestDataForSp1, holder1, quorumHolders)

  logger.info('Check the correctness of nodeOperator1')
  let operator1 = await nodeOperatorsHelper.getNodeOperator(0, true)
  t.is(operator1.active, true, 'Check that the nodeOperator1 is active')
  t.is(operator1.name, 'test provider1', 'Check that the nodeOperator1 name is correct')
  t.is(operator1.rewardAddress, nosMember1, 'Check that the nodeOperator1 is correct')
  t.is(operator1.stakingLimit, '2', 'Check that the nodeOperator1 stakingLimit is correct')
  t.is(operator1.totalSigningKeys, '2')
  t.is(operator1.usedSigningKeys, '0')
  const operator1SigningKeys = await nodeOperatorsHelper.getAllSigningKeys(operator1, 0)
  validatorsTestDataForSp1 = concat0x(validatorsTestDataForSp1)
  t.deepEqual(operator1SigningKeys.pubKeys, validatorsTestDataForSp1.pubKeys, 'Check that nodeOperator1 signing pubKeys set correct')
  t.deepEqual(operator1SigningKeys.signatures, validatorsTestDataForSp1.signatures, 'Check that nodeOperator1 signatures were set correct')

  logger.info('Add nodeOperator2 and add signing keys')
  await nodeOperatorsHelper.addNodeOperator('test provider2', nosMember2, 10, holder1, quorumHolders)
  let validatorsTestDataForSp2 = getSigningKeys('validators1', 6, 2)
  await nodeOperatorsHelper.addSigningKeys(1, validatorsTestDataForSp2, holder1, quorumHolders)

  logger.info('Check the correctness of nodeOperator2')
  let operator2 = await nodeOperatorsHelper.getNodeOperator(1, true)
  t.is(operator2.active, true, 'Check that the nodeOperator2 is active')
  t.is(operator2.name, 'test provider2', 'Check that the nodeOperator2 name is correct')
  t.is(operator2.rewardAddress, nosMember2, 'Check that the nodeOperator2 is correct ')
  t.is(operator2.stakingLimit, '10', 'Check that the nodeOperator2 stakingLimit is correct')
  t.is(operator2.totalSigningKeys, '6')
  t.is(operator2.usedSigningKeys, '0')
  const nodeOperator2SigningKeys = await nodeOperatorsHelper.getAllSigningKeys(operator2, 1)
  validatorsTestDataForSp2 = concat0x(validatorsTestDataForSp2)
  t.deepEqual(nodeOperator2SigningKeys.pubKeys, validatorsTestDataForSp2.pubKeys, 'Check that nodeOperator2 signing pubKeys set correct')
  t.deepEqual(
    nodeOperator2SigningKeys.signatures,
    validatorsTestDataForSp2.signatures,
    'Check that nodeOperator2 signatures were set correct'
  )

  logger.info('Add nodeOperator3 and add signing keys')
  await nodeOperatorsHelper.addNodeOperator('test provider3', nosMember3, UNLIMITED_STAKING_LIMIT, holder1, quorumHolders)
  let validatorsTestDataForSp3 = getSigningKeys('validators1', 20, 8)
  await nodeOperatorsHelper.addSigningKeysOperatorBH(2, validatorsTestDataForSp3, nosMember3)

  logger.info('Check the correctness of nodeOperator3')
  let operator3 = await nodeOperatorsHelper.getNodeOperator(2, true)
  t.is(operator3.active, true, 'Check that the nodeOperator3 is active')
  t.is(operator3.name, 'test provider3', 'Check that the nodeOperator3 name is correct')
  t.is(operator3.rewardAddress, nosMember3, 'Check that the nodeOperator3 is correct ')
  t.is(operator3.stakingLimit, String(UNLIMITED_STAKING_LIMIT), 'Check that the nodeOperator3 stakingLimit is correct')
  t.is(operator3.totalSigningKeys, '20')
  t.is(operator3.usedSigningKeys, '0')
  const nodeOperator3SigningKeys = await nodeOperatorsHelper.getAllSigningKeys(operator3, 2)
  validatorsTestDataForSp3 = concat0x(validatorsTestDataForSp3)
  t.deepEqual(nodeOperator3SigningKeys.pubKeys, validatorsTestDataForSp3.pubKeys, 'Check that nodeOperator3 signing pubKeys set correct')
  t.deepEqual(
    nodeOperator3SigningKeys.signatures,
    validatorsTestDataForSp3.signatures,
    'Check that nodeOperator3 signatures were set correct'
  )

  logger.info('Deposit 2 ETH to Lido via Lido from user1')
  await lidoHelper.depositToLidoContract(user1, ETH(2))
  let user1Deposit = ETH(2)
  t.is(await stEthHelper.getBalance(user1), ETH(2), 'Check that user receive an appropriate amount of stEth tokens')
  t.is(await lidoHelper.getBufferedEther(), ETH(2), 'Buffered ether in Lido')
  t.is(await lidoHelper.getTotalPooledEther(), ETH(2), 'Total pooled ether in Lido')

  logger.info('Deposit 30 ETH to Lido via Lido from user1')
  await lidoHelper.depositToLidoContract(user1, ETH(30))
  user1Deposit = (+user1Deposit + +ETH(30)).toString()
  t.is(await stEthHelper.getBalance(user1), user1Deposit, 'Check that user receive an appropriate amount of stEth tokens')
  t.is(await lidoHelper.getBufferedEther(), '0', 'Buffered ether in Lido')
  t.is(await lidoHelper.getTotalPooledEther(), ETH(32), 'Total pooled ether in Lido')

  logger.info('Deposit 2 ETH to Lido via Lido from user2')
  await lidoHelper.depositToLidoContract(user2, ETH(2))
  let user2Deposit = ETH(2)
  t.is(await stEthHelper.getBalance(user2), ETH(2), 'Check that user receive an appropriate amount of stEth tokens')
  t.is(await lidoHelper.getBufferedEther(), ETH(2), 'Buffered ether in Lido')
  t.is(await lidoHelper.getTotalPooledEther(), ETH(34), 'Total pooled ether in Lido')

  logger.info('Deposit 32 ETH to Lido via Lido  from user2')
  user2Deposit = (+user2Deposit + +ETH(32)).toString()
  await lidoHelper.depositToLidoContract(user2, ETH(32))
  t.is(await stEthHelper.getBalance(user2), user2Deposit, 'Check that user receive an appropriate amount of stEth tokens')
  t.is(await lidoHelper.getBufferedEther(), ETH(2), 'Buffered ether in Lido')
  t.is(await lidoHelper.getTotalPooledEther(), ETH(66), 'Total pooled ether in Lido')

  logger.info('Deposit 222 ETH to Lido via Lido from user3')
  await lidoHelper.depositToLidoContract(user3, ETH(222))
  let user3Deposit = ETH(222)
  t.is(await stEthHelper.getBalance(user3), user3Deposit, 'Check that user receive an appropriate amount of stEth tokens')
  t.is(await lidoHelper.getBufferedEther(), '0', 'Buffered ether in Lido')
  t.is(await lidoHelper.getTotalPooledEther(), ETH(288), 'Total pooled ether in Lido')

  logger.info('Deposit 32 ETH via validators deposit contract from user4')
  const depositData = getDataToPerformDepositContract('validators1')
  const receipt = await depositContractHelper.deposit(user4, ETH(32), depositData)
  expectEvent(receipt, 'DepositEvent', {
    pubkey: depositData.pubkey,
    withdrawal_credentials: depositData.withdrawal_credentials,
    signature: depositData.signature,
    amount: '0x0040597307000000' // 32eth in gweis converted to little endian bytes
  })
  t.is(await stEthHelper.getBalance(user4), '0', 'Check that user4 don`t receive tokens after transaction to deposit contract')
  // TODO check that validator is up/not up

  logger.info('Deposit 288 ETH to Lido via Lido from user3')
  await lidoHelper.depositToLidoContract(user3, ETH(288))
  user3Deposit = (+user3Deposit + +ETH(288)).toString()

  let ether2Stat = await lidoHelper.getBeaconStat()
  let usersDeposits = (+user1Deposit + +user2Deposit + +user3Deposit).toString()
  t.is(await stEthHelper.getBalance(user3), user3Deposit, 'Check that user receive an appropriate amount of stEth tokens')
  t.is(await lidoHelper.getBufferedEther(), '0', 'Buffered ether in Lido')
  t.is(await lidoHelper.getTotalPooledEther(), usersDeposits, 'Total pooled ether in Lido')
  t.is(await ether2Stat.depositedValidators, usersDeposits, 'Check that the ether2 stat is changed correctly')

  logger.info('Chek that the staking providers keys became using')
  operator1 = await nodeOperatorsHelper.getNodeOperator(0, true)
  operator2 = await nodeOperatorsHelper.getNodeOperator(1, true)
  operator3 = await nodeOperatorsHelper.getNodeOperator(2, true)
  t.is(operator1.usedSigningKeys, '2', 'nodeOperators1 signing keys became using')
  t.is(await nodeOperatorsHelper.getUnusedSigningKeyCount(0), '0', 'Check unused nodeOperator1 keys')
  t.is(operator2.usedSigningKeys, '6', 'nodeOperators2 signing keys became using')
  t.is(await nodeOperatorsHelper.getUnusedSigningKeyCount(1), '0', 'Check unused nodeOperator2 keys')
  t.is(operator3.usedSigningKeys, '10', 'nodeOperators3 signing keys became using')
  t.is(await nodeOperatorsHelper.getUnusedSigningKeyCount(2), '10', 'Check unused nodeOperator3 keys')

  // TODO long tail
  // TODO Convert some default token to ctoken
  // TODO deploy oracle daemons

  logger.info('Wait for validators activation')
  await waitFor(150)

  logger.info('Check that the validators have been activated')
  const operator1UsedSigningKeys = await nodeOperatorsHelper.getActiveSigningKeys(operator1, operator1SigningKeys)
  const operator2UsedSigningKeys = await nodeOperatorsHelper.getActiveSigningKeys(operator2, nodeOperator2SigningKeys)
  const operator3UsedSigningKeys = await nodeOperatorsHelper.getActiveSigningKeys(operator3, nodeOperator3SigningKeys)
  const operatorsUsedSigningKeys = operator1UsedSigningKeys.concat(operator2UsedSigningKeys, operator3UsedSigningKeys)
  t.true(eth2Helper.isValidatorsStarted(operatorsUsedSigningKeys), 'Check that validators have been activated with added signing keys')

  logger.info('Check that the network is producing and finalizing blocks')
  t.true(await eth2Helper.isEth2NetworkProducingSlots())

  // // logger.info('Waiting for the validator to receive a reward')
  // // TODO check validators data
  // // await waitFor(20000)

  logger.info('Push data to eth1')
  let oracleData = ETH(600)
  const LidoUsedEther = await lidoHelper.getUsedEther()
  let stakeProfit = +oracleData - +LidoUsedEther
  let validatorsReward = stakeProfit
  let totalUsedSigningKeys = await nodeOperatorsHelper.getTotalActiveKeysCount()
  let operator1BalanceBeforePushData = await stEthHelper.getBalance(nosMember1)
  let operator2BalanceBeforePushData = await stEthHelper.getBalance(nosMember2)
  let operator3BalanceBeforePushData = await stEthHelper.getBalance(nosMember3)
  let treasuryBalanceBeforePushData = await stEthHelper.getBalance(await lidoHelper.getTreasuryAddress())
  let insuranceFundBalanceBeforePushData = await stEthHelper.getBalance(await lidoHelper.getInsuranceFundAddress())
  await lidoOracleHelper.pushData(400, oracleData, oracleMember1)
  await lidoOracleHelper.pushData(400, oracleData, oracleMember2)
  await lidoOracleHelper.pushData(400, oracleData, oracleMember3)
  let latestData = await lidoOracleHelper.getLatestData()
  t.is(latestData.eth2balance, oracleData, 'Check that the oracle eth2 balance has been changed')
  t.is(latestData.reportInterval, '400', 'Check that the oracle report interval has been changed')
  t.is(
    await stEthHelper.getBalance(nosMember1),
    nodeOperatorsHelper.calculateNewNodeOperatorBalance(operator1, stakeProfit, totalUsedSigningKeys, operator1BalanceBeforePushData),
    'Check that nodeOperator1 receive an appropriate amount of reward tokens'
  )
  t.is(
    await stEthHelper.getBalance(nosMember2),
    nodeOperatorsHelper.calculateNewNodeOperatorBalance(operator2, stakeProfit, totalUsedSigningKeys, operator2BalanceBeforePushData),
    'Check that nodeOperator2 receive an appropriate amount of reward tokens'
  )
  t.is(
    await stEthHelper.getBalance(nosMember3),
    nodeOperatorsHelper.calculateNewNodeOperatorBalance(operator3, stakeProfit, totalUsedSigningKeys, operator3BalanceBeforePushData),
    'Check that nodeOperator3 receive an appropriate amount of reward tokens'
  )
  t.is(
    await stEthHelper.getBalance(await lidoHelper.getTreasuryAddress()),
    lidoHelper.calculateNewTreasuryBalance(stakeProfit, treasuryBalanceBeforePushData),
    'Check that the treasury receive appropriate amount of tokens by validators rewards'
  )
  t.is(
    await stEthHelper.getBalance(await lidoHelper.getInsuranceFundAddress()),
    lidoHelper.calculateNewTreasuryBalance(stakeProfit, insuranceFundBalanceBeforePushData),
    'Check that the insurance fund receive appropriate amount of tokens by validators rewards'
  )

  // TODO Broad strokes:
  // ctoken stay the same but is convertable to a right amount of atoken,
  // and fees are paid in right amount to the right validators

  // TODO Report slashing, check that there is no reward and atoken balance decreases and ctoken stay the same

  logger.info('Change withdrawal credentials')
  t.is(await nodeOperatorsHelper.getUnusedSigningKeyCount(0), '0')
  t.is(await nodeOperatorsHelper.getUnusedSigningKeyCount(1), '0')
  t.is(await nodeOperatorsHelper.getUnusedSigningKeyCount(2), '10')
  withdrawalAddress = getGeneratedWithdrawalAddress('validators2')
  await lidoHelper.setWithdrawalCredentials(withdrawalAddress, holder1, quorumHolders)
  t.is(await lidoHelper.getWithdrawalCredentials(), withdrawalAddress, 'Check that withdrawal credentials were set correctly')

  logger.info('Check that unused signing keys removed from nodeOperators after change withdrawal credentials')
  operator1 = await nodeOperatorsHelper.getNodeOperator(0, true)
  operator2 = await nodeOperatorsHelper.getNodeOperator(1, true)
  operator3 = await nodeOperatorsHelper.getNodeOperator(2, true)
  t.is(
    await nodeOperatorsHelper.getUnusedSigningKeyCount(0),
    '0',
    'nodeOperator1 unused keys were removed after change withdrawal credentials'
  )
  t.is(
    await nodeOperatorsHelper.getUnusedSigningKeyCount(1),
    '0',
    'nodeOperator2 unused keys were removed after change withdrawal credentials'
  )
  t.is(
    await nodeOperatorsHelper.getUnusedSigningKeyCount(2),
    '0',
    'nodeOperator3 unused keys were removed after change withdrawal credentials'
  )
  t.is(operator1.totalSigningKeys, operator1.usedSigningKeys)
  t.is(operator2.totalSigningKeys, operator2.usedSigningKeys)
  t.is(operator3.totalSigningKeys, operator3.usedSigningKeys)

  logger.info('Set full nodeOperator permissions to nodeOperator4')
  await aclHelper.setPermissions([nosMember4], nosFullPermissions, nodeOperatorsHelper.getProxyAddress(), holder1, quorumHolders)
  t.true(await aclHelper.hasPermissions([nosMember4], nodeOperatorsHelper.getProxyAddress(), nosFullPermissions))

  logger.info('Add nodeOperator4 and add signing keys')
  await nodeOperatorsHelper.addNodeOperator('test provider4', nosMember4, UNLIMITED_STAKING_LIMIT, holder1, quorumHolders)
  let validatorsTestDataForSp4 = getSigningKeys('validators2', 40, 0)
  await nodeOperatorsHelper.addSigningKeysOperatorBH(3, validatorsTestDataForSp4, nosMember4)

  logger.info('Check the correctness of nodeOperator4')
  let operator4 = await nodeOperatorsHelper.getNodeOperator(3, true)
  t.is(operator4.active, true, 'Check that the nodeOperator4 is active')
  t.is(operator4.name, 'test provider4', 'Check that the nodeOperator4 name is correct')
  t.is(operator4.rewardAddress, nosMember4, 'Check that the nodeOperator4 is correct ')
  t.is(operator4.stakingLimit, String(UNLIMITED_STAKING_LIMIT), 'Check that the nodeOperator4 stakingLimit is correct')
  t.is(operator4.totalSigningKeys, '40')
  t.is(operator4.usedSigningKeys, '0')
  const operator4SigningKeys = await nodeOperatorsHelper.getAllSigningKeys(operator4, 3)
  validatorsTestDataForSp4 = concat0x(validatorsTestDataForSp4)
  t.deepEqual(operator4SigningKeys.pubKeys, validatorsTestDataForSp4.pubKeys, 'Check that nodeOperator4 signing pubKeys set correct')
  t.deepEqual(operator4SigningKeys.signatures, validatorsTestDataForSp4.signatures, 'Check that nodeOperator4 signatures were set correct')

  logger.info('Change nodeOperator4 name and rewardAddress')
  // await nodeOperatorsHelper.setNodeOperatorName(3, 'newName', nosMember4)
  await nodeOperatorsHelper.setNodeOperatorRewardAddress(3, nosMember5, nosMember4)
  operator4 = await nodeOperatorsHelper.getNodeOperator(3, true)
  // t.is(nodeOperator4.name, 'newName', 'Check the correctness of change nodeOperator4 name')
  t.is(operator4.rewardAddress, nosMember5, 'Check the correctness of change nodeOperator4 rewardAddress')

  logger.info('Check deposit iteration limit')
  const user5Deposit = ETH(20 * 32)
  const maxDepositCalls = 16
  await lidoHelper.depositToLidoContract(user5, user5Deposit, ZERO_ADDRESS, maxDepositCalls)
  ether2Stat = await lidoHelper.getBeaconStat()
  t.is(await stEthHelper.getBalance(user5), user5Deposit, 'Check that user receive an appropriate amount of stEth tokens')
  t.is(
    await lidoHelper.getBufferedEther(),
    (+ETH(20 * 32) - +ETH(16 * 32)).toString(),
    'Check that the rest of the deposited Ether is still buffered in the Lido due to iteration limit '
  )
  // When oracle`s push data was submitted at the first time,
  // the total  total controlled ether is changing after next oracle pushData,
  // but buffered ether is displaying in total pooled ether
  t.is(
    await lidoHelper.getTotalPooledEther(),
    BN(oracleData)
      .add(BN(ETH(4 * 32)))
      .toString(),
    'Check that the total pooled ether in Lido is correct'
  )
  t.is(
    ether2Stat.depositedValidators,
    BN(usersDeposits)
      .add(BN(ETH(16 * 32)))
      .toString()
  )

  logger.info('Check that the rest of buffered Ether in the pool can be submitted')

  await lidoHelper.depositBufferedEther(user5)
  operator4 = await nodeOperatorsHelper.getNodeOperator(3, true)
  ether2Stat = await lidoHelper.getBeaconStat()
  usersDeposits = BN(usersDeposits).add(BN(user5Deposit))
  t.is(await lidoHelper.getBufferedEther(), '0', 'Check that the rest of buffered Ether became became active')
  t.is(operator4.usedSigningKeys, '20', 'nodeOperators4 signing keys became using')
  t.is(await nodeOperatorsHelper.getUnusedSigningKeyCount(3), '20', 'Check unused nodeOperator4 keys')
  t.is(ether2Stat.depositedValidators, usersDeposits.toString(), 'Check that the Ether was deposited after submit buffered ether')

  logger.info('Wait for validators activation')
  await waitFor(150)

  logger.info('Check that the validators have been activated')
  const operator4UsedSigningKeys = await nodeOperatorsHelper.getActiveSigningKeys(operator4, operator4SigningKeys)
  t.true(eth2Helper.isValidatorsStarted(operator4UsedSigningKeys), 'Check validators activation')

  logger.info('Deactivate nodeOperator4 with currently using signing keys')
  await nodeOperatorsHelper.setNodeOperatorActive(3, false, nosMember4)
  operator4 = await nodeOperatorsHelper.getNodeOperator(3, true)
  t.is(operator4.active, false, 'Check that the nodeOperator4 has been deactivated')
  t.is(
    await nodeOperatorsHelper.getActiveNodeOperatorsCount(),
    '3',
    'Check that the count of active providers is changed after deactivate one'
  )

  logger.info('Push data and check that the deactivated provider balance not changed')
  oracleData = ETH(2000)
  ether2Stat = await lidoHelper.getBeaconStat()
  stakeProfit = BN(oracleData).sub(BN(ether2Stat.depositedValidators)).sub(BN(validatorsReward)).toString()
  validatorsReward = stakeProfit
  totalUsedSigningKeys = await nodeOperatorsHelper.getTotalActiveKeysCount()
  operator1BalanceBeforePushData = await stEthHelper.getBalance(nosMember1)
  operator2BalanceBeforePushData = await stEthHelper.getBalance(nosMember2)
  operator3BalanceBeforePushData = await stEthHelper.getBalance(nosMember3)
  const nodeOperator4BalanceBeforePushData = await stEthHelper.getBalance(nosMember4)
  treasuryBalanceBeforePushData = await stEthHelper.getBalance(await lidoHelper.getTreasuryAddress())
  insuranceFundBalanceBeforePushData = await stEthHelper.getBalance(await lidoHelper.getInsuranceFundAddress())
  await lidoOracleHelper.pushData(2500, oracleData, oracleMember1)
  await lidoOracleHelper.pushData(2500, oracleData, oracleMember2)
  await lidoOracleHelper.pushData(2500, oracleData, oracleMember3)
  latestData = await lidoOracleHelper.getLatestData()
  t.is(latestData.eth2balance, oracleData, 'Check that the oracle eth2 balance has been changed')
  t.is(latestData.reportInterval, '2500', 'Check that the oracle report interval has been changed')

  logger.info('Check that the rewards have been split between nos1,nos2,nos3 due to nos4 was deactivated')
  t.is(
    await stEthHelper.getBalance(nosMember1),
    nodeOperatorsHelper.calculateNewNodeOperatorBalance(operator1, stakeProfit, totalUsedSigningKeys, operator1BalanceBeforePushData),
    'Check that nodeOperator1 receive an appropriate amount of reward tokens'
  )
  t.is(
    await stEthHelper.getBalance(nosMember2),
    nodeOperatorsHelper.calculateNewNodeOperatorBalance(operator2, stakeProfit, totalUsedSigningKeys, operator2BalanceBeforePushData),
    'Check that nodeOperator2 receive an appropriate amount of reward tokens'
  )
  t.is(
    await stEthHelper.getBalance(nosMember3),
    nodeOperatorsHelper.calculateNewNodeOperatorBalance(operator3, stakeProfit, totalUsedSigningKeys, operator3BalanceBeforePushData),
    'Check that nodeOperator3 receive an appropriate amount of reward tokens'
  )
  t.is(
    nodeOperator4BalanceBeforePushData,
    await stEthHelper.getBalance(nosMember4),
    'Check that nodeOperator4 don`t received reward due to deactivated'
  )
  t.is(
    await stEthHelper.getBalance(await lidoHelper.getTreasuryAddress()),
    lidoHelper.calculateNewTreasuryBalance(stakeProfit, treasuryBalanceBeforePushData),
    'Check that the treasury receive appropriate amount of tokens by validators rewards'
  )
  t.is(
    await stEthHelper.getBalance(await lidoHelper.getInsuranceFundAddress()),
    lidoHelper.calculateNewTreasuryBalance(stakeProfit, insuranceFundBalanceBeforePushData),
    'Check that the insurance fund receive appropriate amount of tokens by validators rewards'
  )

  logger.info('Increase staking limit for nodeOperator4')
  await nodeOperatorsHelper.setNodeOperatorStakingLimit(3, 50, nosMember4)
  operator4 = await nodeOperatorsHelper.getNodeOperator(3, true)
  t.is(operator4.stakingLimit, '50', 'Check that the nodeOperator4 staking limit increased correctly')

  logger.info('Reduce the staking limit for nodeOperator4')
  await nodeOperatorsHelper.setNodeOperatorStakingLimit(3, +operator4.usedSigningKeys, nosMember4)
  operator4 = await nodeOperatorsHelper.getNodeOperator(3, true)
  t.is(operator4.stakingLimit, operator4.usedSigningKeys, 'Check that the nodeOperator4 staking limit reduced correctly')

  logger.info('Check that the validators do not activate if there are no unused signing keys')
  withdrawalAddress = getGeneratedWithdrawalAddress('validators1')
  await lidoHelper.setWithdrawalCredentials(withdrawalAddress, holder1, quorumHolders)
  operator1 = await nodeOperatorsHelper.getNodeOperator(0, true)
  operator2 = await nodeOperatorsHelper.getNodeOperator(1, true)
  operator3 = await nodeOperatorsHelper.getNodeOperator(2, true)
  operator4 = await nodeOperatorsHelper.getNodeOperator(3, true)
  t.is(
    await nodeOperatorsHelper.getUnusedSigningKeyCount(0),
    '0',
    'nodeOperator1 unused keys were removed after change withdrawal credentials'
  )
  t.is(
    await nodeOperatorsHelper.getUnusedSigningKeyCount(1),
    '0',
    'nodeOperator2 unused keys were removed after change withdrawal credentials'
  )
  t.is(
    await nodeOperatorsHelper.getUnusedSigningKeyCount(2),
    '0',
    'nodeOperator3 unused keys were removed after change withdrawal credentials'
  )
  t.is(operator1.totalSigningKeys, operator1.usedSigningKeys)
  t.is(operator2.totalSigningKeys, operator2.usedSigningKeys)
  t.is(operator3.totalSigningKeys, operator3.usedSigningKeys)
  t.is(operator4.totalSigningKeys, operator4.usedSigningKeys)

  logger.info('Check that the validators do not activate if there are no unused signing keys')
  await lidoHelper.depositToLidoContract(user2, ETH(64))
  ether2Stat = await lidoHelper.getBeaconStat()
  t.is(ether2Stat.depositedValidators, usersDeposits.toString(), 'Check that the deposit not performed')
  t.is(await lidoHelper.getBufferedEther(), ETH(64), 'Check that the deposited Ether is buffered due to no unused keys')
  // TODO Test insurance (pending for the actual insurance)
  t.pass()
})
