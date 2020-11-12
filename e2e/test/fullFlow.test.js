import test from 'ava'

import { prepareContext } from '../scripts/helpers'
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
import * as dePoolHelper from '../scripts/helpers/apps/depoolHelper'
import * as eth2Helper from '../scripts/helpers/eth2/Eth2Helper'
import * as stEthHelper from '../scripts/helpers/apps/stEthHelper'
import * as votingHelper from '../scripts/helpers/apps/votingHelper'
import * as dePoolOracleHelper from '../scripts/helpers/apps/dePoolOracleHelper'
import * as stakingProvidersHelper from '../scripts/helpers/apps/stakingProviderHelper'
import * as vaultHelper from '../scripts/helpers/apps/vaultHelper'
import * as tokenManagerHelper from '../scripts/helpers/apps/tokenManagerHelper'
import * as depositContractHelper from '../scripts/helpers/apps/depositContractHelper'
import {
  oracleAccounts as oracleMembers,
  spsAccounts as spsMembers,
  simpleAccounts as users,
  UNLIMITED_STAKING_LIMIT,
  BASIC_FEE,
  TREASURY_FEE,
  INSURANCE_FEE,
  SP_BASIC_FEE,
  SET_STAKING_PROVIDER_NAME_ROLE,
  SET_STAKING_PROVIDER_ACTIVE_ROLE,
  SET_STAKING_PROVIDER_ADDRESS_ROLE,
  SET_STAKING_PROVIDER_LIMIT_ROLE,
  REPORT_STOPPED_VALIDATORS_ROLE
} from '../scripts/helpers/constants'

test.before('Connecting Web3', async (t) => {
  t.context = await prepareContext()
  dePoolHelper.init(t.context)
  aclHelper.init(t.context)
  votingHelper.init(t.context)
  stEthHelper.init(t.context)
  dePoolOracleHelper.init(t.context)
  stakingProvidersHelper.init(t.context)
  vaultHelper.init(t.context)
  tokenManagerHelper.init(t.context)
  depositContractHelper.init(t.context)
})

test('Full flow test ', async (t) => {
  const { web3, logger, accounts } = t.context
  const [holder1, holder2, holder3, holder4, holder5] = accounts
  const quorumHolders = [holder1, holder2, holder3]
  const [spsMember1, spsMember2, spsMember3, spsMember4, spsMember5] = spsMembers
  const [oracleMember1, oracleMember2, oracleMember3] = oracleMembers
  const [user1, user2, user3, user4, user5] = users
  const spsFullPermissions = [
    SET_STAKING_PROVIDER_NAME_ROLE,
    SET_STAKING_PROVIDER_ADDRESS_ROLE,
    SET_STAKING_PROVIDER_LIMIT_ROLE,
    SET_STAKING_PROVIDER_ACTIVE_ROLE,
    REPORT_STOPPED_VALIDATORS_ROLE
  ]

  // TODO wrap

  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 5; j++) {
      await web3.eth.sendTransaction({
        from: accounts[i],
        to: accounts[i * 5 + 10 + j],
        value: web3.utils.toWei('1000', 'ether')
      })
      logger.debug(`1000ETH from ${accounts[i]} (${i}) to ${accounts[i * 5 + 10 + j]} (${i * 5 + 10 + j})}`)
    }
  }
  logger.info('Check dao apps are deployed')
  t.true(await dePoolHelper.hasInitialized(), 'Check dePool deploy')
  t.true(await stEthHelper.hasInitialized(), 'Check stEth deploy')
  t.true(await stakingProvidersHelper.hasInitialized(), 'Check stakingProviders deploy')
  t.true(await dePoolOracleHelper.hasInitialized(), 'Check dePoolOracle deploy')
  t.true(await votingHelper.hasInitialized(), 'Check voting deploy')
  t.true(await vaultHelper.hasInitialized(), 'Check vault deploy')
  t.true(await tokenManagerHelper.hasInitialized(), 'Check tokenManager deploy')
  t.true(await aclHelper.hasInitialized(), 'Check acl deploy')

  logger.info('Add oracle members')
  await dePoolOracleHelper.addOracleMembers(oracleMembers, holder1, quorumHolders)
  const addedOracleMembers = await dePoolOracleHelper.getAllOracleMembers()
  t.deepEqual(addedOracleMembers, oracleMembers, 'Check is oracle members were  set')

  logger.info('Set quorum')
  await dePoolOracleHelper.setQuorum(3, holder1, quorumHolders)
  t.is(await dePoolOracleHelper.getQuorum(), '3', 'Check that the quorum was set correctly')

  logger.info('Set withdrawal credentials')
  let withdrawalAddress = getGeneratedWithdrawalAddress('validators1')
  await dePoolHelper.setWithdrawalCredentials(withdrawalAddress, holder1, quorumHolders)
  t.is(await dePoolHelper.getWithdrawalCredentials(), withdrawalAddress, 'Check that withdrawal credentials were set correctly')

  logger.info('Set basic fee')
  await dePoolHelper.setFee(BASIC_FEE, holder1, quorumHolders)
  t.is(await dePoolHelper.getFee(), BASIC_FEE.toString(), 'Check that basic fee was set correctly')

  logger.info('Set fee distribution')
  await dePoolHelper.setFeeDistribution(TREASURY_FEE, INSURANCE_FEE, SP_BASIC_FEE, holder1, quorumHolders)
  const result = await dePoolHelper.getFeeDistribution()
  t.is(result[0], TREASURY_FEE.toString(), 'Check that treasury fee was set correctly')
  t.is(result[1], INSURANCE_FEE.toString(), 'Check that insurance fee was set correctly')
  t.is(result[2], SP_BASIC_FEE.toString(), 'Check that sp basic fee was set correctly')

  logger.info('Check the correctness of deposit iteration limit')
  t.is(await dePoolHelper.getDepositIterationLimit(), '16', 'Check that deposit iteration limit was set correctly')

  logger.info('Add sp1 and add signing keys')
  await stakingProvidersHelper.addStakingProvider('test provider1', spsMember1, 2, holder1, quorumHolders)
  let validatorsTestDataForSp1 = getSigningKeys('validators1', 2, 0)
  await stakingProvidersHelper.addSigningKeys(0, validatorsTestDataForSp1, holder1, quorumHolders)

  logger.info('Check the correctness of sp1')
  let sp1 = await stakingProvidersHelper.getStakingProvider(0, true)
  t.is(sp1.active, true, 'Check that the sp1 is active')
  t.is(sp1.name, 'test provider1', 'Check that the sp1 name is correct')
  t.is(sp1.rewardAddress, spsMember1, 'Check that the sp1 is correct')
  t.is(sp1.stakingLimit, '2', 'Check that the sp1 stakingLimit is correct')
  t.is(sp1.totalSigningKeys, '2')
  t.is(sp1.usedSigningKeys, '0')
  const sp1SigningKeys = await stakingProvidersHelper.getAllSigningKeys(sp1, 0)
  validatorsTestDataForSp1 = concat0x(validatorsTestDataForSp1)
  t.deepEqual(sp1SigningKeys.pubKeys, validatorsTestDataForSp1.pubKeys, 'Check that sp1 signing pubKeys set correct')
  t.deepEqual(sp1SigningKeys.signatures, validatorsTestDataForSp1.signatures, 'Check that sp1 signatures were set correct')

  logger.info('Add sp2 and add signing keys')
  await stakingProvidersHelper.addStakingProvider('test provider2', spsMember2, 10, holder1, quorumHolders)
  let validatorsTestDataForSp2 = getSigningKeys('validators1', 6, 2)
  await stakingProvidersHelper.addSigningKeys(1, validatorsTestDataForSp2, holder1, quorumHolders)

  logger.info('Check the correctness of sp2')
  let sp2 = await stakingProvidersHelper.getStakingProvider(1, true)
  t.is(sp2.active, true, 'Check that the sp2 is active')
  t.is(sp2.name, 'test provider2', 'Check that the sp2 name is correct')
  t.is(sp2.rewardAddress, spsMember2, 'Check that the sp2 is correct ')
  t.is(sp2.stakingLimit, '10', 'Check that the sp2 stakingLimit is correct')
  t.is(sp2.totalSigningKeys, '6')
  t.is(sp2.usedSigningKeys, '0')
  const sp2SigningKeys = await stakingProvidersHelper.getAllSigningKeys(sp2, 1)
  validatorsTestDataForSp2 = concat0x(validatorsTestDataForSp2)
  t.deepEqual(sp2SigningKeys.pubKeys, validatorsTestDataForSp2.pubKeys, 'Check that sp2 signing pubKeys set correct')
  t.deepEqual(sp2SigningKeys.signatures, validatorsTestDataForSp2.signatures, 'Check that sp2 signatures were set correct')

  logger.info('Add sp3 and add signing keys')
  await stakingProvidersHelper.addStakingProvider('test provider3', spsMember3, UNLIMITED_STAKING_LIMIT, holder1, quorumHolders)
  let validatorsTestDataForSp3 = getSigningKeys('validators1', 20, 8)
  await stakingProvidersHelper.addSigningKeysSP(2, validatorsTestDataForSp3, spsMember3)

  logger.info('Check the correctness of sp3')
  let sp3 = await stakingProvidersHelper.getStakingProvider(2, true)
  t.is(sp3.active, true, 'Check that the sp3 is active')
  t.is(sp3.name, 'test provider3', 'Check that the sp3 name is correct')
  t.is(sp3.rewardAddress, spsMember3, 'Check that the sp3 is correct ')
  t.is(sp3.stakingLimit, String(UNLIMITED_STAKING_LIMIT), 'Check that the sp3 stakingLimit is correct')
  t.is(sp3.totalSigningKeys, '20')
  t.is(sp3.usedSigningKeys, '0')
  const sp3SigningKeys = await stakingProvidersHelper.getAllSigningKeys(sp3, 2)
  validatorsTestDataForSp3 = concat0x(validatorsTestDataForSp3)
  t.deepEqual(sp3SigningKeys.pubKeys, validatorsTestDataForSp3.pubKeys, 'Check that sp3 signing pubKeys set correct')
  t.deepEqual(sp3SigningKeys.signatures, validatorsTestDataForSp3.signatures, 'Check that sp3 signatures were set correct')

  logger.info('Deposit 2 ETH to DePool via DePool from user1')
  await dePoolHelper.depositToDePoolContract(user1, ETH(2))
  let user1Deposit = ETH(2)
  t.is(await stEthHelper.getBalance(user1), ETH(2), 'Check that user receive an appropriate amount of stEth tokens')
  t.is(await dePoolHelper.getBufferedEther(), ETH(2), 'Buffered ether in dePool')
  t.is(await dePoolHelper.getTotalPooledEther(), ETH(2), 'Total pooled ether in dePool')

  logger.info('Deposit 30 ETH to DePool via DePool from user1')
  await dePoolHelper.depositToDePoolContract(user1, ETH(30))
  user1Deposit = (+user1Deposit + +ETH(30)).toString()
  t.is(await stEthHelper.getBalance(user1), user1Deposit, 'Check that user receive an appropriate amount of stEth tokens')
  t.is(await dePoolHelper.getBufferedEther(), '0', 'Buffered ether in dePool')
  t.is(await dePoolHelper.getTotalPooledEther(), ETH(32), 'Total pooled ether in dePool')

  logger.info('Deposit 2 ETH to DePool via DePool from user2')
  await dePoolHelper.depositToDePoolContract(user2, ETH(2))
  let user2Deposit = ETH(2)
  t.is(await stEthHelper.getBalance(user2), ETH(2), 'Check that user receive an appropriate amount of stEth tokens')
  t.is(await dePoolHelper.getBufferedEther(), ETH(2), 'Buffered ether in dePool')
  t.is(await dePoolHelper.getTotalPooledEther(), ETH(34), 'Total pooled ether in dePool')

  logger.info('Deposit 32 ETH to DePool via DePool  from user2')
  user2Deposit = (+user2Deposit + +ETH(32)).toString()
  await dePoolHelper.depositToDePoolContract(user2, ETH(32))
  t.is(await stEthHelper.getBalance(user2), user2Deposit, 'Check that user receive an appropriate amount of stEth tokens')
  t.is(await dePoolHelper.getBufferedEther(), ETH(2), 'Buffered ether in dePool')
  t.is(await dePoolHelper.getTotalPooledEther(), ETH(66), 'Total pooled ether in dePool')

  logger.info('Deposit 222 ETH to dePool via DePool from user3')
  await dePoolHelper.depositToDePoolContract(user3, ETH(222))
  let user3Deposit = ETH(222)
  t.is(await stEthHelper.getBalance(user3), user3Deposit, 'Check that user receive an appropriate amount of stEth tokens')
  t.is(await dePoolHelper.getBufferedEther(), '0', 'Buffered ether in dePool')
  t.is(await dePoolHelper.getTotalPooledEther(), ETH(288), 'Total pooled ether in dePool')

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

  logger.info('Deposit 288 ETH to dePool via DePool from user3')
  await dePoolHelper.depositToDePoolContract(user3, ETH(288))
  user3Deposit = (+user3Deposit + +ETH(288)).toString()
  let ether2Stat = await dePoolHelper.getBeaconStat()
  let usersDeposits = (+user1Deposit + +user2Deposit + +user3Deposit).toString()
  t.is(await stEthHelper.getBalance(user3), user3Deposit, 'Check that user receive an appropriate amount of stEth tokens')
  t.is(await dePoolHelper.getBufferedEther(), '0', 'Buffered ether in dePool')
  t.is(await dePoolHelper.getTotalPooledEther(), usersDeposits, 'Total pooled ether in dePool')
  t.is(await ether2Stat.depositedValidators, usersDeposits, 'Check that the ether2 stat is changed correctly')

  logger.info('Chek that the staking providers keys became using')
  sp1 = await stakingProvidersHelper.getStakingProvider(0, true)
  sp2 = await stakingProvidersHelper.getStakingProvider(1, true)
  sp3 = await stakingProvidersHelper.getStakingProvider(2, true)
  t.is(sp1.usedSigningKeys, '2', 'sps1 signing keys became using')
  t.is(await stakingProvidersHelper.getUnusedSigningKeyCount(0), '0', 'Check unused sp1 keys')
  t.is(sp2.usedSigningKeys, '6', 'sps2 signing keys became using')
  t.is(await stakingProvidersHelper.getUnusedSigningKeyCount(1), '0', 'Check unused sp2 keys')
  t.is(sp3.usedSigningKeys, '10', 'sps3 signing keys became using')
  t.is(await stakingProvidersHelper.getUnusedSigningKeyCount(2), '10', 'Check unused sp3 keys')

  // TODO long tail
  // TODO Convert some default token to ctoken
  // TODO deploy oracle daemons

  logger.info('Wait for validators activation')
  await waitFor(150)

  logger.info('Check that the validators have been activated')
  const sp1UsedSigningKeys = await stakingProvidersHelper.getActiveSigningKeys(sp1, sp1SigningKeys)
  const sp2UsedSigningKeys = await stakingProvidersHelper.getActiveSigningKeys(sp2, sp2SigningKeys)
  const sp3UsedSigningKeys = await stakingProvidersHelper.getActiveSigningKeys(sp3, sp3SigningKeys)
  const spsUsedSigningKeys = sp1UsedSigningKeys.concat(sp2UsedSigningKeys, sp3UsedSigningKeys)
  t.true(eth2Helper.isValidatorsStarted(spsUsedSigningKeys), 'Check that validators have been activated with added signing keys')

  logger.info('Check that the network is producing and finalizing blocks')
  t.true(await eth2Helper.isEth2NetworkProducingSlots())

  // // logger.info('Waiting for the validator to receive a reward')
  // // TODO check validators data
  // // await waitFor(20000)

  logger.info('Push data to eth1')
  let oracleData = ETH(600)
  const dePoolUsedEther = await dePoolHelper.getUsedEther()
  let stakeProfit = +oracleData - +dePoolUsedEther
  let validatorsReward = stakeProfit
  let totalUsedSigningKeys = await stakingProvidersHelper.getTotalActiveKeysCount()
  let sp1BalanceBeforePushData = await stEthHelper.getBalance(spsMember1)
  let sp2BalanceBeforePushData = await stEthHelper.getBalance(spsMember2)
  let sp3BalanceBeforePushData = await stEthHelper.getBalance(spsMember3)
  let treasuryBalanceBeforePushData = await stEthHelper.getBalance(await dePoolHelper.getTreasuryAddress())
  let insuranceFundBalanceBeforePushData = await stEthHelper.getBalance(await dePoolHelper.getInsuranceFundAddress())
  await dePoolOracleHelper.pushData(400, oracleData, oracleMember1)
  await dePoolOracleHelper.pushData(400, oracleData, oracleMember2)
  await dePoolOracleHelper.pushData(400, oracleData, oracleMember3)
  let latestData = await dePoolOracleHelper.getLatestData()
  t.is(latestData.eth2balance, oracleData, 'Check that the oracle eth2 balance has been changed')
  t.is(latestData.reportInterval, '400', 'Check that the oracle report interval has been changed')
  t.is(
    await stEthHelper.getBalance(spsMember1),
    stakingProvidersHelper.calculateNewSpBalance(sp1, stakeProfit, totalUsedSigningKeys, sp1BalanceBeforePushData),
    'Check that sp1 receive an appropriate amount of reward tokens'
  )
  t.is(
    await stEthHelper.getBalance(spsMember2),
    stakingProvidersHelper.calculateNewSpBalance(sp2, stakeProfit, totalUsedSigningKeys, sp2BalanceBeforePushData),
    'Check that sp2 receive an appropriate amount of reward tokens'
  )
  t.is(
    await stEthHelper.getBalance(spsMember3),
    stakingProvidersHelper.calculateNewSpBalance(sp3, stakeProfit, totalUsedSigningKeys, sp3BalanceBeforePushData),
    'Check that sp3 receive an appropriate amount of reward tokens'
  )
  t.is(
    await stEthHelper.getBalance(await dePoolHelper.getTreasuryAddress()),
    dePoolHelper.calculateNewTreasuryBalance(stakeProfit, treasuryBalanceBeforePushData),
    'Check that the treasury receive appropriate amount of tokens by validators rewards'
  )
  t.is(
    await stEthHelper.getBalance(await dePoolHelper.getInsuranceFundAddress()),
    dePoolHelper.calculateNewTreasuryBalance(stakeProfit, insuranceFundBalanceBeforePushData),
    'Check that the insurance fund receive appropriate amount of tokens by validators rewards'
  )

  // TODO Broad strokes:
  // ctoken stay the same but is convertable to a right amount of atoken,
  // and fees are paid in right amount to the right validators

  // TODO Report slashing, check that there is no reward and atoken balance decreases and ctoken stay the same

  logger.info('Change withdrawal credentials')
  t.is(await stakingProvidersHelper.getUnusedSigningKeyCount(0), '0')
  t.is(await stakingProvidersHelper.getUnusedSigningKeyCount(1), '0')
  t.is(await stakingProvidersHelper.getUnusedSigningKeyCount(2), '10')
  withdrawalAddress = getGeneratedWithdrawalAddress('validators2')
  await dePoolHelper.setWithdrawalCredentials(withdrawalAddress, holder1, quorumHolders)
  t.is(await dePoolHelper.getWithdrawalCredentials(), withdrawalAddress, 'Check that withdrawal credentials were set correctly')

  logger.info('Check that unused signing keys removed from sps after change withdrawal credentials')
  sp1 = await stakingProvidersHelper.getStakingProvider(0, true)
  sp2 = await stakingProvidersHelper.getStakingProvider(1, true)
  sp3 = await stakingProvidersHelper.getStakingProvider(2, true)
  t.is(await stakingProvidersHelper.getUnusedSigningKeyCount(0), '0', 'sp1 unused keys were removed after change withdrawal credentials')
  t.is(await stakingProvidersHelper.getUnusedSigningKeyCount(1), '0', 'sp2 unused keys were removed after change withdrawal credentials')
  t.is(await stakingProvidersHelper.getUnusedSigningKeyCount(2), '0', 'sp3 unused keys were removed after change withdrawal credentials')
  t.is(sp1.totalSigningKeys, sp1.usedSigningKeys)
  t.is(sp2.totalSigningKeys, sp2.usedSigningKeys)
  t.is(sp3.totalSigningKeys, sp3.usedSigningKeys)

  logger.info('Set full sp permissions to sp4')
  await aclHelper.setPermissions([spsMember4], spsFullPermissions, stakingProvidersHelper.getProxyAddress(), holder1, quorumHolders)
  t.true(await aclHelper.hasPermissions([spsMember4], stakingProvidersHelper.getProxyAddress(), spsFullPermissions))

  logger.info('Add sp4 and add signing keys')
  await stakingProvidersHelper.addStakingProvider('test provider4', spsMember4, UNLIMITED_STAKING_LIMIT, holder1, quorumHolders)
  let validatorsTestDataForSp4 = getSigningKeys('validators2', 40, 0)
  await stakingProvidersHelper.addSigningKeysSP(3, validatorsTestDataForSp4, spsMember4)

  logger.info('Check the correctness of sp4')
  let sp4 = await stakingProvidersHelper.getStakingProvider(3, true)
  t.is(sp4.active, true, 'Check that the sp4 is active')
  t.is(sp4.name, 'test provider4', 'Check that the sp4 name is correct')
  t.is(sp4.rewardAddress, spsMember4, 'Check that the sp4 is correct ')
  t.is(sp4.stakingLimit, String(UNLIMITED_STAKING_LIMIT), 'Check that the sp4 stakingLimit is correct')
  t.is(sp4.totalSigningKeys, '40')
  t.is(sp4.usedSigningKeys, '0')
  const sp4SigningKeys = await stakingProvidersHelper.getAllSigningKeys(sp4, 3)
  validatorsTestDataForSp4 = concat0x(validatorsTestDataForSp4)
  t.deepEqual(sp4SigningKeys.pubKeys, validatorsTestDataForSp4.pubKeys, 'Check that sp4 signing pubKeys set correct')
  t.deepEqual(sp4SigningKeys.signatures, validatorsTestDataForSp4.signatures, 'Check that sp4 signatures were set correct')

  logger.info('Change sp4 name and rewardAddress')
  // await stakingProvidersHelper.setStakingProviderName(3, 'newName', spsMember4)
  await stakingProvidersHelper.setStakingProviderRewardAddress(3, spsMember5, spsMember4)
  sp4 = await stakingProvidersHelper.getStakingProvider(3, true)
  // t.is(sp4.name,'newName','Check the correctness of change sp4 name')
  t.is(sp4.rewardAddress, spsMember5, 'Check the correctness of change sp4 rewardAddress')

  logger.info('Check deposit iteration limit')
  const user5Deposit = ETH(20 * 32)
  await dePoolHelper.depositToDePoolContract(user5, user5Deposit)
  ether2Stat = await dePoolHelper.getBeaconStat()
  t.is(await stEthHelper.getBalance(user5), user5Deposit, 'Check that user receive an appropriate amount of stEth tokens')
  t.is(
    await dePoolHelper.getBufferedEther(),
    (+ETH(20 * 32) - +ETH(16 * 32)).toString(),
    'Check that the rest of the deposited Ether is still buffered in the dePool due to iteration limit '
  )
  // When oracle`s push data was submitted at the first time,
  // the total  total controlled ether is changing after next oracle pushData,
  // but buffered ether is displaying in total pooled ether
  t.is(
    await dePoolHelper.getTotalPooledEther(),
    BN(oracleData)
      .add(BN(ETH(4 * 32)))
      .toString(),
    'Check that the total pooled ether in dePool is correct'
  )
  t.is(
    ether2Stat.depositedValidators,
    BN(usersDeposits)
      .add(BN(ETH(16 * 32)))
      .toString()
  )

  logger.info('Check that the rest of buffered Ether in the pool can be submitted')
  await dePoolHelper.submit(user5, ETH(0))
  sp4 = await stakingProvidersHelper.getStakingProvider(3, true)
  ether2Stat = await dePoolHelper.getBeaconStat()
  usersDeposits = BN(usersDeposits).add(BN(user5Deposit))
  t.is(await dePoolHelper.getBufferedEther(), '0', 'Check that the rest of buffered Ether became became active')
  t.is(sp4.usedSigningKeys, '20', 'sps4 signing keys became using')
  t.is(await stakingProvidersHelper.getUnusedSigningKeyCount(3), '20', 'Check unused sp4 keys')
  t.is(ether2Stat.depositedValidators, usersDeposits.toString(), 'Check that the Ether was deposited after submit buffered ether')

  logger.info('Wait for validators activation')
  await waitFor(150)

  logger.info('Check that the validators have been activated')
  const sp4UsedSigningKeys = await stakingProvidersHelper.getActiveSigningKeys(sp4, sp4SigningKeys)
  t.true(eth2Helper.isValidatorsStarted(sp4UsedSigningKeys), 'Check validators activation')

  logger.info('Deactivate sp4 with currently using signing keys')
  await stakingProvidersHelper.setStakingProviderActive(3, false, spsMember4)
  sp4 = await stakingProvidersHelper.getStakingProvider(3, true)
  t.is(sp4.active, false, 'Check that the sp4 has been deactivated')
  t.is(
    await stakingProvidersHelper.getActiveStakingProvidersCount(),
    '3',
    'Check that the count of active providers is changed after deactivate one'
  )

  logger.info('Push data and check that the deactivated provider balance not changed')
  oracleData = ETH(2000)
  ether2Stat = await dePoolHelper.getBeaconStat()
  stakeProfit = BN(oracleData).sub(BN(ether2Stat.depositedValidators)).sub(BN(validatorsReward)).toString()
  validatorsReward = stakeProfit
  totalUsedSigningKeys = await stakingProvidersHelper.getTotalActiveKeysCount()
  sp1BalanceBeforePushData = await stEthHelper.getBalance(spsMember1)
  sp2BalanceBeforePushData = await stEthHelper.getBalance(spsMember2)
  sp3BalanceBeforePushData = await stEthHelper.getBalance(spsMember3)
  const sp4BalanceBeforePushData = await stEthHelper.getBalance(spsMember4)
  treasuryBalanceBeforePushData = await stEthHelper.getBalance(await dePoolHelper.getTreasuryAddress())
  insuranceFundBalanceBeforePushData = await stEthHelper.getBalance(await dePoolHelper.getInsuranceFundAddress())
  await dePoolOracleHelper.pushData(2500, oracleData, oracleMember1)
  await dePoolOracleHelper.pushData(2500, oracleData, oracleMember2)
  await dePoolOracleHelper.pushData(2500, oracleData, oracleMember3)
  latestData = await dePoolOracleHelper.getLatestData()
  t.is(latestData.eth2balance, oracleData, 'Check that the oracle eth2 balance has been changed')
  t.is(latestData.reportInterval, '2500', 'Check that the oracle report interval has been changed')

  logger.info('Check that the rewards have been split between sp1,sp2,sp3 due to sp4 was deactivated')
  t.is(
    await stEthHelper.getBalance(spsMember1),
    stakingProvidersHelper.calculateNewSpBalance(sp1, stakeProfit, totalUsedSigningKeys, sp1BalanceBeforePushData),
    'Check that sp1 receive an appropriate amount of reward tokens'
  )
  t.is(
    await stEthHelper.getBalance(spsMember2),
    stakingProvidersHelper.calculateNewSpBalance(sp2, stakeProfit, totalUsedSigningKeys, sp2BalanceBeforePushData),
    'Check that sp2 receive an appropriate amount of reward tokens'
  )
  t.is(
    await stEthHelper.getBalance(spsMember3),
    stakingProvidersHelper.calculateNewSpBalance(sp3, stakeProfit, totalUsedSigningKeys, sp3BalanceBeforePushData),
    'Check that sp3 receive an appropriate amount of reward tokens'
  )
  t.is(sp4BalanceBeforePushData, await stEthHelper.getBalance(spsMember4), 'Check that sp4 don`t received reward due to deactivated')
  t.is(
    await stEthHelper.getBalance(await dePoolHelper.getTreasuryAddress()),
    dePoolHelper.calculateNewTreasuryBalance(stakeProfit, treasuryBalanceBeforePushData),
    'Check that the treasury receive appropriate amount of tokens by validators rewards'
  )
  t.is(
    await stEthHelper.getBalance(await dePoolHelper.getInsuranceFundAddress()),
    dePoolHelper.calculateNewTreasuryBalance(stakeProfit, insuranceFundBalanceBeforePushData),
    'Check that the insurance fund receive appropriate amount of tokens by validators rewards'
  )

  logger.info('Increase staking limit for sp4')
  await stakingProvidersHelper.setStakingProviderStakingLimit(3, 50, spsMember4)
  sp4 = await stakingProvidersHelper.getStakingProvider(3, true)
  t.is(sp4.stakingLimit, '50', 'Check that the sp4 staking limit increased correctly')

  logger.info('Reduce the staking limit for sp4')
  await stakingProvidersHelper.setStakingProviderStakingLimit(3, +sp4.usedSigningKeys, spsMember4)
  sp4 = await stakingProvidersHelper.getStakingProvider(3, true)
  t.is(sp4.stakingLimit, sp4.usedSigningKeys, 'Check that the sp4 staking limit reduced correctly')

  logger.info('Check that the validators do not activate if there are no unused signing keys')
  withdrawalAddress = getGeneratedWithdrawalAddress('validators1')
  await dePoolHelper.setWithdrawalCredentials(withdrawalAddress, holder1, quorumHolders)
  sp1 = await stakingProvidersHelper.getStakingProvider(0, true)
  sp2 = await stakingProvidersHelper.getStakingProvider(1, true)
  sp3 = await stakingProvidersHelper.getStakingProvider(2, true)
  sp4 = await stakingProvidersHelper.getStakingProvider(3, true)
  t.is(await stakingProvidersHelper.getUnusedSigningKeyCount(0), '0', 'sp1 unused keys were removed after change withdrawal credentials')
  t.is(await stakingProvidersHelper.getUnusedSigningKeyCount(1), '0', 'sp2 unused keys were removed after change withdrawal credentials')
  t.is(await stakingProvidersHelper.getUnusedSigningKeyCount(2), '0', 'sp3 unused keys were removed after change withdrawal credentials')
  t.is(sp1.totalSigningKeys, sp1.usedSigningKeys)
  t.is(sp2.totalSigningKeys, sp2.usedSigningKeys)
  t.is(sp3.totalSigningKeys, sp3.usedSigningKeys)
  t.is(sp4.totalSigningKeys, sp4.usedSigningKeys)

  logger.info('Check that the validators do not activate if there are no unused signing keys')
  await dePoolHelper.depositToDePoolContract(user2, ETH(64))
  ether2Stat = await dePoolHelper.getBeaconStat()
  t.is(ether2Stat.depositedValidators, usersDeposits.toString(), 'Check that the deposit not performed')
  t.is(await dePoolHelper.getBufferedEther(), ETH(64), 'Check that the deposited Ether is buffered due to no unused keys')

  // TODO Test insurance (pending for the actual insurance)
  t.pass()
})
