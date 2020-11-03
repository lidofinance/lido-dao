const { assert } = require('chai')
const { BN } = require('bn.js')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { getEventArgument } = require('@aragon/contract-helpers-test')

const { pad, toBN, ETH, tokens } = require('../helpers/utils')
const { deployDaoAndPool } = require('./helpers/deploy')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

contract('Lido: happy path', (addresses) => {
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

    // contracts/Lido.sol
    pool = deployed.pool

    // contracts/sps/NodeOperatorsRegistry.sol
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
  const nodeOperatorsFeePoints = 0.5 * 10000

  it('voting sets fee and its distribution', async () => {
    await pool.setFee(totalFeePoints, { from: voting })
    await pool.setFeeDistribution(treasuryFeePoints, insuranceFeePoints, nodeOperatorsFeePoints, { from: voting })

    // Fee and distribution were set

    assertBn(await pool.getFee({ from: nobody }), totalFeePoints, 'total fee')

    const distribution = await pool.getFeeDistribution({ from: nobody })
    assertBn(distribution.treasuryFeeBasisPoints, treasuryFeePoints, 'treasury fee')
    assertBn(distribution.insuranceFeeBasisPoints, insuranceFeePoints, 'insurance fee')
    assertBn(distribution.SPFeeBasisPoints, nodeOperatorsFeePoints, 'staking providers fee')
  })

  const withdrawalCredentials = pad('0x0202', 32)

  it('voting sets withdrawal credentials', async () => {
    await pool.setWithdrawalCredentials(withdrawalCredentials, { from: voting })

    // Withdrawal credentials were set

    assert.equal(await pool.getWithdrawalCredentials({ from: nobody }), withdrawalCredentials, 'withdrawal credentials')
  })

  // Each staking provider has its Ethereum 1 address, a name and a set of registered
  // validators, each of them defined as a (public key, signature) pair
  const nodeOperator1 = {
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

    const spTx = await spRegistry.addNodeOperator(nodeOperator1.name, nodeOperator1.address, validatorsLimit, { from: voting })

    // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
    nodeOperator1.id = getEventArgument(spTx, 'NodeOperatorAdded', 'id', { decodeForAbi: NodeOperatorsRegistry._json.abi })
    assertBn(nodeOperator1.id, 0, 'SP id')

    assertBn(await spRegistry.getNodeOperatorsCount(), 1, 'total staking providers')
  })

  it('the first staking provider registers one validator', async () => {
    const numKeys = 1

    await spRegistry.addSigningKeysSP(nodeOperator1.id, numKeys, nodeOperator1.validators[0].key, nodeOperator1.validators[0].sig, {
      from: nodeOperator1.address
    })

    // The key was added

    const totalKeys = await spRegistry.getTotalSigningKeyCount(nodeOperator1.id, { from: nobody })
    assertBn(totalKeys, 1, 'total signing keys')

    // The key was not used yet

    const unusedKeys = await spRegistry.getUnusedSigningKeyCount(nodeOperator1.id, { from: nobody })
    assertBn(unusedKeys, 1, 'unused signing keys')
  })

  it('the first user deposits 3 ETH to the pool', async () => {
    await web3.eth.sendTransaction({ to: pool.address, from: user1, value: ETH(3) })
    await pool.depositBufferedEther()

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
    await pool.depositBufferedEther()

    // The first 32 ETH chunk was deposited to the validator registration contract,
    // using public key and signature of the only validator of the first SP

    assertBn(await validatorRegistrationMock.totalCalls(), 1)

    const regCall = await validatorRegistrationMock.calls.call(0)
    assert.equal(regCall.pubkey, nodeOperator1.validators[0].key)
    assert.equal(regCall.withdrawal_credentials, withdrawalCredentials)
    assert.equal(regCall.signature, nodeOperator1.validators[0].sig)
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
    const unusedKeys = await spRegistry.getUnusedSigningKeyCount(nodeOperator1.id, { from: nobody })
    assertBn(unusedKeys, 0, 'unused signing keys')
  })

  const nodeOperator2 = {
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

    const spTx = await spRegistry.addNodeOperator(nodeOperator2.name, nodeOperator2.address, validatorsLimit, { from: voting })

    // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
    nodeOperator2.id = getEventArgument(spTx, 'NodeOperatorAdded', 'id', { decodeForAbi: NodeOperatorsRegistry._json.abi })
    assertBn(nodeOperator2.id, 1, 'SP id')

    assertBn(await spRegistry.getNodeOperatorsCount(), 2, 'total staking providers')

    const numKeys = 1

    await spRegistry.addSigningKeysSP(nodeOperator2.id, numKeys, nodeOperator2.validators[0].key, nodeOperator2.validators[0].sig, {
      from: nodeOperator2.address
    })

    // The key was added

    const totalKeys = await spRegistry.getTotalSigningKeyCount(nodeOperator2.id, { from: nobody })
    assertBn(totalKeys, 1, 'total signing keys')

    // The key was not used yet

    const unusedKeys = await spRegistry.getUnusedSigningKeyCount(nodeOperator2.id, { from: nobody })
    assertBn(unusedKeys, 1, 'unused signing keys')
  })

  it('the third user deposits 64 ETH to the pool', async () => {
    await web3.eth.sendTransaction({ to: pool.address, from: user3, value: ETH(64) })
    await pool.depositBufferedEther()

    // The first 32 ETH chunk was deposited to the validator registration contract,
    // using public key and signature of the only validator of the second SP

    assertBn(await validatorRegistrationMock.totalCalls(), 2)

    const regCall = await validatorRegistrationMock.calls.call(1)
    assert.equal(regCall.pubkey, nodeOperator2.validators[0].key)
    assert.equal(regCall.withdrawal_credentials, withdrawalCredentials)
    assert.equal(regCall.signature, nodeOperator2.validators[0].sig)
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

    // Total shares are equal to deposited eth before ratio change and fee mint

    const oldTotalShares = await token.getTotalShares()
    assertBn(oldTotalShares, ETH(97), 'total shares')

    // Old total controlled Ether

    const oldTotalControlledEther = await pool.getTotalControlledEther()
    assertBn(oldTotalControlledEther, ETH(33 + 64), 'total controlled ether')

    // Reporting 1.5-fold balance increase (64 => 96)

    await oracleMock.reportEther2(epoch, ETH(96))

    // Total shares increased because fee minted (fee shares added)
    // shares ~= oldTotalShares + reward * oldTotalShares / (newTotalControlledEther - reward)

    const newTotalShares = await token.getTotalShares()
    assertBn(newTotalShares, new BN('97240805234492225001'), 'total shares')

    // Total controlled Ether increased

    const newTotalControlledEther = await pool.getTotalControlledEther()
    assertBn(newTotalControlledEther, ETH(33 + 96), 'total controlled ether')

    // Ether2 stat reported by the pool changed correspondingly

    const ether2Stat = await pool.getEther2Stat()
    assertBn(ether2Stat.deposited, ETH(64), 'deposited ether2')
    assertBn(ether2Stat.remote, ETH(96), 'remote ether2')

    // Buffered Ether amount didn't change

    assertBn(await pool.getBufferedEther(), ETH(33), 'buffered ether')

    // New tokens was minted to distribute fee
    assertBn(await token.totalSupply(), tokens(129), 'token total supply')

    const reward = toBN(ETH(96 - 64))
    const mintedAmount = new BN(totalFeePoints).mul(reward).divn(10000)

    // Token user balances increased
    assertBn(await token.balanceOf(user1), new BN('3979810729320528835'), 'user1 tokens')
    assertBn(await token.balanceOf(user2), new BN('39798107293205288355'), 'user2 tokens')
    assertBn(await token.balanceOf(user3), new BN('84902628892171281825'), 'user3 tokens')

    // Fee, in the form of minted tokens, was distributed between treasury, insurance fund
    // and staking providers
    // treasuryTokenBalance ~= mintedAmount * treasuryFeePoints / 10000
    // insuranceTokenBalance ~= mintedAmount * insuranceFeePoints / 10000

    assertBn(await token.balanceOf(treasuryAddr), new BN('95762267471402490'), 'treasury tokens')
    assertBn(await token.balanceOf(insuranceAddr), new BN('63889021609758015'), 'insurance tokens')

    // The staking providers' fee is distributed between all active staking providers,
    // proprotional to their effective stake (the amount of Ether staked by the provider's
    // used and non-stopped validators).
    //
    // In our case, both staking providers received the same fee since they have the same
    // effective stake (one signing key used from each SP, staking 32 ETH)

    assertBn(await token.balanceOf(nodeOperator1.address), new BN('79900898110870236'), 'SP-1 tokens')
    assertBn(await token.balanceOf(nodeOperator2.address), new BN('79900898110870236'), 'SP-2 tokens')

    // Real minted amount should be a bit less than calculated caused by round errors on mint and transfer operations
    assert(
      mintedAmount
        .sub(
          new BN(0)
            .add(await token.balanceOf(treasuryAddr))
            .add(await token.balanceOf(insuranceAddr))
            .add(await token.balanceOf(nodeOperator1.address))
            .add(await token.balanceOf(nodeOperator2.address))
            .add(await token.balanceOf(spRegistry.address))
        )
        .lt(mintedAmount.divn(100))
    )
  })
})
