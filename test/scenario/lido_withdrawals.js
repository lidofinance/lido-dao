const { assert } = require('chai')
const { assertEvent, assertRevert, assertBn } = require('@aragon/contract-helpers-test/src/asserts')

const { web3 } = require('hardhat')
const { pad, hexConcat, StETH, ETH } = require('../helpers/utils')
const { deployDaoAndPool } = require('./helpers/deploy')
const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

const WithdrawalQueue = artifacts.require('WithdrawalQueue.sol')

contract('Lido: withdrawals', (addresses) => {
  const [
    // the root account which deployed the DAO
    appManager,
    // the address which we use to simulate the voting DAO application
    voting,
    // address that withdaws ether from the pool
    recipient
  ] = addresses

  let pool, token
  let oracle
  let withdrawalCredentials, withdrawalQueue

  before('DAO deployed', async () => {
    const deployed = await deployDaoAndPool(appManager, voting)

    // contracts/StETH.sol
    token = deployed.pool

    // contracts/Lido.sol
    pool = deployed.pool
    await pool.resumeProtocolAndStaking()

    // mocks
    oracle = deployed.oracleMock
    // unlock oracle account (allow transactions originated from oracle.address)
    await ethers.provider.send('hardhat_impersonateAccount', [oracle.address])

    withdrawalQueue = await WithdrawalQueue.new(pool.address)
    withdrawalCredentials = hexConcat('0x01', pad(withdrawalQueue.address, 31)).toLowerCase()

    await web3.eth.sendTransaction({ to: pool.address, from: recipient, value: ETH(3) })
  })

  it('setWithdrawalCredentials', async () => {
    assert.equal(await pool.getWithdrawalVaultAddress(), ZERO_ADDRESS)
    assertRevert(pool.requestWithdrawal(StETH(3), { from: recipient }), 'ZERO_WITHDRAWAL_ADDRESS')
    assertRevert(pool.claimWithdrawal(0), 'ZERO_WITHDRAWAL_ADDRESS')

    await pool.setWithdrawalCredentials(withdrawalCredentials, { from: voting })
    assert.equal(await pool.getWithdrawalCredentials(), withdrawalCredentials)
    assert.equal(await pool.getWithdrawalVaultAddress(), withdrawalQueue.address)
  })

  context('requestWithdrawal', async () => {
    const amount = StETH(1)

    it('put one request', async () => {
      const receipt = await pool.requestWithdrawal(amount, { from: recipient })

      const id = (await withdrawalQueue.queueLength()) - 1

      assertEvent(receipt, 'WithdrawalRequested', {
        expectedArgs: {
          recipient: recipient,
          ethAmount: amount,
          sharesAmount: await pool.getSharesByPooledEth(amount),
          requestId: id
        }
      })

      const status = await pool.withdrawalRequestStatus(id)

      assert.equal(status.recipient, recipient)
      assert.equal(status.isClaimed, false)
      assert.equal(status.isFinalized, false)
      assertBn(status.etherToWithdraw, amount)
    })

    it('cant claim no-finalized', async () => {
      assertRevert(pool.claimWithdrawal(0), 'REQUEST_NOT_FINALIZED')
    })

    it('another two requests', async () => {
      await Promise.all([pool.requestWithdrawal(amount, { from: recipient }), pool.requestWithdrawal(amount, { from: recipient })])

      assert.equal(await withdrawalQueue.queueLength(), 3)

      const [one, two, three] = await Promise.all([
        await pool.withdrawalRequestStatus(0),
        await pool.withdrawalRequestStatus(1),
        await pool.withdrawalRequestStatus(2)
      ])

      assert.ok(one.requestBlockNumber < two.requestBlockNumber)
      assert.ok(two.requestBlockNumber < three.requestBlockNumber)
    })
  })

  context('handleOracleReport', async () => {
    it('auth', async () => {
      assertRevert(pool.handleOracleReport(0, 0, 0, 0, 0, [], [], []), 'APP_AUTH_FAILED')
    })

    it('zero report', async () => {
      await pool.handleOracleReport(0, 0, 0, 0, 0, [], [], [], { from: oracle.address })
    })
  })
})
