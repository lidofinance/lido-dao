const { assert } = require('chai')
const { BN } = require('bn.js')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { getEventArgument } = require('@aragon/contract-helpers-test')

const { pad, toBN, ETH, tokens } = require('../helpers/utils')
const { deployDaoAndPool } = require('./helpers/deploy')

const { DSMAttestMessage, DSMPauseMessage } = require('../0.8.9/helpers/signatures')
const { waitBlocks } = require('../helpers/blockchain')

const RewardEmulatorMock = artifacts.require('RewardEmulatorMock.sol')

const INodeOperatorsRegistry = artifacts.require('contracts/0.4.24/interfaces/INodeOperatorsRegistry.sol:INodeOperatorsRegistry')

const TOTAL_BASIS_POINTS = 10**4
const MAX_POSITIVE_REBASE_PRECISION_POINTS = 10**9
const CURATED_MODULE_ID = 1

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

  let pool, nodeOperatorsRegistry, token
  let oracleMock, depositContractMock
  let treasuryAddr, guardians
  let depositSecurityModule, depositRoot
  let rewarder, elRewardsVault

  // Total fee is 1%
  const totalFeePoints = 0.01 * TOTAL_BASIS_POINTS

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
    nodeOperatorsRegistry = deployed.nodeOperatorsRegistry

    // contracts/0.8.9/StakingRouter.sol
    stakingRouter = deployed.stakingRouter

    // mocks
    oracleMock = deployed.oracleMock
    depositContractMock = deployed.depositContractMock

    // addresses
    treasuryAddr = deployed.treasuryAddr
    depositSecurityModule = deployed.depositSecurityModule
    guardians = deployed.guardians
    elRewardsVault = deployed.elRewardsVault

    depositRoot = await depositContractMock.get_deposit_root()

    rewarder = await RewardEmulatorMock.new(elRewardsVault.address)

    assertBn(await web3.eth.getBalance(rewarder.address), ETH(0), 'rewarder balance')
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(0), 'Execution layer rewards vault balance')
    await stakingRouter.setWithdrawalCredentials(withdrawalCredentials, { from: voting })

    // Withdrawal credentials were set
    assert.equal(await stakingRouter.getWithdrawalCredentials({ from: nobody }), withdrawalCredentials, 'withdrawal credentials')

    // How many validators can this node operator register
    const validatorsLimit = 100000000
    let txn = await nodeOperatorsRegistry.addNodeOperator(nodeOperator1.name, nodeOperator1.address, { from: voting })

    // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
    nodeOperator1.id = getEventArgument(txn, 'NodeOperatorAdded', 'id', { decodeForAbi: INodeOperatorsRegistry._json.abi })
    assertBn(nodeOperator1.id, 0, 'operator id')

    assertBn(await nodeOperatorsRegistry.getNodeOperatorsCount(), 1, 'total node operators')

    const numKeys = 1

    await nodeOperatorsRegistry.addSigningKeysOperatorBH(
      nodeOperator1.id,
      numKeys,
      nodeOperator1.validators[0].key,
      nodeOperator1.validators[0].sig,
      {
        from: nodeOperator1.address
      }
    )

    await nodeOperatorsRegistry.setNodeOperatorStakingLimit(0, validatorsLimit, { from: voting })

    // The key was added

    let totalKeys = await nodeOperatorsRegistry.getTotalSigningKeyCount(nodeOperator1.id, { from: nobody })
    assertBn(totalKeys, 1, 'total signing keys')

    // The key was not used yet

    let unusedKeys = await nodeOperatorsRegistry.getUnusedSigningKeyCount(nodeOperator1.id, { from: nobody })
    assertBn(unusedKeys, 1, 'unused signing keys')

    txn = await nodeOperatorsRegistry.addNodeOperator(nodeOperator2.name, nodeOperator2.address, { from: voting })

    // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
    nodeOperator2.id = getEventArgument(txn, 'NodeOperatorAdded', 'id', { decodeForAbi: INodeOperatorsRegistry._json.abi })
    assertBn(nodeOperator2.id, 1, 'operator id')

    assertBn(await nodeOperatorsRegistry.getNodeOperatorsCount(), 2, 'total node operators')

    await nodeOperatorsRegistry.addSigningKeysOperatorBH(
      nodeOperator2.id,
      numKeys,
      nodeOperator2.validators[0].key,
      nodeOperator2.validators[0].sig,
      {
        from: nodeOperator2.address
      }
    )

    await nodeOperatorsRegistry.setNodeOperatorStakingLimit(1, validatorsLimit, { from: voting })

    // The key was added

    totalKeys = await nodeOperatorsRegistry.getTotalSigningKeyCount(nodeOperator2.id, { from: nobody })
    assertBn(totalKeys, 1, 'total signing keys')

    // The key was not used yet
    unusedKeys = await nodeOperatorsRegistry.getUnusedSigningKeyCount(nodeOperator2.id, { from: nobody })
    assertBn(unusedKeys, 1, 'unused signing keys')
  })

  it('the first user deposits 3 ETH to the pool', async () => {
    await web3.eth.sendTransaction({ to: pool.address, from: user1, value: ETH(3) })
    const block = await web3.eth.getBlock('latest')
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(block.number, block.hash, depositRoot, CURATED_MODULE_ID, keysOpIndex)
    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]])
    ]
    await depositSecurityModule.depositBufferedEther(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex,
      '0x',
      signatures
    )

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
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(block.number, block.hash, depositRoot, CURATED_MODULE_ID, keysOpIndex)
    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]])
    ]
    await depositSecurityModule.depositBufferedEther(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex,
      '0x',
      signatures
    )

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
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(block.number, block.hash, depositRoot, CURATED_MODULE_ID, keysOpIndex)
    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]])
    ]

    assertBn(await depositContractMock.totalCalls(), 1)
    await depositSecurityModule.depositBufferedEther(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex,
      '0x',
      signatures
    )

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
    //
    // totalFee = 1000 (10%)
    // reward = 41000000000000000000
    // oldTotalShares = 97000000000000000000
    // newTotalPooledEther = 138000000000000000000
    // shares2mint = int(41000000000000000000 * 1000 * 97000000000000000000 / (138000000000000000000 * 10000 - 1000 * 41000000000000000000 ))
    // shares2mint ~= 2970126960418222592

    const newTotalShares = await token.getTotalShares()

    assertBn(newTotalShares, new BN('99970126960418222554'), 'total shares')

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
    assertBn(await token.balanceOf(user1), new BN('4141237113402061855'), 'user1 tokens')
    assertBn(await token.balanceOf(user2), new BN('41412371134020618556'), 'user2 tokens')
    assertBn(await token.balanceOf(user3), new BN('88346391752577319587'), 'user3 tokens')

    // Fee, in the form of minted tokens, was distributed between treasury, insurance fund
    // and node operators
    // treasuryTokenBalance ~= mintedAmount * treasuryFeePoints / 10000
    // insuranceTokenBalance ~= mintedAmount * insuranceFeePoints / 10000
    assertBn(await token.balanceOf(treasuryAddr), new BN('2049999999999999999'), 'treasury tokens')

    // Module fee, rewards distribution between modules should be make by module
    assertBn(await token.balanceOf(nodeOperatorsRegistry.address), new BN('2049999999999999999'), 'module1 tokens')

    // Real minted amount should be a bit less than calculated caused by round errors on mint and transfer operations
    assert(
      mintedAmount
        .sub(new BN(0).add(await token.balanceOf(treasuryAddr)).add(await token.balanceOf(nodeOperatorsRegistry.address)))
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
    assertBn(oldTotalShares, new BN('99970126960418222554'), 'total shares')

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

    assertBn(await token.balanceOf(user1), new BN('4351299865531151949'), 'user1 tokens')
    assertBn(await token.balanceOf(user2), new BN('43512998655311519498'), 'user2 tokens')
    assertBn(await token.balanceOf(user3), new BN('92827730464664574929'), 'user3 tokens')

    assertBn(await token.balanceOf(treasuryAddr), new BN('2153985507246376811'), 'treasury tokens')
    assertBn(await token.balanceOf(nodeOperatorsRegistry.address), new BN('2153985507246376811'), 'module1 tokens')

    // operators do not claim rewards from module
    assertBn(await token.balanceOf(nodeOperator1.address), 0, 'operator_1 tokens')
    assertBn(await token.balanceOf(nodeOperator2.address), 0, 'operator_2 tokens')
  })

  it('collect another 5 ETH execution layer rewards to the vault', async () => {
    await rewarder.reward({ from: userELRewards, value: ETH(5) })
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(5), 'Execution layer rewards vault balance')
  })

  it('the oracle reports loss on Ethereum2 side (-2 ETH) and claims collected execution layer rewards (+5 ETH)', async () => {
    const epoch = 102

    // Total shares are equal to deposited eth before ratio change and fee mint
    const oldTotalShares = await token.getTotalShares()
    assertBn(oldTotalShares, new BN('99970126960418222554'), 'total shares')

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

    assertBn(await token.balanceOf(user1), new BN('4441326759300761990'), 'user1 tokens')
    assertBn(await token.balanceOf(user2), new BN('44413267593007619901'), 'user2 tokens')
    assertBn(await token.balanceOf(user3), new BN('94748304198416255789'), 'user3 tokens')

    assertBn(await token.balanceOf(treasuryAddr), new BN('2198550724637681159'), 'treasury tokens')
    assertBn(await token.balanceOf(nodeOperatorsRegistry.address), new BN('2198550724637681159'), 'module1 tokens')
  })

  it('collect another 3 ETH execution layer rewards to the vault', async () => {
    await rewarder.reward({ from: userELRewards, value: ETH(3) })
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(3), 'Execution layer rewards vault balance')
  })

  it('the oracle reports loss on Ethereum2 side (-3 ETH) and claims collected execution layer rewards (+3 ETH)', async () => {
    const epoch = 103

    // Total shares are equal to deposited eth before ratio change and fee mint
    const oldTotalShares = await token.getTotalShares()
    assertBn(oldTotalShares, new BN('99970126960418222554'), 'total shares')

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
    assertBn(await token.balanceOf(user1), new BN('4441326759300761990'), 'user1 tokens')
    assertBn(await token.balanceOf(user2), new BN('44413267593007619901'), 'user2 tokens')
    assertBn(await token.balanceOf(user3), new BN('94748304198416255789'), 'user3 tokens')

    assertBn(await token.balanceOf(treasuryAddr), new BN('2198550724637681159'), 'treasury tokens')
    assertBn(await token.balanceOf(nodeOperatorsRegistry.address), new BN('2198550724637681159'), 'module1 tokens')
  })

  it('collect another 2 ETH execution layer rewards to the vault', async () => {
    await rewarder.reward({ from: userELRewards, value: ETH(2) })
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(2), 'Execution layer rewards vault balance')
  })

  it('the oracle reports loss on Ethereum2 side (-8 ETH) and claims collected execution layer rewards (+2 ETH)', async () => {
    const epoch = 104

    // Total shares are equal to deposited eth before ratio change and fee mint
    const oldTotalShares = await token.getTotalShares()
    assertBn(oldTotalShares, new BN('99970126960418222554'), 'total shares')

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
    assertBn(await token.balanceOf(user1), new BN('4261272971761541909'), 'user1 tokens')
    assertBn(await token.balanceOf(user2), new BN('42612729717615419094'), 'user2 tokens')
    assertBn(await token.balanceOf(user3), new BN('90907156730912894068'), 'user3 tokens')

    assertBn(await token.balanceOf(treasuryAddr), new BN('2109420289855072463'), 'treasury tokens')
    assertBn(await token.balanceOf(nodeOperatorsRegistry.address), new BN('2109420289855072463'), 'module1 tokens')
    assertBn(await token.balanceOf(nodeOperator1.address), 0, 'operator_1 tokens')
    assertBn(await token.balanceOf(nodeOperator2.address), 0, 'operator_2 tokens')
  })

  it('collect another 3 ETH execution layer rewards to the vault', async () => {
    await rewarder.reward({ from: userELRewards, value: ETH(3) })
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(3), 'Execution layer vault balance')
  })

  it('the oracle reports balance increase on Ethereum2 side (+2 ETH) and claims collected execution layer rewards (+3 ETH)', async () => {
    const epoch = 105

    // Total shares are equal to deposited eth before ratio change and fee mint
    const oldTotalShares = await token.getTotalShares()
    assertBn(oldTotalShares, new BN('99970126960418222554'), 'total shares')

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
    assertBn(newTotalShares, new BN('100311321932979376897'), 'total shares')

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
    assertBn(await token.balanceOf(user1), new BN('4396313312415956969'), 'user1 tokens')
    assertBn(await token.balanceOf(user2), new BN('43963133124159569699'), 'user2 tokens')
    assertBn(await token.balanceOf(user3), new BN('93788017331540415359'), 'user3 tokens')

    // Fee, in the form of minted tokens, was distributed between treasury, insurance fund
    // and node operators
    // treasuryTokenBalance = (oldTreasuryShares + mintedRewardShares * treasuryFeePoints / 10000) * sharePrice
    assertBn((await token.balanceOf(treasuryAddr)).divn(10), new BN('242626811594202898'), 'treasury tokens')
    assertBn((await token.balanceOf(nodeOperatorsRegistry.address)).divn(10), new BN('242626811594202898'), 'module1 tokens')
  })

  it('collect 0.1 ETH execution layer rewards to elRewardsVault and withdraw it entirely by means of multiple oracle reports (+1 ETH)', async () => {
    // Specify different withdrawal limits for a few epochs to test different values
    const getMaxPositiveRebaseForEpoch = (_epoch) => {
      let ret = 0

      if (_epoch === 106) {
        ret = toBN(2)
      } else if (_epoch === 107) {
        ret = toBN(1)
      } else {
        ret = toBN(3)
      }

      return ret.mul(toBN(MAX_POSITIVE_REBASE_PRECISION_POINTS / TOTAL_BASIS_POINTS))
    }

    const elRewards = ETH(0.1)
    await rewarder.reward({ from: userELRewards, value: elRewards })
    assertBn(await web3.eth.getBalance(elRewardsVault.address), elRewards, 'Execution layer rewards vault balance')

    let epoch = 106
    let lastBeaconBalance = toBN(ETH(85))
    await pool.setMaxPositiveTokenRebase(getMaxPositiveRebaseForEpoch(epoch), { from: voting })

    let maxPositiveRebase = await pool.getMaxPositiveTokenRebase()
    let elRewardsVaultBalance = toBN(await web3.eth.getBalance(elRewardsVault.address))
    let totalPooledEther = await pool.getTotalPooledEther()
    let bufferedEther = await pool.getBufferedEther()
    let totalSupply = await pool.totalSupply()
    const beaconBalanceInc = toBN(ETH(0.001))
    let elRewardsWithdrawn = toBN(0)

    // Do multiple oracle reports to withdraw all ETH from execution layer rewards vault
    while (elRewardsVaultBalance > 0) {
      const maxPositiveRebaseCalculated = getMaxPositiveRebaseForEpoch(epoch)
      await pool.setMaxPositiveTokenRebase(maxPositiveRebaseCalculated, { from: voting })
      maxPositiveRebase = await pool.getMaxPositiveTokenRebase()
      const clIncurredRebase = beaconBalanceInc.mul(toBN(MAX_POSITIVE_REBASE_PRECISION_POINTS)).div(totalPooledEther)

      const maxELRewardsAmountPerWithdrawal = totalPooledEther.mul(
        maxPositiveRebase.sub(clIncurredRebase)
      ).div(toBN(MAX_POSITIVE_REBASE_PRECISION_POINTS))

      const elRewardsToWithdraw = BN.min(maxELRewardsAmountPerWithdrawal, elRewardsVaultBalance)

      // Reporting balance increase
      await oracleMock.reportBeacon(epoch, 2, lastBeaconBalance.add(beaconBalanceInc))

      assertBn(
        await web3.eth.getBalance(elRewardsVault.address),
        elRewardsVaultBalance.sub(elRewardsToWithdraw),
        'Execution layer rewards vault balance'
      )

      assertBn(await pool.getTotalPooledEther(), totalPooledEther.add(beaconBalanceInc).add(elRewardsToWithdraw), 'total pooled ether')
      assertBn(await pool.totalSupply(), totalSupply.add(beaconBalanceInc).add(elRewardsToWithdraw), 'token total supply')
      assertBn(await pool.getBufferedEther(), bufferedEther.add(elRewardsToWithdraw), 'buffered ether')

      elRewardsVaultBalance = toBN(await web3.eth.getBalance(elRewardsVault.address))
      totalPooledEther = await pool.getTotalPooledEther()
      bufferedEther = await pool.getBufferedEther()
      totalSupply = await pool.totalSupply()

      lastBeaconBalance = lastBeaconBalance.add(beaconBalanceInc)
      elRewardsWithdrawn = elRewardsWithdrawn.add(elRewardsToWithdraw)

      epoch += 1
    }

    assertBn(elRewardsWithdrawn, elRewards)
  })
})
