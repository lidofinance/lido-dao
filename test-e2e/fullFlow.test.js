import test from 'ava'

import { prepareContext } from './test-helpers/index'
import { getGeneratedWithdrawalAddress, ETH, getSigningKeys, getTestWithdrawalAddress, sleep as waitFor } from './test-helpers/utils'

import * as dePool from './test-helpers/apps/depoolHelper'
import * as eth2Helper from './test-helpers/eth2/Eth2Helper'
import * as stEthHelper from './test-helpers/apps/stEthHelper'
// import { init as initVote, voteForAction } from './test-helpers/apps/votingHelper'
import * as dePoolOracleHelper from './test-helpers/apps/dePoolOracleHelper'

test.before('Connecting Web3', async (t) => {
  t.context = await prepareContext()
  dePool.init(t.context)
  // initVote(t.context)
  stEthHelper.init(t.context)
  dePoolOracleHelper.init(t.context)
})

test('Full flow test ', async (t) => {
  const { logger, accounts } = t.context
  const [holder1, holder2, holder3, holder4, holder5, holder6, oracleMember] = accounts
  const holders = [holder1, holder2, holder3]

  // logger.info('Add oracle member')
  // const votingId = await dePoolOracleHelper.createVoteToAddOracleMember(oracleMember, holder6, holders)
  // await voteForAction(votingId, holders)
  // t.is(dePoolOracleHelper.getOracleMember(holder6))

  logger.info('Set WithdrawalCredentials')
  const withdrawalAddress = getTestWithdrawalAddress()
  await dePool.setWithdrawalCredentials(withdrawalAddress, holder1, holders)
  t.is(await dePool.getWithdrawalCredentials(), withdrawalAddress, 'Check set withdrawal credentials ')

  // const depool = initDepoolObject()
  // console.log('DADA?' + depool.getWithdrawalCredentials())

  logger.info('Add signing Keys')
  const validatorsTestData = getSigningKeys(1, 0)
  await dePool.addSigningKeys(validatorsTestData, holder1, 1, holders)
  const addedPubKey = await dePool.getSigningKey(0)
  t.is(addedPubKey.key, validatorsTestData.pubKey, 'Check set signing keys')
  t.is(await dePool.getTotalSigningKeys(), '1', 'Check total signing keys')
  t.is(await dePool.getUnusedSigningKeyCount(), '1', 'Check unused signing keys')

  logger.info('Put 32 ETH to dePool contract')
  const value = ETH(32)
  await dePool.putEthToDePoolContract(holder6, value)
  const tokenHolderBalance = await stEthHelper.getBalance(holder6)
  t.is(await dePool.getBufferedEther(), value, 'Buffered ether in dePool')
  t.is(await dePool.getTotalControlledEther(), value, 'Total controlled ether in dePool')

  t.is(tokenHolderBalance, value, 'Check that recieve an appropriate amount of stEth tokens')
  t.is(await stEthHelper.getTotalSupply(), value, 'Current token total supply')

  await waitFor(10000)

  // Verify that the validator is started
  t.true(eth2Helper.isValidatorStarted(addedPubKey.key), 'Validator with added signing keys started')
  const validatorBalanceBeforeSleep = eth2Helper.getValidatorBalance(addedPubKey)

  await waitFor(10000)

  // Verify that the Withdrawal address balance is >32eth
  const withdrawalAddressBalanceAfterSleep = eth2Helper.getValidatorBalance(addedPubKey)
  t.true(withdrawalAddressBalanceAfterSleep > ETH(32), 'Check that the withdrawal address balance is >32eth')
  // t.not(validatorBalanceBeforeSleep, withdrawalAddressBalanceAfterSleep, '')
  dePoolOracleHelper.pushData(await dePoolOracleHelper.getCurrentReportInterval(), 100, oracleMember)
  // Verify that the tokenHolder recieve reward
  t.not(tokenHolderBalance, await stEthHelper.getBalance(holder6), 'Verify that the tokenHolder recieve reward')
})
