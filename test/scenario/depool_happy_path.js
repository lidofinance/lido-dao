const { assert } = require('chai')
const { BN } = require('bn.js')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { getEventArgument } = require('@aragon/contract-helpers-test')

const { pad, toBN, ETH, tokens } = require('../helpers/utils')
const { deployDaoAndPool } = require('./helpers/deploy')

contract('DePool: happy path', (addresses) => {
  const [
    // the root account which deployed the DAO
    appManager,
    // the address which we use to simulate the voting DAO application
    voting,
    // staking providers
    sp1,
    sp2,
    // users who deposit Ether to the pool
    user1,
    user2,
    user3,
    // unrelated address
    nobody
  ] = addresses

  let pool, spRegistry, token
  let oracleMock, validatorRegistrationMock
  let treasuryAddr, insuranceAddr

  it('DAO, staking providers registry, token, and pool are deployed and initialized', async () => {
    const deployed = await deployDaoAndPool(appManager, voting)

    // contracts/StETH.sol
    token = deployed.token

    // contracts/DePool.sol
    pool = deployed.pool

    // contracts/sps/StakingProvidersRegistry.sol
    spRegistry = deployed.spRegistry

    // mocks
    oracleMock = deployed.oracleMock
    validatorRegistrationMock = deployed.validatorRegistrationMock

    // addresses
    treasuryAddr = deployed.treasuryAddr
    insuranceAddr = deployed.insuranceAddr
  })

  // Fee and its distribution are in basis points, 10000 corresponding to 100%

  // Total fee is 1%
  const totalFeePoints = 0.01 * 10000

  // Of this 1%, 30% goes to the treasury
  const treasuryFeePoints = 0.3 * 10000
  // 20% goes to the insurance fund
  const insuranceFeePoints = 0.2 * 10000
  // 50% goes to staking providers
  const stakingProvidersFeePoints = 0.5 * 10000

  it('voting sets fee and its distribution', async () => {
    await pool.setFee(totalFeePoints, { from: voting })
    await pool.setFeeDistribution(treasuryFeePoints, insuranceFeePoints, stakingProvidersFeePoints, { from: voting })

    // Fee and distribution were set

    assertBn(await pool.getFee({ from: nobody }), totalFeePoints, 'total fee')

    const distribution = await pool.getFeeDistribution({ from: nobody })
    assertBn(distribution.treasuryFeeBasisPoints, treasuryFeePoints, 'treasury fee')
    assertBn(distribution.insuranceFeeBasisPoints, insuranceFeePoints, 'insurance fee')
    assertBn(distribution.SPFeeBasisPoints, stakingProvidersFeePoints, 'staking providers fee')
  })

  const withdrawalCredentials = pad('0x0202', 32)

  it('voting sets withdrawal credentials', async () => {
    await pool.setWithdrawalCredentials(withdrawalCredentials, { from: voting })

    // Withdrawal credentials were set

    assert.equal(await pool.getWithdrawalCredentials({ from: nobody }), withdrawalCredentials, 'withdrawal credentials')
  })

  // Each staking provider has its Ethereum 1 address, a name and a set of registered
  // validators, each of them defined as a (public key, signature) pair
  const stakingProvider1 = {
    name: 'SP-1',
    address: sp1,
    validators: [
      {
        key: pad('0x010101', 48),
        sig: pad('0x01', 96)
      }
    ]
  }

  it('voting adds the first staking provider', async () => {
    // How many validators can this staking provider register
    const validatorsLimit = 1000000000

    const spTx = await spRegistry.addStakingProvider(stakingProvider1.name, stakingProvider1.address, validatorsLimit, { from: voting })

    stakingProvider1.id = getEventArgument(spTx, 'StakingProviderAdded', 'id')
    assertBn(stakingProvider1.id, 0, 'SP id')

    assertBn(await spRegistry.getStakingProvidersCount(), 1, 'total staking providers')
  })

  it('the first staking provider registers one validator', async () => {
    const numKeys = 1

    await spRegistry.addSigningKeys(stakingProvider1.id, numKeys, stakingProvider1.validators[0].key, stakingProvider1.validators[0].sig, {
      from: stakingProvider1.address
    })

    // The key was added

    const totalKeys = await spRegistry.getTotalSigningKeyCount(stakingProvider1.id, { from: nobody })
    assertBn(totalKeys, 1, 'total signing keys')

    // The key was not used yet

    const unusedKeys = await spRegistry.getUnusedSigningKeyCount(stakingProvider1.id, { from: nobody })
    assertBn(unusedKeys, 1, 'unused signing keys')
  })

  it('the first user deposits 3 ETH to the pool', async () => {
    await web3.eth.sendTransaction({ to: pool.address, from: user1, value: ETH(3) })

    // No Ether was deposited yet to the validator contract

    assertBn(await validatorRegistrationMock.totalCalls(), 0)

    const ether2Stat = await pool.getEther2Stat()
    assertBn(ether2Stat.deposited, 0, 'deposited ether2')
    assertBn(ether2Stat.remote, 0, 'remote ether2')

    // All Ether was buffered within the pool contract atm

    assertBn(await pool.getBufferedEther(), ETH(3), 'buffered ether')
    assertBn(await pool.getTotalControlledEther(), ETH(3), 'total controlled ether')

    // The amount of tokens corresponding to the deposited ETH value was minted to the user

    assertBn(await token.balanceOf(user1), tokens(3), 'user1 tokens')

    assertBn(await token.totalSupply(), tokens(3), 'token total supply')
  })

  it('the second user deposits 30 ETH to the pool', async () => {
    await web3.eth.sendTransaction({ to: pool.address, from: user2, value: ETH(30) })

    // The first 32 ETH chunk was deposited to the validator registration contract,
    // using public key and signature of the only validator of the first SP

    assertBn(await validatorRegistrationMock.totalCalls(), 1)

    const regCall = await validatorRegistrationMock.calls.call(0)
    assert.equal(regCall.pubkey, stakingProvider1.validators[0].key)
    assert.equal(regCall.withdrawal_credentials, withdrawalCredentials)
    assert.equal(regCall.signature, stakingProvider1.validators[0].sig)
    assertBn(regCall.value, ETH(32))

    const ether2Stat = await pool.getEther2Stat()
    assertBn(ether2Stat.deposited, ETH(32), 'deposited ether2')
    assertBn(ether2Stat.remote, 0, 'remote ether2')

    // Some Ether remained buffered within the pool contract

    assertBn(await pool.getBufferedEther(), ETH(1), 'buffered ether')
    assertBn(await pool.getTotalControlledEther(), ETH(1 + 32), 'total controlled ether')

    // The amount of tokens corresponding to the deposited ETH value was minted to the users

    assertBn(await token.balanceOf(user1), tokens(3), 'user1 tokens')
    assertBn(await token.balanceOf(user2), tokens(30), 'user2 tokens')

    assertBn(await token.totalSupply(), tokens(3 + 30), 'token total supply')
  })

  it('at this point, the pool has ran out of signing keys', async () => {
    const unusedKeys = await spRegistry.getUnusedSigningKeyCount(stakingProvider1.id, { from: nobody })
    assertBn(unusedKeys, 0, 'unused signing keys')
  })

  const stakingProvider2 = {
    name: 'SP-2',
    address: sp2,
    validators: [
      {
        key: pad('0x020202', 48),
        sig: pad('0x02', 96)
      }
    ]
  }

  it('voting adds the second staking provider who registers one validator', async () => {
    const validatorsLimit = 1000000000

    const spTx = await spRegistry.addStakingProvider(stakingProvider2.name, stakingProvider2.address, validatorsLimit, { from: voting })

    stakingProvider2.id = getEventArgument(spTx, 'StakingProviderAdded', 'id')
    assertBn(stakingProvider2.id, 1, 'SP id')

    assertBn(await spRegistry.getStakingProvidersCount(), 2, 'total staking providers')

    const numKeys = 1

    await spRegistry.addSigningKeys(stakingProvider2.id, numKeys, stakingProvider2.validators[0].key, stakingProvider2.validators[0].sig, {
      from: stakingProvider2.address
    })

    // The key was added

    const totalKeys = await spRegistry.getTotalSigningKeyCount(stakingProvider2.id, { from: nobody })
    assertBn(totalKeys, 1, 'total signing keys')

    // The key was not used yet

    const unusedKeys = await spRegistry.getUnusedSigningKeyCount(stakingProvider2.id, { from: nobody })
    assertBn(unusedKeys, 1, 'unused signing keys')
  })

  it('the third user deposits 64 ETH to the pool', async () => {
    await web3.eth.sendTransaction({ to: pool.address, from: user3, value: ETH(64) })

    // The first 32 ETH chunk was deposited to the validator registration contract,
    // using public key and signature of the only validator of the second SP

    assertBn(await validatorRegistrationMock.totalCalls(), 2)

    const regCall = await validatorRegistrationMock.calls.call(1)
    assert.equal(regCall.pubkey, stakingProvider2.validators[0].key)
    assert.equal(regCall.withdrawal_credentials, withdrawalCredentials)
    assert.equal(regCall.signature, stakingProvider2.validators[0].sig)
    assertBn(regCall.value, ETH(32))

    const ether2Stat = await pool.getEther2Stat()
    assertBn(ether2Stat.deposited, ETH(64), 'deposited ether2')
    assertBn(ether2Stat.remote, 0, 'remote ether2')

    // The pool ran out of validator keys, so the remaining 32 ETH were added to the
    // pool buffer

    assertBn(await pool.getBufferedEther(), ETH(1 + 32), 'buffered ether')
    assertBn(await pool.getTotalControlledEther(), ETH(33 + 64), 'total controlled ether')

    // The amount of tokens corresponding to the deposited ETH value was minted to the users

    assertBn(await token.balanceOf(user1), tokens(3), 'user1 tokens')
    assertBn(await token.balanceOf(user2), tokens(30), 'user2 tokens')
    assertBn(await token.balanceOf(user3), tokens(64), 'user3 tokens')

    assertBn(await token.totalSupply(), tokens(3 + 30 + 64), 'token total supply')
  })

  it('the oracle reports balance increase on Ethereum2 side', async () => {
    const epoch = 100

    // Reporting 1.5-fold balance increase (64 => 96)

    await oracleMock.reportEther2(epoch, ETH(96))

    // Ether2 stat reported by the pool changed correspondingly

    const ether2Stat = await pool.getEther2Stat()
    assertBn(ether2Stat.deposited, ETH(64), 'deposited ether2')
    assertBn(ether2Stat.remote, ETH(96), 'remote ether2')

    // Buffered Ether amount didn't change

    assertBn(await pool.getBufferedEther(), ETH(33), 'buffered ether')

    // Total controlled Ether increased

    assertBn(await pool.getTotalControlledEther(), ETH(33 + 96), 'total controlled ether')

    // New tokens was minted to distribute fee, diluting token total supply:
    //
    // => mintedAmount * newRatio = totalFee
    // => newRatio = newTotalControlledEther / newTotalSupply =
    //             = newTotalControlledEther / (prevTotalSupply + mintedAmount)
    // => mintedAmount * newTotalControlledEther / (prevTotalSupply + mintedAmount) = totalFee
    // => mintedAmount = (totalFee * prevTotalSupply) / (newTotalControlledEther - totalFee)

    const reward = toBN(ETH(96 - 64))
    const prevTotalSupply = toBN(tokens(3 + 30 + 64))
    const newTotalControlledEther = toBN(ETH(33 + 96))

    const totalFee = new BN(totalFeePoints).mul(reward).divn(10000)
    const mintedAmount = totalFee.mul(prevTotalSupply).div(newTotalControlledEther.sub(totalFee))
    const newTotalSupply = prevTotalSupply.add(mintedAmount)

    assertBn(await token.totalSupply(), newTotalSupply.toString(10), 'token total supply')

    // Token user balances didn't change

    assertBn(await token.balanceOf(user1), tokens(3), 'user1 tokens')
    assertBn(await token.balanceOf(user2), tokens(30), 'user2 tokens')
    assertBn(await token.balanceOf(user3), tokens(64), 'user3 tokens')

    // Fee, in the form of minted tokens, was distributed between treasury, insurance fund
    // and staking providers

    const treasuryTokenBalance = mintedAmount.muln(treasuryFeePoints).divn(10000)
    const insuranceTokenBalance = mintedAmount.muln(insuranceFeePoints).divn(10000)

    assertBn(await token.balanceOf(treasuryAddr), treasuryTokenBalance.toString(10), 'treasury tokens')
    assertBn(await token.balanceOf(insuranceAddr), insuranceTokenBalance.toString(10), 'insurance tokens')

    // The staking providers' fee is distributed between all active staking providers,
    // proprotional to their effective stake (the amount of Ether staked by the provider's
    // used and non-stopped validators).
    //
    // In our case, both staking providers received the same fee since they have the same
    // effective stake (one signing key used from each SP, staking 32 ETH)

    const stakingProvidersTokenBalance = mintedAmount.sub(treasuryTokenBalance).sub(insuranceTokenBalance)
    const individualProviderBalance = stakingProvidersTokenBalance.divn(2)

    assertBn(await token.balanceOf(stakingProvider1.address), individualProviderBalance.toString(10), 'SP-1 tokens')
    assertBn(await token.balanceOf(stakingProvider2.address), individualProviderBalance.toString(10), 'SP-2 tokens')
  })
})
