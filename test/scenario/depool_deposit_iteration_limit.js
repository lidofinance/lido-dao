const { assertBn, assertRevert } = require('@aragon/contract-helpers-test/src/asserts')
const { getEvents, getEventArgument, ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

const { pad, ETH, hexConcat } = require('../helpers/utils')
const { deployDaoAndPool } = require('./helpers/deploy')

contract('DePool: deposit loop iteration limit', (addresses) => {
  const [
    // the root account which deployed the DAO
    appManager,
    // the address which we use to simulate the voting DAO application
    voting,
    // staking providers
    stakingProvider,
    // users who deposit Ether to the pool
    user1,
    user2,
    // an unrelated address
    nobody
  ] = addresses

  // Limits the number of validators registered in a single transaction, regardless the amount
  // of Ether submitted to/buffered in the contract and the number of spare validator keys.
  // This is needed to prevent the deposit loop from failing due to it using more gas than
  // available in a single block and to protect from possible attacks exploiting this.
  const depositIterationLimit = 5

  let pool, spRegistry, validatorRegistrationMock

  it('DAO, staking providers registry, token, and pool are deployed and initialized', async () => {
    const deployed = await deployDaoAndPool(appManager, voting, depositIterationLimit)

    // contracts/DePool.sol
    pool = deployed.pool

    // contracts/sps/StakingProvidersRegistry.sol
    spRegistry = deployed.spRegistry

    // mocks
    validatorRegistrationMock = deployed.validatorRegistrationMock

    await pool.setFee(0.01 * 10000, { from: voting })
    await pool.setFeeDistribution(0.3 * 10000, 0.2 * 10000, 0.5 * 10000, { from: voting })
    await pool.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
  })

  it('voting adds a staking provider with 20 signing keys', async () => {
    const validatorsLimit = 1000
    const numKeys = 20

    const spTx = await spRegistry.addStakingProvider('SP-1', stakingProvider, validatorsLimit, { from: voting })
    const stakingProviderId = getEventArgument(spTx, 'StakingProviderAdded', 'id')

    assertBn(await spRegistry.getStakingProvidersCount(), 1, 'total staking providers')

    const data = Array.from({ length: numKeys }, (_, i) => {
      const n = 1 + 10 * i
      return {
        key: pad(`0x${n.toString(16)}`, 48),
        sig: pad(`0x${n.toString(16)}`, 96)
      }
    })

    const keys = hexConcat(...data.map((v) => v.key))
    const sigs = hexConcat(...data.map((v) => v.sig))

    await spRegistry.addSigningKeys(stakingProviderId, numKeys, keys, sigs, { from: stakingProvider })

    const totalKeys = await spRegistry.getTotalSigningKeyCount(stakingProviderId, { from: nobody })
    assertBn(totalKeys, numKeys, 'total signing keys')
  })

  it('a user submits 15 * 32 ETH', async () => {
    const referral = ZERO_ADDRESS
    await pool.submit(referral, { from: user1, value: ETH(15 * 32) })

    assertBn(await pool.getTotalControlledEther(), ETH(15 * 32), 'total controlled ether')
  })

  it('at this point, only 5 validators were registered due to the iteration limit', async () => {
    assertBn(await validatorRegistrationMock.totalCalls(), 5, 'total validators registered')

    const ether2Stat = await pool.getEther2Stat()
    assertBn(ether2Stat.deposited, ETH(5 * 32), 'deposited ether2')
  })

  it('the rest of the received Ether is still buffered in the pool', async () => {
    assertBn(await pool.getBufferedEther(), ETH(15 * 32 - 5 * 32), 'buffered ether')
  })

  it('one can advance the deposit loop by submitting any Ether amount', async () => {
    const result = await pool.submit(ZERO_ADDRESS, { from: user2, value: ETH(10 * 32) })

    const submittedEvents = getEvents(result, 'Submitted')
    assert(submittedEvents.length === 1, 'a Submitted event was generated')

    assertBn(await pool.getTotalControlledEther(), ETH(25 * 32), 'total controlled ether')

    // no more than depositIterationLimit validators are registered in a single transaction

    assertBn(await validatorRegistrationMock.totalCalls(), 10, 'total validators registered')

    const ether2Stat = await pool.getEther2Stat()
    assertBn(ether2Stat.deposited, ETH(10 * 32), 'deposited ether2')

    assertBn(await pool.getBufferedEther(), ETH(25 * 32 - 10 * 32), 'buffered ether')
  })

  it('submitting zero Ether advances the loop as well as long as there is enough buffered Ether and validator keys', async () => {
    const result = await pool.submit(ZERO_ADDRESS, { from: nobody, value: 0 })

    const submittedEvents = getEvents(result, 'Submitted')
    assert(submittedEvents.length === 0, 'no Submitted events were generated')

    assertBn(await pool.getTotalControlledEther(), ETH(25 * 32), 'total controlled ether')
    assertBn(await validatorRegistrationMock.totalCalls(), 15, 'total validators registered')

    const ether2Stat = await pool.getEther2Stat()
    assertBn(ether2Stat.deposited, ETH(15 * 32), 'deposited ether2')

    assertBn(await pool.getBufferedEther(), ETH(25 * 32 - 15 * 32), 'buffered ether')
  })

  it('voting can change deposit loop iteration limit (setting it to 3)', async () => {
    await pool.setDepositIterationLimit(3, { from: voting })
    assertBn(await pool.getDepositIterationLimit(), 3)
  })

  it('the limit cannot be set to zero', async () => {
    await assertRevert(pool.setDepositIterationLimit(0, { from: voting }), 'ZERO_LIMIT')
  })

  it('the new iteration limit comes into effect on the next submit', async () => {
    await pool.submit(ZERO_ADDRESS, { from: nobody, value: 0 })
    assertBn(await pool.getTotalControlledEther(), ETH(25 * 32), 'total controlled ether')

    assertBn(await validatorRegistrationMock.totalCalls(), 18)

    const ether2Stat = await pool.getEther2Stat()
    assertBn(ether2Stat.deposited, ETH(18 * 32), 'deposited ether2')

    assertBn(await pool.getBufferedEther(), ETH(25 * 32 - 18 * 32), 'buffered ether')
  })

  it('the number of registered validators is still limited by the number of available validator keys', async () => {
    await pool.submit(ZERO_ADDRESS, { from: user1, value: ETH(32) })
    assertBn(await pool.getTotalControlledEther(), ETH(26 * 32), 'total controlled ether')

    assertBn(await validatorRegistrationMock.totalCalls(), 20)

    const ether2Stat = await pool.getEther2Stat()
    assertBn(ether2Stat.deposited, ETH(20 * 32), 'deposited ether2')

    assertBn(await pool.getBufferedEther(), ETH(26 * 32 - 20 * 32), 'buffered ether')
  })
})
