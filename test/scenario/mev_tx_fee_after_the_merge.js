const { assert } = require('chai')
const { BN } = require('bn.js')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { getEventArgument } = require('@aragon/contract-helpers-test')

const { pad, toBN, ETH, tokens, hexConcat } = require('../helpers/utils')
const { deployDaoAndPool } = require('./helpers/deploy')

const { signDepositData } = require('../0.8.9/helpers/signatures')
const { waitBlocks } = require('../helpers/blockchain')
const addresses = require('@aragon/contract-helpers-test/src/addresses')

const LidoMevTipsVault = artifacts.require('LidoMevTipsVault.sol')
const RewardEmulatorMock = artifacts.require('RewardEmulatorMock.sol')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

contract.only('Lido: merge acceptance', (addresses) => {
  const [
    // the root account which deployed the DAO
    appManager,
    // the address which we use to simulate the voting DAO application
    voting,
    // node operators
    operator_1,
    operator_2,
    operator_3,
    // users who deposit Ether to the pool
    user1,
    user2,
    user3,
    // unrelated address
    nobody,
    // mev source
    userMev
  ] = addresses

  let pool, nodeOperatorRegistry, token
  let oracleMock, depositContractMock
  let treasuryAddr, insuranceAddr, guardians
  let depositSecurityModule, depositRoot
  let rewarder, mevVault

  it('DAO, node operators registry, token, pool and deposit security module are deployed and initialized', async () => {
    const deployed = await deployDaoAndPool(appManager, voting)

    // contracts/StETH.sol
    token = deployed.pool

    // contracts/Lido.sol
    pool = deployed.pool

    // contracts/nos/NodeOperatorsRegistry.sol
    nodeOperatorRegistry = deployed.nodeOperatorRegistry

    // mocks
    oracleMock = deployed.oracleMock
    depositContractMock = deployed.depositContractMock

    // addresses
    treasuryAddr = deployed.treasuryAddr
    insuranceAddr = deployed.insuranceAddr
    depositSecurityModule = deployed.depositSecurityModule
    guardians = deployed.guardians

    depositRoot = await depositContractMock.get_deposit_root()
  })

  it('Mev and tx tips vault deployed and initialized', async () => {
    mevVault = await LidoMevTipsVault.new(pool.address)
    await pool.setMevVault(mevVault.address)
  })

  it('Rewards emulator deployed and initialized', async () => {
    rewarder = await RewardEmulatorMock.new(mevVault.address)

    assertBn(await web3.eth.getBalance(mevVault.address), ETH(0), 'rewarder balance')
    assertBn(await web3.eth.getBalance(mevVault.address), ETH(0), 'mev vault balance')
  })

  // Fee and its distribution are in basis points, 10000 corresponding to 100%

  // Total fee is 1%
  const totalFeePoints = 0.01 * 10000

  // Of this 1%, 30% goes to the treasury
  const treasuryFeePoints = 0.3 * 10000
  // 20% goes to the insurance fund
  const insuranceFeePoints = 0.2 * 10000
  // 50% goes to node operators
  const nodeOperatorsFeePoints = 0.5 * 10000

  it('voting sets fee and its distribution', async () => {
    await pool.setFee(totalFeePoints, { from: voting })
    await pool.setFeeDistribution(treasuryFeePoints, insuranceFeePoints, nodeOperatorsFeePoints, { from: voting })

    // Fee and distribution were set

    assertBn(await pool.getFee({ from: nobody }), totalFeePoints, 'total fee')

    const distribution = await pool.getFeeDistribution({ from: nobody })
    assertBn(distribution.treasuryFeeBasisPoints, treasuryFeePoints, 'treasury fee')
    assertBn(distribution.insuranceFeeBasisPoints, insuranceFeePoints, 'insurance fee')
    assertBn(distribution.operatorsFeeBasisPoints, nodeOperatorsFeePoints, 'node operators fee')
  })

  const withdrawalCredentials = pad('0x0202', 32)

  it('voting sets withdrawal credentials', async () => {
    await pool.setWithdrawalCredentials(withdrawalCredentials, { from: voting })

    // Withdrawal credentials were set

    assert.equal(await pool.getWithdrawalCredentials({ from: nobody }), withdrawalCredentials, 'withdrawal credentials')
  })

  // Each node operator has its Ethereum 1 address, a name and a set of registered
  // validators, each of them defined as a (public key, signature) pair
  const nodeOperator1 = {
    name: 'operator_1',
    address: operator_1,
    validators: [
      {
        key: pad('0x010101', 48),
        sig: pad('0x01', 96)
      }
    ]
  }

  it('voting adds the first node operator', async () => {
    // How many validators can this node operator register
    const validatorsLimit = 1000000000

    const txn = await nodeOperatorRegistry.addNodeOperator(nodeOperator1.name, nodeOperator1.address, { from: voting })
    await nodeOperatorRegistry.setNodeOperatorStakingLimit(0, validatorsLimit, { from: voting })

    // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
    nodeOperator1.id = getEventArgument(txn, 'NodeOperatorAdded', 'id', { decodeForAbi: NodeOperatorsRegistry._json.abi })
    assertBn(nodeOperator1.id, 0, 'operator id')

    assertBn(await nodeOperatorRegistry.getNodeOperatorsCount(), 1, 'total node operators')
  })

  it('the first node operator registers one validator', async () => {
    const numKeys = 1

    await nodeOperatorRegistry.addSigningKeysOperatorBH(
      nodeOperator1.id,
      numKeys,
      nodeOperator1.validators[0].key,
      nodeOperator1.validators[0].sig,
      {
        from: nodeOperator1.address
      }
    )

    // The key was added

    const totalKeys = await nodeOperatorRegistry.getTotalSigningKeyCount(nodeOperator1.id, { from: nobody })
    assertBn(totalKeys, 1, 'total signing keys')

    // The key was not used yet

    const unusedKeys = await nodeOperatorRegistry.getUnusedSigningKeyCount(nodeOperator1.id, { from: nobody })
    assertBn(unusedKeys, 1, 'unused signing keys')
  })

  it('the first user deposits 3 ETH to the pool', async () => {
    await web3.eth.sendTransaction({ to: pool.address, from: user1, value: ETH(3) })
    const block = await web3.eth.getBlock('latest')
    const keysOpIndex = await nodeOperatorRegistry.getKeysOpIndex()
    const signatures = [
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        depositRoot,
        keysOpIndex,
        block.number,
        block.hash,
        guardians.privateKeys[guardians.addresses[0]]
      ),
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        depositRoot,
        keysOpIndex,
        block.number,
        block.hash,
        guardians.privateKeys[guardians.addresses[1]]
      )
    ]
    await depositSecurityModule.depositBufferedEther(depositRoot, keysOpIndex, block.number, block.hash, signatures)

    // No Ether was deposited yet to the validator contract

    assertBn(await depositContractMock.totalCalls(), 0)

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 0, 'deposited ether2')
    assertBn(ether2Stat.beaconBalance, 0, 'remote ether2')

    // All Ether was buffered within the pool contract atm

    assertBn(await pool.getBufferedEther(), ETH(3), 'buffered ether')
    assertBn(await pool.getTotalPooledEther(), ETH(3), 'total pooled ether')

    // The amount of tokens corresponding to the deposited ETH value was minted to the user

    assertBn(await token.balanceOf(user1), tokens(3), 'user1 tokens')

    assertBn(await token.totalSupply(), tokens(3), 'token total supply')
  })

  it('the second user deposits 30 ETH to the pool', async () => {
    await web3.eth.sendTransaction({ to: pool.address, from: user2, value: ETH(30) })
    const block = await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
    const keysOpIndex = await nodeOperatorRegistry.getKeysOpIndex()
    const signatures = [
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        depositRoot,
        keysOpIndex,
        block.number,
        block.hash,
        guardians.privateKeys[guardians.addresses[0]]
      ),
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        depositRoot,
        keysOpIndex,
        block.number,
        block.hash,
        guardians.privateKeys[guardians.addresses[1]]
      )
    ]
    await depositSecurityModule.depositBufferedEther(depositRoot, keysOpIndex, block.number, block.hash, signatures)

    // The first 32 ETH chunk was deposited to the deposit contract,
    // using public key and signature of the only validator of the first operator

    assertBn(await depositContractMock.totalCalls(), 1)

    const regCall = await depositContractMock.calls.call(0)
    assert.equal(regCall.pubkey, nodeOperator1.validators[0].key)
    assert.equal(regCall.withdrawal_credentials, withdrawalCredentials)
    assert.equal(regCall.signature, nodeOperator1.validators[0].sig)
    assertBn(regCall.value, ETH(32))

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 1, 'deposited ether2')
    assertBn(ether2Stat.beaconBalance, 0, 'remote ether2')

    // Some Ether remained buffered within the pool contract

    assertBn(await pool.getBufferedEther(), ETH(1), 'buffered ether')
    assertBn(await pool.getTotalPooledEther(), ETH(1 + 32), 'total pooled ether')

    // The amount of tokens corresponding to the deposited ETH value was minted to the users

    assertBn(await token.balanceOf(user1), tokens(3), 'user1 tokens')
    assertBn(await token.balanceOf(user2), tokens(30), 'user2 tokens')

    assertBn(await token.totalSupply(), tokens(3 + 30), 'token total supply')
  })

  it('at this point, the pool has ran out of signing keys', async () => {
    const unusedKeys = await nodeOperatorRegistry.getUnusedSigningKeyCount(nodeOperator1.id, { from: nobody })
    assertBn(unusedKeys, 0, 'unused signing keys')
  })

  const nodeOperator2 = {
    name: 'operator_2',
    address: operator_2,
    validators: [
      {
        key: pad('0x020202', 48),
        sig: pad('0x02', 96)
      }
    ]
  }

  it('voting adds the second node operator who registers one validator', async () => {
    // TODO: we have to submit operators with 0 validators allowed only
    const validatorsLimit = 1000000000

    const txn = await nodeOperatorRegistry.addNodeOperator(nodeOperator2.name, nodeOperator2.address, { from: voting })
    await nodeOperatorRegistry.setNodeOperatorStakingLimit(1, validatorsLimit, { from: voting })

    // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
    nodeOperator2.id = getEventArgument(txn, 'NodeOperatorAdded', 'id', { decodeForAbi: NodeOperatorsRegistry._json.abi })
    assertBn(nodeOperator2.id, 1, 'operator id')

    assertBn(await nodeOperatorRegistry.getNodeOperatorsCount(), 2, 'total node operators')

    const numKeys = 1

    await nodeOperatorRegistry.addSigningKeysOperatorBH(
      nodeOperator2.id,
      numKeys,
      nodeOperator2.validators[0].key,
      nodeOperator2.validators[0].sig,
      {
        from: nodeOperator2.address
      }
    )

    // The key was added

    const totalKeys = await nodeOperatorRegistry.getTotalSigningKeyCount(nodeOperator2.id, { from: nobody })
    assertBn(totalKeys, 1, 'total signing keys')

    // The key was not used yet

    const unusedKeys = await nodeOperatorRegistry.getUnusedSigningKeyCount(nodeOperator2.id, { from: nobody })
    assertBn(unusedKeys, 1, 'unused signing keys')
  })

  it('the third user deposits 64 ETH to the pool', async () => {
    await web3.eth.sendTransaction({ to: pool.address, from: user3, value: ETH(64) })

    const block = await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
    const keysOpIndex = await nodeOperatorRegistry.getKeysOpIndex()
    const signatures = [
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        depositRoot,
        keysOpIndex,
        block.number,
        block.hash,
        guardians.privateKeys[guardians.addresses[0]]
      ),
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        depositRoot,
        keysOpIndex,
        block.number,
        block.hash,
        guardians.privateKeys[guardians.addresses[1]]
      )
    ]
    await depositSecurityModule.depositBufferedEther(depositRoot, keysOpIndex, block.number, block.hash, signatures)

    // The first 32 ETH chunk was deposited to the deposit contract,
    // using public key and signature of the only validator of the second operator

    assertBn(await depositContractMock.totalCalls(), 2)

    const regCall = await depositContractMock.calls.call(1)
    assert.equal(regCall.pubkey, nodeOperator2.validators[0].key)
    assert.equal(regCall.withdrawal_credentials, withdrawalCredentials)
    assert.equal(regCall.signature, nodeOperator2.validators[0].sig)
    assertBn(regCall.value, ETH(32))

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assertBn(ether2Stat.beaconBalance, 0, 'remote ether2')

    // The pool ran out of validator keys, so the remaining 32 ETH were added to the
    // pool buffer

    assertBn(await pool.getBufferedEther(), ETH(1 + 32), 'buffered ether')
    assertBn(await pool.getTotalPooledEther(), ETH(33 + 64), 'total pooled ether')

    // The amount of tokens corresponding to the deposited ETH value was minted to the users

    assertBn(await token.balanceOf(user1), tokens(3), 'user1 tokens')
    assertBn(await token.balanceOf(user2), tokens(30), 'user2 tokens')
    assertBn(await token.balanceOf(user3), tokens(64), 'user3 tokens')

    assertBn(await token.totalSupply(), tokens(3 + 30 + 64), 'token total supply')
  })

  it('collect 9 ETH mev and tx rewards on a vault', async () => {
    await rewarder.reward({ from: userMev, value: ETH(9) })
    assertBn(await web3.eth.getBalance(mevVault.address), ETH(9), 'mev vault balance')
  })

  it('the oracle reports balance increase on Ethereum2 side and claims collected mev and tx fee rewards', async () => {
    const epoch = 100

    // Total shares are equal to deposited eth before ratio change and fee mint

    const oldTotalShares = await token.getTotalShares()
    assertBn(oldTotalShares, ETH(97), 'total shares')

    // Old total pooled Ether

    const oldTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(oldTotalPooledEther, ETH(33 + 64), 'total pooled ether')

    // Reporting 1.5-fold balance increase (64 => 96)

    await oracleMock.reportBeacon(epoch, 2, ETH(96))

    // Mev and tx rewards just claimed
    assertBn(await web3.eth.getBalance(mevVault.address), ETH(0), 'mev vault balance')

    // Total shares increased because fee minted (fee shares added)
    // shares ~= oldTotalShares + reward * oldTotalShares / (newTotalPooledEther - reward)

    const newTotalShares = await token.getTotalShares()

    assertBn(newTotalShares, new BN('97289047169125663202'), 'total shares')

    // Total pooled Ether increased

    const newTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(newTotalPooledEther, ETH(33 + 96 + 9), 'total pooled ether')

    // Ether2 stat reported by the pool changed correspondingly

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assertBn(ether2Stat.beaconBalance, ETH(96), 'remote ether2')

    // Buffered Ether amount didn't change

    assertBn(await pool.getBufferedEther(), ETH(33 + 9), 'buffered ether')

    // New tokens was minted to distribute fee
    assertBn(await token.totalSupply(), tokens(129 + 9), 'token total supply')

    const reward = toBN(ETH(96 - 64 + 9))
    const mintedAmount = new BN(totalFeePoints).mul(reward).divn(10000)

    // Token user balances increased
    assertBn(await token.balanceOf(user1), new BN('4255360824742268041'), 'user1 tokens')
    assertBn(await token.balanceOf(user2), new BN('42553608247422680412'), 'user2 tokens')
    assertBn(await token.balanceOf(user3), new BN('90781030927835051546'), 'user3 tokens')

    // Fee, in the form of minted tokens, was distributed between treasury, insurance fund
    // and node operators
    // treasuryTokenBalance ~= mintedAmount * treasuryFeePoints / 10000
    // insuranceTokenBalance ~= mintedAmount * insuranceFeePoints / 10000
    assertBn(await token.balanceOf(treasuryAddr), new BN('123000000000000001'), 'treasury tokens')
    assertBn(await token.balanceOf(insuranceAddr), new BN('81999999999999999'), 'insurance tokens')

    // The node operators' fee is distributed between all active node operators,
    // proprotional to their effective stake (the amount of Ether staked by the operator's
    // used and non-stopped validators).
    //
    // In our case, both node operators received the same fee since they have the same
    // effective stake (one signing key used from each operator, staking 32 ETH)

    assertBn(await token.balanceOf(nodeOperator1.address), new BN('102499999999999999'), 'operator_1 tokens')
    assertBn(await token.balanceOf(nodeOperator2.address), new BN('102499999999999999'), 'operator_2 tokens')

    // Real minted amount should be a bit less than calculated caused by round errors on mint and transfer operations
    assert(
      mintedAmount
        .sub(
          new BN(0)
            .add(await token.balanceOf(treasuryAddr))
            .add(await token.balanceOf(insuranceAddr))
            .add(await token.balanceOf(nodeOperator1.address))
            .add(await token.balanceOf(nodeOperator2.address))
            .add(await token.balanceOf(nodeOperatorRegistry.address))
        )
        .lt(mintedAmount.divn(100))
    )
  })
})
