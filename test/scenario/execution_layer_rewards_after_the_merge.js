const { assert } = require('chai')
const { BN } = require('bn.js')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { getEventArgument } = require('@aragon/contract-helpers-test')

const { pad, toBN, ETH, tokens, hexConcat } = require('../helpers/utils')
const { deployDaoAndPool } = require('./helpers/deploy')

const { signDepositData } = require('../0.8.9/helpers/signatures')
const { waitBlocks } = require('../helpers/blockchain')
const addresses = require('@aragon/contract-helpers-test/src/addresses')

const LidoELRewardsVault = artifacts.require('LidoExecutionLayerRewardsVault.sol')
const RewardEmulatorMock = artifacts.require('RewardEmulatorMock.sol')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

const TOTAL_BASIS_POINTS = 10000

contract('Lido: merge acceptance', (addresses) => {
  const [
    // the root account which deployed the DAO
    appManager,
    // the address which we use to simulate the voting DAO application
    voting,
    // node operators
    operator_1,
    operator_2,
    // users who deposit Ether to the pool
    user1,
    user2,
    user3,
    // unrelated address
    nobody,
    // Execution layer rewards source
    userELRewards
  ] = addresses

  let pool, nodeOperatorRegistry, token
  let oracleMock, depositContractMock
  let treasuryAddr, insuranceAddr, guardians
  let depositSecurityModule, depositRoot
  let rewarder, elRewardsVault

  // Total fee is 1%
  const totalFeePoints = 0.01 * TOTAL_BASIS_POINTS
  // Of this 1%, 30% goes to the treasury
  const treasuryFeePoints = 0.3 * TOTAL_BASIS_POINTS
  // 20% goes to the insurance fund
  const insuranceFeePoints = 0.2 * TOTAL_BASIS_POINTS
  // 50% goes to node operators
  const nodeOperatorsFeePoints = 0.5 * TOTAL_BASIS_POINTS

  const withdrawalCredentials = pad('0x0202', 32)

  // Each node operator has its Ethereum 1 address, a name and a set of registered
  // validators, each of them defined as a (public key, signature) pair
  // NO with 1 validator
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

  // NO with 1 validator
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

  before('deploy base stuff', async () => {
    const deployed = await deployDaoAndPool(appManager, voting)

    // contracts/StETH.sol
    token = deployed.pool

    // contracts/Lido.sol
    pool = deployed.pool

    await pool.resumeProtocolAndStaking()

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

    elRewardsVault = await LidoELRewardsVault.new(pool.address, treasuryAddr)
    await pool.setELRewardsVault(elRewardsVault.address, { from: voting })

    // At first go through tests assuming there is no withdrawal limit
    await pool.setELRewardsWithdrawalLimit(TOTAL_BASIS_POINTS, { from: voting })

    rewarder = await RewardEmulatorMock.new(elRewardsVault.address)

    assertBn(await web3.eth.getBalance(rewarder.address), ETH(0), 'rewarder balance')
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(0), 'Execution layer rewards vault balance')

    // Fee and its distribution are in basis points, 10000 corresponding to 100%

    await pool.setFee(totalFeePoints, { from: voting })
    await pool.setFeeDistribution(treasuryFeePoints, insuranceFeePoints, nodeOperatorsFeePoints, { from: voting })

    // Fee and distribution were set

    assertBn(await pool.getFee({ from: nobody }), totalFeePoints, 'total fee')

    const distribution = await pool.getFeeDistribution({ from: nobody })
    assertBn(distribution.treasuryFeeBasisPoints, treasuryFeePoints, 'treasury fee')
    assertBn(distribution.insuranceFeeBasisPoints, insuranceFeePoints, 'insurance fee')
    assertBn(distribution.operatorsFeeBasisPoints, nodeOperatorsFeePoints, 'node operators fee')

    await pool.setWithdrawalCredentials(withdrawalCredentials, { from: voting })

    // Withdrawal credentials were set
    assert.equal(await pool.getWithdrawalCredentials({ from: nobody }), withdrawalCredentials, 'withdrawal credentials')

    // How many validators can this node operator register
    const validatorsLimit = 100000000
    let txn = await nodeOperatorRegistry.addNodeOperator(nodeOperator1.name, nodeOperator1.address, { from: voting })
    await nodeOperatorRegistry.setNodeOperatorStakingLimit(0, validatorsLimit, { from: voting })

    // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
    nodeOperator1.id = getEventArgument(txn, 'NodeOperatorAdded', 'id', { decodeForAbi: NodeOperatorsRegistry._json.abi })
    assertBn(nodeOperator1.id, 0, 'operator id')

    assertBn(await nodeOperatorRegistry.getNodeOperatorsCount(), 1, 'total node operators')

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

    let totalKeys = await nodeOperatorRegistry.getTotalSigningKeyCount(nodeOperator1.id, { from: nobody })
    assertBn(totalKeys, 1, 'total signing keys')

    // The key was not used yet

    let unusedKeys = await nodeOperatorRegistry.getUnusedSigningKeyCount(nodeOperator1.id, { from: nobody })
    assertBn(unusedKeys, 1, 'unused signing keys')

    txn = await nodeOperatorRegistry.addNodeOperator(nodeOperator2.name, nodeOperator2.address, { from: voting })
    await nodeOperatorRegistry.setNodeOperatorStakingLimit(1, validatorsLimit, { from: voting })

    // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
    nodeOperator2.id = getEventArgument(txn, 'NodeOperatorAdded', 'id', { decodeForAbi: NodeOperatorsRegistry._json.abi })
    assertBn(nodeOperator2.id, 1, 'operator id')

    assertBn(await nodeOperatorRegistry.getNodeOperatorsCount(), 2, 'total node operators')

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

    totalKeys = await nodeOperatorRegistry.getTotalSigningKeyCount(nodeOperator2.id, { from: nobody })
    assertBn(totalKeys, 1, 'total signing keys')

    // The key was not used yet
    unusedKeys = await nodeOperatorRegistry.getUnusedSigningKeyCount(nodeOperator2.id, { from: nobody })
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

  it('collect 9 ETH execution layer rewards to the vault', async () => {
    await rewarder.reward({ from: userELRewards, value: ETH(9) })
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(9), 'Execution layer rewards vault balance')
  })

  it('the oracle reports balance increase on Ethereum2 side (+32 ETH) and claims collected execution layer rewards (+9 ETH)', async () => {
    const epoch = 100

    // Total shares are equal to deposited eth before ratio change and fee mint

    const oldTotalShares = await token.getTotalShares()
    assertBn(oldTotalShares, ETH(97), 'total shares')

    // Old total pooled Ether

    const oldTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(oldTotalPooledEther, ETH(33 + 64), 'total pooled ether')

    // Reporting 1.5-fold balance increase (64 => 96)

    await oracleMock.reportBeacon(epoch, 2, ETH(96))

    // Execution layer rewards just claimed
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(0), 'Execution layer rewards vault balance')

    // Total shares increased because fee minted (fee shares added)
    // shares ~= oldTotalShares + reward * oldTotalShares / (newTotalPooledEther - reward)

    const newTotalShares = await token.getTotalShares()

    assertBn(newTotalShares, new BN('97289047169125663202'), 'total shares')

    const elRewards = 9

    // Total pooled Ether increased

    const newTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(newTotalPooledEther, ETH(33 + 96 + elRewards), 'total pooled ether')

    // Ether2 stat reported by the pool changed correspondingly

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assertBn(ether2Stat.beaconBalance, ETH(96), 'remote ether2')

    // Buffered Ether amount changed on execution layer rewards
    assertBn(await pool.getBufferedEther(), ETH(33 + elRewards), 'buffered ether')

    // New tokens was minted to distribute fee
    assertBn(await token.totalSupply(), tokens(129 + elRewards), 'token total supply')

    const reward = toBN(ETH(96 - 64 + elRewards))
    const mintedAmount = new BN(totalFeePoints).mul(reward).divn(TOTAL_BASIS_POINTS)

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
    // proportional to their effective stake (the amount of Ether staked by the operator's
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

  it('collect another 7 ETH execution layer rewards to the vault', async () => {
    await rewarder.reward({ from: userELRewards, value: ETH(2) })
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(2), 'Execution layer rewards vault balance')

    await rewarder.reward({ from: userELRewards, value: ETH(5) })
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(7), 'Execution layer rewards vault balance')
  })

  it('the oracle reports same balance on Ethereum2 side (+0 ETH) and claims collected execution layer rewards (+7 ETH)', async () => {
    const epoch = 101

    // Total shares are equal to deposited eth before ratio change and fee mint
    const oldTotalShares = await token.getTotalShares()
    assertBn(oldTotalShares, new BN('97289047169125663202'), 'total shares')

    // Old total pooled Ether

    const oldTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(oldTotalPooledEther, ETH(138), 'total pooled ether')

    // Reporting the same balance as it was before (96ETH => 96ETH)
    await oracleMock.reportBeacon(epoch, 2, ETH(96))

    // Execution layer rewards just claimed
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(0), 'Execution layer rewards vault balance')

    // Total shares preserved because fee shares NOT minted
    // shares ~= oldTotalShares + reward * oldTotalShares / (newTotalPooledEther - reward)

    const newTotalShares = await token.getTotalShares()
    assertBn(newTotalShares, oldTotalShares, 'total shares')

    // Total pooled Ether increased

    const newTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(newTotalPooledEther, ETH(138 + 7), 'total pooled ether')

    // Ether2 stat reported by the pool changed correspondingly

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assertBn(ether2Stat.beaconBalance, ETH(96), 'remote ether2')

    // Buffered Ether amount changed on execution layer rewards
    assertBn(await pool.getBufferedEther(), ETH(42 + 7), 'buffered ether')

    assertBn(await token.totalSupply(), tokens(145), 'token total supply')

    const reward = toBN(0)
    const mintedAmount = new BN(0)

    // All of the balances should be increased with proportion of newTotalPooledEther/oldTotalPooledEther (which is >1)
    // cause shares per user and overall shares number are preserved

    assertBn(await token.balanceOf(user1), new BN('4471212460779919318'), 'user1 tokens')
    assertBn(await token.balanceOf(user2), new BN('44712124607799193187'), 'user2 tokens')
    assertBn(await token.balanceOf(user3), new BN('95385865829971612132'), 'user3 tokens')

    assertBn(await token.balanceOf(treasuryAddr), new BN('129239130434782610'), 'treasury tokens')
    assertBn(await token.balanceOf(insuranceAddr), new BN('86159420289855071'), 'insurance tokens')
    assertBn(await token.balanceOf(nodeOperator1.address), new BN('107699275362318839'), 'operator_1 tokens')
    assertBn(await token.balanceOf(nodeOperator2.address), new BN('107699275362318839'), 'operator_2 tokens')
  })

  it('collect another 5 ETH execution layer rewards to the vault', async () => {
    await rewarder.reward({ from: userELRewards, value: ETH(5) })
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(5), 'Execution layer rewards vault balance')
  })

  it('the oracle reports loss on Ethereum2 side (-2 ETH) and claims collected execution layer rewards (+5 ETH)', async () => {
    const epoch = 102

    // Total shares are equal to deposited eth before ratio change and fee mint
    const oldTotalShares = await token.getTotalShares()
    assertBn(oldTotalShares, new BN('97289047169125663202'), 'total shares')

    // Old total pooled Ether

    const oldTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(oldTotalPooledEther, ETH(145), 'total pooled ether')

    // Reporting balance decrease (96ETH => 94ETH)
    await oracleMock.reportBeacon(epoch, 2, ETH(94))

    // Execution layer rewards just claimed
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(0), 'Execution layer rewards vault balance')

    // Total shares preserved because fee shares NOT minted
    // shares ~= oldTotalShares + reward * oldTotalShares / (newTotalPooledEther - reward)
    const newTotalShares = await token.getTotalShares()
    assertBn(newTotalShares, oldTotalShares, 'total shares')

    // Total pooled Ether increased by 5ETH - 2ETH
    const newTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(newTotalPooledEther, ETH(145 + 3), 'total pooled ether')

    // Ether2 stat reported by the pool changed correspondingly
    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assertBn(ether2Stat.beaconBalance, ETH(94), 'remote ether2')

    // Buffered Ether amount changed on execution layer rewards
    assertBn(await pool.getBufferedEther(), ETH(49 + 5), 'buffered ether')

    assertBn(await token.totalSupply(), tokens(145 + 3), 'token total supply')

    const reward = toBN(0)
    const mintedAmount = new BN(0)

    // All of the balances should be increased with proportion of newTotalPooledEther/oldTotalPooledEther (which is >1)
    // cause shares per user and overall shares number are preserved

    assertBn(await token.balanceOf(user1), new BN('4563720304796055580'), 'user1 tokens')
    assertBn(await token.balanceOf(user2), new BN('45637203047960555804'), 'user2 tokens')
    assertBn(await token.balanceOf(user3), new BN('97359366502315852383'), 'user3 tokens')

    assertBn(await token.balanceOf(treasuryAddr), new BN('131913043478260871'), 'treasury tokens')
    assertBn(await token.balanceOf(insuranceAddr), new BN('87942028985507245'), 'insurance tokens')
    assertBn(await token.balanceOf(nodeOperator1.address), new BN('109927536231884057'), 'operator_1 tokens')
    assertBn(await token.balanceOf(nodeOperator2.address), new BN('109927536231884057'), 'operator_2 tokens')
  })

  it('collect another 3 ETH execution layer rewards to the vault', async () => {
    await rewarder.reward({ from: userELRewards, value: ETH(3) })
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(3), 'Execution layer rewards vault balance')
  })

  it('the oracle reports loss on Ethereum2 side (-3 ETH) and claims collected execution layer rewards (+3 ETH)', async () => {
    const epoch = 103

    // Total shares are equal to deposited eth before ratio change and fee mint
    const oldTotalShares = await token.getTotalShares()
    assertBn(oldTotalShares, new BN('97289047169125663202'), 'total shares')

    // Old total pooled Ether

    const oldTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(oldTotalPooledEther, ETH(148), 'total pooled ether')

    // Reporting balance decrease (94ETH => 91ETH)
    await oracleMock.reportBeacon(epoch, 2, ETH(91))

    // Execution layer rewards just claimed
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(0), 'Execution layer rewards vault balance')

    // Total shares preserved because fee shares NOT minted
    // shares ~= oldTotalShares + reward * oldTotalShares / (newTotalPooledEther - reward)
    const newTotalShares = await token.getTotalShares()
    assertBn(newTotalShares, oldTotalShares, 'total shares')

    // Total pooled Ether increased by 5ETH - 2ETH
    const newTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(newTotalPooledEther, oldTotalPooledEther, 'total pooled ether')

    // Ether2 stat reported by the pool changed correspondingly
    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assertBn(ether2Stat.beaconBalance, ETH(91), 'remote ether2')

    // Buffered Ether amount changed on execution layer rewards
    assertBn(await pool.getBufferedEther(), ETH(54 + 3), 'buffered ether')

    assertBn(await token.totalSupply(), tokens(148), 'token total supply')

    const reward = toBN(0)
    const mintedAmount = new BN(0)

    // All of the balances should be the same as before cause overall changes sums to zero
    assertBn(await token.balanceOf(user1), new BN('4563720304796055580'), 'user1 tokens')
    assertBn(await token.balanceOf(user2), new BN('45637203047960555804'), 'user2 tokens')
    assertBn(await token.balanceOf(user3), new BN('97359366502315852383'), 'user3 tokens')

    assertBn(await token.balanceOf(treasuryAddr), new BN('131913043478260871'), 'treasury tokens')
    assertBn(await token.balanceOf(insuranceAddr), new BN('87942028985507245'), 'insurance tokens')
    assertBn(await token.balanceOf(nodeOperator1.address), new BN('109927536231884057'), 'operator_1 tokens')
    assertBn(await token.balanceOf(nodeOperator2.address), new BN('109927536231884057'), 'operator_2 tokens')
  })

  it('collect another 2 ETH execution layer rewards to the vault', async () => {
    await rewarder.reward({ from: userELRewards, value: ETH(2) })
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(2), 'Execution layer rewards vault balance')
  })

  it('the oracle reports loss on Ethereum2 side (-8 ETH) and claims collected execution layer rewards (+2 ETH)', async () => {
    const epoch = 104

    // Total shares are equal to deposited eth before ratio change and fee mint
    const oldTotalShares = await token.getTotalShares()
    assertBn(oldTotalShares, new BN('97289047169125663202'), 'total shares')

    // Old total pooled Ether

    const oldTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(oldTotalPooledEther, ETH(148), 'total pooled ether')

    // Reporting balance decrease (91ETH => 83ETH)
    await oracleMock.reportBeacon(epoch, 2, ETH(83))

    // Execution layer rewards just claimed
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(0), 'Execution layer rewards vault balance')

    // Total shares preserved because fee shares NOT minted
    // shares ~= oldTotalShares + reward * oldTotalShares / (newTotalPooledEther - reward)
    const newTotalShares = await token.getTotalShares()
    assertBn(newTotalShares, oldTotalShares, 'total shares')

    // Total pooled Ether decreased by 8ETH-2ETH
    const newTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(newTotalPooledEther, ETH(142), 'total pooled ether')

    // Ether2 stat reported by the pool changed correspondingly
    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assertBn(ether2Stat.beaconBalance, ETH(83), 'remote ether2')

    // Buffered Ether amount changed on execution layer rewards
    assertBn(await pool.getBufferedEther(), ETH(57 + 2), 'buffered ether')

    assertBn(await token.totalSupply(), tokens(142), 'token total supply')

    // All of the balances should be decreased with proportion of newTotalPooledEther/oldTotalPooledEther (which is <1)
    // cause shares per user and overall shares number are preserved
    assertBn(await token.balanceOf(user1), new BN('4378704616763783056'), 'user1 tokens')
    assertBn(await token.balanceOf(user2), new BN('43787046167637830569'), 'user2 tokens')
    assertBn(await token.balanceOf(user3), new BN('93412365157627371881'), 'user3 tokens')

    assertBn(await token.balanceOf(treasuryAddr), new BN('126565217391304349'), 'treasury tokens')
    assertBn(await token.balanceOf(insuranceAddr), new BN('84376811594202897'), 'insurance tokens')
    assertBn(await token.balanceOf(nodeOperator1.address), new BN('105471014492753622'), 'operator_1 tokens')
    assertBn(await token.balanceOf(nodeOperator2.address), new BN('105471014492753622'), 'operator_2 tokens')
  })

  it('collect another 3 ETH execution layer rewards to the vault', async () => {
    await rewarder.reward({ from: userELRewards, value: ETH(3) })
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(3), 'Execution layer vault balance')
  })

  it('the oracle reports balance increase on Ethereum2 side (+2 ETH) and claims collected execution layer rewards (+3 ETH)', async () => {
    const epoch = 105

    // Total shares are equal to deposited eth before ratio change and fee mint
    const oldTotalShares = await token.getTotalShares()
    assertBn(oldTotalShares, new BN('97289047169125663202'), 'total shares')

    // Old total pooled Ether

    const oldTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(oldTotalPooledEther, ETH(142), 'total pooled ether')

    // Reporting balance increase (83ETH => 85ETH)
    await oracleMock.reportBeacon(epoch, 2, ETH(85))

    // Execution layer rewards just claimed
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(0), 'Execution layer rewards vault balance')

    // Total shares increased because fee minted (fee shares added)
    // shares ~= oldTotalShares + reward * oldTotalShares / (newTotalPooledEther - reward)

    const newTotalShares = await token.getTotalShares()
    assertBn(newTotalShares, new BN('97322149941214511675'), 'total shares')

    // Total pooled Ether increased by 2ETH+3ETH
    const newTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(newTotalPooledEther, ETH(142 + 5), 'total pooled ether')

    // Ether2 stat reported by the pool changed correspondingly
    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assertBn(ether2Stat.beaconBalance, ETH(85), 'remote ether2')

    // Buffered Ether amount changed on execution layer rewards
    assertBn(await pool.getBufferedEther(), ETH(59 + 3), 'buffered ether')

    assertBn(await token.totalSupply(), tokens(142 + 5), 'token total supply')

    // Token user balances increased
    assertBn(await token.balanceOf(user1), new BN('4531342559390407888'), 'user1 tokens')
    assertBn(await token.balanceOf(user2), new BN('45313425593904078888'), 'user2 tokens')
    assertBn(await token.balanceOf(user3), new BN('96668641266995368295'), 'user3 tokens')

    // Fee, in the form of minted tokens, was distributed between treasury, insurance fund
    // and node operators
    // treasuryTokenBalance = (oldTreasuryShares + mintedRewardShares * treasuryFeePoints / 10000) * sharePrice
    assertBn((await token.balanceOf(treasuryAddr)).divn(10), new BN('14597717391304348'), 'treasury tokens')
    // should preserver treasuryFeePoints/insuranceFeePoints ratio
    assertBn((await token.balanceOf(insuranceAddr)).divn(10), new BN('9731811594202898'), 'insurance tokens')

    // The node operators' fee is distributed between all active node operators,
    // proportional to their effective stake (the amount of Ether staked by the operator's
    // used and non-stopped validators).
    //
    // In our case, both node operators received the same fee since they have the same
    // effective stake (one signing key used from each operator, staking 32 ETH)
    assertBn((await token.balanceOf(nodeOperator1.address)).divn(10), new BN('12164764492753623'), 'operator_1 tokens')
    assertBn((await token.balanceOf(nodeOperator2.address)).divn(10), new BN('12164764492753623'), 'operator_2 tokens')
  })

  it('collect 0.1 ETH execution layer rewards to elRewardsVault and withdraw it entirely by means of multiple oracle reports (+1 ETH)', async () => {
    const toNum = (bn) => {
      return +bn.toString()
    }
    const toE18 = (x) => {
      return x * 1e18
    }
    const fromNum = (x) => {
      return new BN(String(x))
    }

    // Specify different withdrawal limits for a few epochs to test different values
    const getELRewardsWithdrawalLimitFromEpoch = (_epoch) => {
      if (_epoch === 106) {
        return 2
      } else if (_epoch === 107) {
        return 0
      } else {
        return 3
      }
    }

    const elRewards = toE18(0.1)
    await rewarder.reward({ from: userELRewards, value: fromNum(elRewards) })
    assertBn(await web3.eth.getBalance(elRewardsVault.address), fromNum(elRewards), 'Execution layer rewards vault balance')

    let epoch = 106
    let lastBeaconBalance = toE18(85)
    await pool.setELRewardsWithdrawalLimit(getELRewardsWithdrawalLimitFromEpoch(epoch), { from: voting })

    let elRewardsWithdrawalLimitPoints = toNum(await pool.getELRewardsWithdrawalLimit())
    let elRewardsVaultBalance = toNum(await web3.eth.getBalance(elRewardsVault.address))
    let totalPooledEther = toNum(await pool.getTotalPooledEther())
    let bufferedEther = toNum(await pool.getBufferedEther())
    let totalSupply = toNum(await pool.totalSupply())
    const beaconBalanceInc = toE18(1)
    let elRewardsWithdrawn = 0

    // Do multiple oracle reports to withdraw all ETH from execution layer rewards vault
    while (elRewardsVaultBalance > 0) {
      const elRewardsWithdrawalLimit = getELRewardsWithdrawalLimitFromEpoch(epoch)
      await pool.setELRewardsWithdrawalLimit(elRewardsWithdrawalLimit, { from: voting })
      elRewardsWithdrawalLimitPoints = toNum(await pool.getELRewardsWithdrawalLimit())

      const maxELRewardsAmountPerWithdrawal = Math.floor(
        ((totalPooledEther + beaconBalanceInc) * elRewardsWithdrawalLimitPoints) / TOTAL_BASIS_POINTS
      )
      const elRewardsToWithdraw = Math.min(maxELRewardsAmountPerWithdrawal, elRewardsVaultBalance)

      // Reporting balance increase
      await oracleMock.reportBeacon(epoch, 2, fromNum(lastBeaconBalance + beaconBalanceInc))

      assertBn(
        await web3.eth.getBalance(elRewardsVault.address),
        elRewardsVaultBalance - elRewardsToWithdraw,
        'Execution layer rewards vault balance'
      )

      assertBn(await pool.getTotalPooledEther(), totalPooledEther + beaconBalanceInc + elRewardsToWithdraw, 'total pooled ether')

      assertBn(await pool.totalSupply(), totalSupply + beaconBalanceInc + elRewardsToWithdraw, 'token total supply')

      assertBn(await pool.getBufferedEther(), bufferedEther + elRewardsToWithdraw, 'buffered ether')

      elRewardsVaultBalance = toNum(await web3.eth.getBalance(elRewardsVault.address))
      totalPooledEther = toNum(await pool.getTotalPooledEther())
      bufferedEther = toNum(await pool.getBufferedEther())
      totalSupply = toNum(await pool.totalSupply())

      lastBeaconBalance += beaconBalanceInc
      epoch += 1
      elRewardsWithdrawn += elRewardsToWithdraw
    }

    assert.equal(elRewardsWithdrawn, elRewards)
  })
})
