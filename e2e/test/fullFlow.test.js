import test from 'ava'

import { prepareContext } from './test-helpers'
import { expectEvent } from '@openzeppelin/test-helpers'
import {
  ETH,
  getSigningKeys,
  sleep as waitFor,
  getGeneratedWithdrawalAddress,
  concat0x,
  getDataToPerformDepositContract
} from './test-helpers/utils'

import * as aclHelper from './test-helpers/apps/aclHelper'
import * as dePoolHelper from './test-helpers/apps/depoolHelper'
import * as eth2Helper from './test-helpers/eth2/Eth2Helper'
import * as stEthHelper from './test-helpers/apps/stEthHelper'
import * as votingHelper from './test-helpers/apps/votingHelper'
import * as dePoolOracleHelper from './test-helpers/apps/dePoolOracleHelper'
import * as stakingProvidersHelper from './test-helpers/apps/stakingProviderHelper'
import * as vaultHelper from './test-helpers/apps/vaultHelper'
import * as tokenManagerHelper from './test-helpers/apps/tokenManagerHelper'
import * as depositContractHelper from './test-helpers/apps/depositContractHelper'
import {
  oracleAccounts as oracleMembers,
  spsAccounts as spsMembers,
  simpleAccounts as users,
  UNLIMITED_STAKING_LIMIT
} from './test-helpers/constants'
import { getActiveSigningKeys } from './test-helpers/apps/stakingProviderHelper'

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
  const [spsMember1, spsMember2, spsMember3, spsMember4] = spsMembers
  const [oracleMember1, oracleMember2, oracleMember3, oracleMember4, oracleMember5] = oracleMembers
  const [user1, user2, user3, user4, user5] = users

  //TODO wrap

  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 5; j++) {
      const receipt = await web3.eth.sendTransaction({
        from: accounts[i],
        to: accounts[i * 5 + 10 + j],
        value: web3.utils.toWei('1000', 'ether')
      })
      console.log(`1000ETH from ${accounts[i]} (${i}) to ${accounts[i * 5 + 10 + j]} (${i * 5 + 10 + j})}`)
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
  await dePoolOracleHelper.addOracleMembers(quorumHolders, holder1, quorumHolders)
  const addedOracleMembers = await dePoolOracleHelper.getAllOracleMembers()
  t.true(JSON.stringify(addedOracleMembers) === JSON.stringify(quorumHolders), 'Check is oracle members were  set')

  logger.info('Set quorum')
  await dePoolOracleHelper.setQuorum(3, holder1, quorumHolders)
  t.is(await dePoolOracleHelper.getQuorum(), '3', 'Check that the quorum was set correctly')

  logger.info('Set withdrawal credentials')
  const withdrawalAddress = getGeneratedWithdrawalAddress()
  await dePoolHelper.setWithdrawalCredentials(withdrawalAddress, holder1, quorumHolders)
  t.is(await dePoolHelper.getWithdrawalCredentials(), withdrawalAddress, 'Check that withdrawal credentials were set correctly')

  logger.info('Set fees')
  // 100% = 10000
  await dePoolHelper.setFee(10000, holder1, quorumHolders)
  t.is(await dePoolHelper.getFee(), '10000', 'Check that fee was set correctly')

  // 100% = 10000
  await dePoolHelper.setFeeDistribution(1000, 1000, 8000, holder1, quorumHolders)
  const result = await dePoolHelper.getFeeDistribution()
  t.is(result[0], '1000', 'Check that fee was set correctly')
  t.is(result[1], '1000', 'Check that fee was set correctly')
  t.is(result[2], '8000', 'Check that fee was set correctly')

  await stakingProvidersHelper.addStakingProvider('test provider1', spsMember1, 2, holder1, quorumHolders)
  let validatorsTestDataForSp1 = getSigningKeys(2, 0)
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
  t.true(
    JSON.stringify(sp1SigningKeys.pubKeys) === JSON.stringify(validatorsTestDataForSp1.pubKeys),
    'Check that sp1 signing pubKeys set correct'
  )
  t.true(
    JSON.stringify(sp1SigningKeys.signatures) === JSON.stringify(validatorsTestDataForSp1.signatures),
    'Check that sp1 signatures were set correct'
  )

  logger.info('Add sp2 and add signing keys')
  await stakingProvidersHelper.addStakingProvider('test provider2', spsMember2, 10, holder1, quorumHolders)
  let validatorsTestDataForSp2 = getSigningKeys(6, 2)
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
  t.true(
    JSON.stringify(sp2SigningKeys.pubKeys) === JSON.stringify(validatorsTestDataForSp2.pubKeys),
    'Check that sp2 signing pubKeys set correct'
  )
  t.true(
    JSON.stringify(sp2SigningKeys.signatures) === JSON.stringify(validatorsTestDataForSp2.signatures),
    'Check that sp2 signatures were set correct'
  )

  logger.info('Add sp3 and add signing keys')
  await stakingProvidersHelper.addStakingProvider('test provider3', spsMember3, UNLIMITED_STAKING_LIMIT, holder1, quorumHolders)
  let validatorsTestDataForSp3 = getSigningKeys(20, 8)
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
  t.true(
    JSON.stringify(sp3SigningKeys.pubKeys) === JSON.stringify(validatorsTestDataForSp3.pubKeys),
    'Check that sp3 signing pubKeys set correct'
  )
  t.true(
    JSON.stringify(sp3SigningKeys.signatures) === JSON.stringify(validatorsTestDataForSp3.signatures),
    'Check that sp3 signatures were set correct'
  )

  logger.info('Deposit 2 ETH to DePool via DePool from user1')
  await dePoolHelper.depositToDePoolContract(user1, ETH(2))
  let user1Deposit = ETH(2)
  t.is(await stEthHelper.getBalance(user1), ETH(2), 'Check that user receive an appropriate amount of stEth tokens')
  t.is(await dePoolHelper.getBufferedEther(), ETH(2), 'Buffered ether in dePool')
  t.is(await dePoolHelper.getTotalControlledEther(), ETH(2), 'Total controlled ether in dePool')

  logger.info('Deposit 30 ETH to DePool via DePool from user1')
  await dePoolHelper.depositToDePoolContract(user1, ETH(30))
  user1Deposit = (+user1Deposit + +ETH(30)).toString()
  t.is(await stEthHelper.getBalance(user1), user1Deposit, 'Check that user receive an appropriate amount of stEth tokens')
  t.is(await dePoolHelper.getBufferedEther(), '0', 'Buffered ether in dePool')
  t.is(await dePoolHelper.getTotalControlledEther(), ETH(32), 'Total controlled ether in dePool')

  logger.info('Deposit 2 ETH to DePool via DePool from user2')
  await dePoolHelper.depositToDePoolContract(user2, ETH(2))
  let user2Deposit = ETH(2)
  t.is(await stEthHelper.getBalance(user2), ETH(2), 'Check that user receive an appropriate amount of stEth tokens')
  t.is(await dePoolHelper.getBufferedEther(), ETH(2), 'Buffered ether in dePool')
  t.is(await dePoolHelper.getTotalControlledEther(), ETH(34), 'Total controlled ether in dePool')

  logger.info('Deposit 32 ETH to DePool via DePool  from user2')
  user2Deposit = (+user2Deposit + +ETH(32)).toString()
  await dePoolHelper.depositToDePoolContract(user2, ETH(32))
  t.is(await stEthHelper.getBalance(user2), user2Deposit, 'Check that user receive an appropriate amount of stEth tokens')
  t.is(await dePoolHelper.getBufferedEther(), ETH(2), 'Buffered ether in dePool')
  t.is(await dePoolHelper.getTotalControlledEther(), ETH(66), 'Total controlled ether in dePool')

  logger.info('Deposit 222 ETH to dePool via DePool from user3')
  await dePoolHelper.depositToDePoolContract(user3, ETH(222))
  let user3Deposit = ETH(222)
  t.is(await stEthHelper.getBalance(user3), user3Deposit, 'Check that user receive an appropriate amount of stEth tokens')
  t.is(await dePoolHelper.getBufferedEther(), '0', 'Buffered ether in dePool')
  t.is(await dePoolHelper.getTotalControlledEther(), ETH(288), 'Total controlled ether in dePool')

  logger.info('Deposit 32 ETH to DePool via deposit contract from user4')
  const depositData = getDataToPerformDepositContract()
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
  t.is(await stEthHelper.getBalance(user3), user3Deposit, 'Check that user receive an appropriate amount of stEth tokens')
  t.is(await dePoolHelper.getBufferedEther(), '0', 'Buffered ether in dePool')
  t.is(await dePoolHelper.getTotalControlledEther(), ETH(576), 'Total controlled ether in dePool')

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

  // logger.info('Wait for validators activation')
  // await waitFor(150)

  // logger.info('Check that the validators have been activated')
  // const sp1UsedSigningKeys = await getActiveSigningKeys(sp1, sp1SigningKeys)
  // const sp2UsedSigningKeys = await getActiveSigningKeys(sp2, sp2SigningKeys)
  // const sp3UsedSigningKeys = await getActiveSigningKeys(sp3, sp3SigningKeys)
  // const spsUsedSigningKeys = sp1UsedSigningKeys.concat(sp2UsedSigningKeys, sp3UsedSigningKeys)
  // t.true(eth2Helper.isValidatorsStarted(spsUsedSigningKeys), 'Check that validators have been activated with added signing keys')

  // TODO change api
  // logger.info('Check that the network is producing and finalizing blocks')
  // t.true(await eth2Helper.isEth2NetworkProducingSlots())
  // //
  // // logger.info('Waiting for the validator to receive a reward')
  // // TODO check validators data
  // // await waitFor(20000)

  logger.info('Push data to eth1')
  const oracleData = ETH(600)
  const period = 400
  console.log('ORACLE DATA', oracleData)
  console.log(await dePoolOracleHelper.pushData(period, oracleData, holder1))
  console.log(await dePoolOracleHelper.pushData(period, oracleData, holder2))
  console.log(await dePoolOracleHelper.pushData(period, oracleData, holder3))
  console.log(await dePoolOracleHelper.getQuorum())
  console.log(await stEthHelper.getBalance(spsMember1))
  console.log(await stEthHelper.getBalance(spsMember2))
  console.log(await stEthHelper.getBalance(spsMember3))
  console.log(await stEthHelper.getBalance(await dePoolHelper.getTreasury()))
  // t.is(await stEthHelper.getBalance(sps1Member), (((user1Deposit * 100) / stEthHelper.getTotalSupply()) * oracleData) / 100 * 0.9, "Check that sp1 receive an appropriate amount of reward tokens")
  // t.is(await stEthHelper.getBalance(sps2Member), (((user2Deposit * 100) / stEthHelper.getTotalSupply()) * oracleData) / 100 * 0.9, "Check that sp2 receive an appropriate amount of reward tokens")
  // t.is(await stEthHelper.getBalance(sps3Member), (((user3Deposit * 100) / stEthHelper.getTotalSupply()) * oracleData) / 100 * 0.9, "Check that sp3 receive an appropriate amount of reward tokens")
  // t.is(
  //   await stEthHelper.getBalance(await dePoolHelper.getTreasury()),
  //   +oracleData * 0.1,
  //   'Check that the treasury receive appropriate amount of default tokens by validators rewards'
  // )

  // TODO Broad strokes:
  // Report profit,
  // ctoken stay the same but is convertable to a right amount of atoken,
  // and fees are paid in right amount to the right validators

  // TODO Report slashing, check that there is no reward and atoken balance decreases and ctoken stay the same

  // TODO Manipulate staking providers and check that it has right
  // results: add a new staking provider, deactivate one, reduce the staking limit for an SP, increase it
  // logger.info('Add sp4 and add signing keys')
  // await stakingProvidersHelper.addStakingProvider('test provider4', spsMember4, UNLIMITED_STAKING_LIMIT, holder1, quorumHolders)
  // let validatorsTestDataForSp4 = getSigningKeys(100, 28)
  // await stakingProvidersHelper.addSigningKeysSP(3, validatorsTestDataForSp4, spsMember4)
  //
  // logger.info('Check the correctness of sp4')
  // const sp4 = await stakingProvidersHelper.getStakingProvider(3, true)
  // t.is(sp4.active, true, 'Check that the sp4 is active')
  // t.is(sp4.name, 'test provider4', 'Check that the sp4 name is correct')
  // t.is(sp4.rewardAddress, spsMember4, 'Check that the sp4 is correct ')
  // t.is(sp4.stakingLimit, String(UNLIMITED_STAKING_LIMIT), 'Check that the sp4 stakingLimit is correct')
  // t.is(sp4.totalSigningKeys, '100')
  // t.is(sp4.usedSigningKeys, '0')
  // const sp4SigningKeys = await stakingProvidersHelper.getAllSigningKeys(sp4, 3)
  // validatorsTestDataForSp4 = concat0x(validatorsTestDataForSp4)
  // t.true(
  //   JSON.stringify(sp4SigningKeys.pubKeys) === JSON.stringify(validatorsTestDataForSp4.pubKeys),
  //   'Check that sp4 signing pubKeys set correct'
  // )
  // t.true(
  //   JSON.stringify(sp4SigningKeys.signatures) === JSON.stringify(validatorsTestDataForSp4.signatures),
  //   'Check that sp4 signatures were set correct'
  // )
  //
  // // Deactivate provider
  // await stakingProviderHelper.setStakingProviderActive(4, false, 'Check that the sp4 can be deactivated')
  // t.is(sp4.active, false, 'Check that the sp4 became deactivated')
  // t.is(
  //   stakingProviderHelper.getActiveStakingProvidersCount(),
  //   3,
  //   'Check that the count of active providers is changed after deactivate one'
  // )
  //
  // // TODO deactivate provider with currently using signing keys and check it
  //
  // // Reduce the staking limit for an SP
  // let oldsp4StakingLimit = sp4.stakingLimit() // UNLIMITED
  // let newSp4StakingLimit = 200
  // await stakingProviderHelper.setStakingProviderStakingLimit(3, newSp4StakingLimit)
  // t.is(oldsp4StakingLimit - newSp4StakingLimit, 999999800, 'Check that the sp4 staking limit decrease correctly')
  //
  // // Increase the staking limit for an SP
  // oldsp4StakingLimit = sp4.stakingLimit() // 200
  // newSp4StakingLimit = 400
  // await stakingProviderHelper.setStakingProviderStakingLimit(3, 200)
  // t.is(newSp4StakingLimit - oldsp4StakingLimit, 200, 200, 'Check that the sp4 staking limit increase correctly')

  // TODO Test insurance (pending for the actual insurance)
  t.pass()
})
