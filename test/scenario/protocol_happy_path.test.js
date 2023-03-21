const { contract, artifacts, ethers, web3 } = require('hardhat')
const { assert } = require('../helpers/assert')

const { BN } = require('bn.js')
const { getEventArgument, ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const { pad, toBN, ETH, tokens, StETH, shareRate, shares, e27 } = require('../helpers/utils')
const { deployProtocol } = require('../helpers/protocol')
const { setupNodeOperatorsRegistry } = require('../helpers/staking-modules')
const { DSMAttestMessage, DSMPauseMessage } = require('../helpers/signatures')
const { waitBlocks, setBalance, advanceChainTime } = require('../helpers/blockchain')
const { pushOracleReport } = require('../helpers/oracle')
const { INITIAL_HOLDER, MAX_UINT256 } = require('../helpers/constants')
const { signPermit, makeDomainSeparator } = require('../0.4.24/helpers/permit_helpers')
const { ACCOUNTS_AND_KEYS } = require('../0.4.24/helpers/constants')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

const CURATED_MODULE_ID = 1
const TOTAL_BASIS_POINTS = 10 ** 4
const LIDO_INIT_BALANCE_ETH = 1
const ONE_DAY = 1 * 24 * 60 * 60

const NUM_KEYS = 1
// How many validators can this node operator register
const VALIDATORS_LIMIT = 100000000

const DEFAULT_LIDO_ORACLE_REPORT = {
  reportTimestamp: 0, // uint256, seconds
  timeElapsed: 0, // uint256, seconds
  clValidators: 0, // uint256, counter
  postCLBalance: ETH(0), // uint256, wei
  withdrawalVaultBalance: ETH(0), // uint256, wei
  elRewardsVaultBalance: ETH(0), // uint256, wei
  sharesRequestedToBurn: StETH(0), // uint256, wad
  withdrawalFinalizationBatches: [], // uint256, index
  simulatedShareRate: shareRate(0), // uint256, 10e27
}

const setNodeOperator = async (nodeOperatorsRegistry, nodeOperator, voting, id, nobody) => {
  const txn = await nodeOperatorsRegistry.addNodeOperator(nodeOperator.name, nodeOperator.address, { from: voting })

  // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
  nodeOperator.id = getEventArgument(txn, 'NodeOperatorAdded', 'nodeOperatorId', {
    decodeForAbi: NodeOperatorsRegistry._json.abi,
  })
  assert.equals(nodeOperator.id, id, 'operator id')

  assert.equals(await nodeOperatorsRegistry.getNodeOperatorsCount(), id + 1, 'total node operators')

  await nodeOperatorsRegistry.addSigningKeysOperatorBH(
    nodeOperator.id,
    NUM_KEYS,
    nodeOperator.validators[0].key,
    nodeOperator.validators[0].sig,
    {
      from: nodeOperator.address,
    }
  )

  await nodeOperatorsRegistry.setNodeOperatorStakingLimit(id, VALIDATORS_LIMIT, { from: voting })

  // The key was added
  const totalKeys = await nodeOperatorsRegistry.getTotalSigningKeyCount(nodeOperator.id, { from: nobody })
  assert.equals(totalKeys, 1, 'total signing keys')

  // The key was not used yet
  const unusedKeys = await nodeOperatorsRegistry.getUnusedSigningKeyCount(nodeOperator.id, { from: nobody })
  assert.equals(unusedKeys, 1, 'unused signing keys')
}

contract('Lido: protocol happy path', (addresses) => {
  const [
    // node operators
    operator_1,
    operator_2,
    operator_3,
    operator_4,
    // users who deposit Ether to the pool
    user1,
    user2,
    user3,
    // unrelated address
    nobody,
  ] = addresses
  const [alice, bob] = ACCOUNTS_AND_KEYS

  let pool, nodeOperatorsRegistry, token
  let oracle, depositContractMock
  let treasuryAddr, guardians, stakingRouter
  let depositSecurityModule, depositRoot
  let elRewardsVault, voting
  let consensus
  let nodeOperator1, nodeOperator2, nodeOperator3, nodeOperator4
  let withdrawalQueue, burner, withdrawalVault
  let withdrawalSHarePrice

  // Total fee is 1%
  const totalFeePoints = 0.01 * TOTAL_BASIS_POINTS

  const withdrawalCredentials = pad('0x0202', 32)

  before('deploy base stuff', async () => {
    const deployed = await deployProtocol({
      stakingModulesFactory: async (protocol) => {
        const curatedModule = await setupNodeOperatorsRegistry(protocol)
        return [
          {
            module: curatedModule,
            name: 'Curated',
            targetShares: 10000,
            moduleFee: 500,
            treasuryFee: 500,
          },
        ]
      },
    })

    // unlock alice account (allow transactions originated from alice.address)
    await ethers.provider.send('hardhat_impersonateAccount', [alice.address])
    await web3.eth.sendTransaction({ to: alice.address, from: user1, value: ETH(10) })

    // unlock bob account (allow transactions originated from bob.address)
    await ethers.provider.send('hardhat_impersonateAccount', [bob.address])
    await web3.eth.sendTransaction({ to: bob.address, from: user1, value: ETH(3000) })

    // contracts/StETH.sol
    token = deployed.pool

    // contracts/Lido.sol
    pool = deployed.pool

    // contracts/nos/NodeOperatorsRegistry.sol
    nodeOperatorsRegistry = deployed.stakingModules[0]

    // contracts/0.8.9/StakingRouter.sol
    stakingRouter = deployed.stakingRouter

    // contracts/0.8.9/WithdrawalQueueERC721.sol
    withdrawalQueue = deployed.withdrawalQueue

    // contracts/0.8.9/Burner.sol
    burner = deployed.burner

    // mocks
    oracle = deployed.oracle
    depositContractMock = deployed.depositContract
    consensus = deployed.consensusContract

    // addresses
    treasuryAddr = deployed.treasury.address
    depositSecurityModule = deployed.depositSecurityModule
    guardians = deployed.guardians
    elRewardsVault = deployed.elRewardsVault
    voting = deployed.voting.address
    withdrawalVault = deployed.withdrawalVault.address

    depositRoot = await depositContractMock.get_deposit_root()

    assert.equals(await web3.eth.getBalance(elRewardsVault.address), ETH(0), 'Execution layer rewards vault balance')
  })

  it('voting sets withdrawal credentials', async () => {
    const wc = '0x'.padEnd(66, '1234')
    assert.equal(await pool.getWithdrawalCredentials({ from: nobody }), wc, 'withdrawal credentials')

    await stakingRouter.setWithdrawalCredentials(withdrawalCredentials, { from: voting })

    // Withdrawal credentials were set
    assert.equal(
      await stakingRouter.getWithdrawalCredentials({ from: nobody }),
      withdrawalCredentials,
      'withdrawal credentials'
    )
  })

  it('add node operators', async () => {
    // Each node operator has its Ethereum 1 address, a name and a set of registered
    // validators, each of them defined as a (public key, signature) pair

    // NO with 1 validator
    nodeOperator1 = {
      name: 'operator_1',
      address: operator_1,
      validators: [
        {
          key: pad('0x010101', 48),
          sig: pad('0x01', 96),
        },
      ],
    }

    // NO with 1 validator
    nodeOperator2 = {
      name: 'operator_2',
      address: operator_2,
      validators: [
        {
          key: pad('0x020202', 48),
          sig: pad('0x02', 96),
        },
      ],
    }

    await setNodeOperator(nodeOperatorsRegistry, nodeOperator1, voting, 0, nobody)
    await setNodeOperator(nodeOperatorsRegistry, nodeOperator2, voting, 1, nobody)

    const totalNodeOperators = await nodeOperatorsRegistry.getNodeOperatorsCount()
    assert.equals(totalNodeOperators, 2, 'total node operators')

    const addedNodeOperator1 = await nodeOperatorsRegistry.getNodeOperator(0, true)
    assert.equals(addedNodeOperator1.name, 'operator_1', 'node operator 1 name')
    assert.equals(addedNodeOperator1.rewardAddress, operator_1, 'node operator 1 address')

    const addedNodeOperator2 = await nodeOperatorsRegistry.getNodeOperator(1, true)
    assert.equals(addedNodeOperator2.name, 'operator_2', 'node operator 2 name')
    assert.equals(addedNodeOperator2.rewardAddress, operator_2, 'node operator 2 address')
  })

  it('the alice eposits 6 ETH', async () => {
    await web3.eth.sendTransaction({ to: pool.address, from: alice.address, value: ETH(6) })

    const block = await web3.eth.getBlock('latest')
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex
    )
    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]]),
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

    assert.equals(await depositContractMock.totalCalls(), 0)

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 0, 'deposited ether2')
    assert.equals(ether2Stat.beaconBalance, 0, 'remote ether2')

    // All Ether was buffered within the pool contract atm

    assert.equals(await pool.getBufferedEther(), ETH(LIDO_INIT_BALANCE_ETH + 6), 'buffered ether')
    assert.equals(await pool.getTotalPooledEther(), ETH(LIDO_INIT_BALANCE_ETH + 6), 'total pooled ether')

    // The amount of tokens corresponding to the deposited ETH value was minted to the user

    assert.equals(await token.balanceOf(alice.address), tokens(6), 'alice tokens')

    assert.equals(await token.totalSupply(), tokens(LIDO_INIT_BALANCE_ETH + 6), 'token total supply')
  })

  it('the second user deposits 30 ETH', async () => {
    await web3.eth.sendTransaction({ to: pool.address, from: user2, value: ETH(30) })

    const block = await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex
    )
    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]]),
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

    assert.equals(await depositContractMock.totalCalls(), 1)

    const regCall = await depositContractMock.calls.call(0)
    assert.equal(regCall.pubkey, nodeOperator1.validators[0].key)
    assert.equal(regCall.withdrawal_credentials, withdrawalCredentials)
    assert.equal(regCall.signature, nodeOperator1.validators[0].sig)
    assert.equals(regCall.value, ETH(32))

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 1, 'deposited ether2')
    assert.equals(ether2Stat.beaconBalance, 0, 'remote ether2')

    // Some Ether remained buffered within the pool contract

    assert.equals(await pool.getBufferedEther(), ETH(LIDO_INIT_BALANCE_ETH + 6 + 30 - 32), 'buffered ether')
    assert.equals(await pool.getTotalPooledEther(), ETH(LIDO_INIT_BALANCE_ETH + 6 + 30), 'total pooled ether')

    // The amount of tokens corresponding to the deposited ETH value was minted to the users

    assert.equals(await token.balanceOf(alice.address), tokens(6), 'alice tokens')
    assert.equals(await token.balanceOf(user2), tokens(30), 'user2 tokens')

    assert.equals(await token.totalSupply(), tokens(LIDO_INIT_BALANCE_ETH + 6 + 30), 'token total supply')
  })

  it('at this point, the pool has ran out of signing keys', async () => {
    const unusedKeys = await nodeOperatorsRegistry.getUnusedSigningKeyCount(nodeOperator1.id, { from: nobody })
    assert.equals(unusedKeys, 0, 'unused signing keys')
  })

  it('the third user deposits 64 ETH', async () => {
    await web3.eth.sendTransaction({ to: pool.address, from: user3, value: ETH(64) })

    const block = await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex
    )
    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]]),
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
    // using public key and signature of the only validator of the second operator

    assert.equals(await depositContractMock.totalCalls(), 2)

    const regCall = await depositContractMock.calls.call(1)
    assert.equal(regCall.pubkey, nodeOperator2.validators[0].key)
    assert.equal(regCall.withdrawal_credentials, withdrawalCredentials)
    assert.equal(regCall.signature, nodeOperator2.validators[0].sig)
    assert.equals(regCall.value, ETH(32))

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assert.equals(ether2Stat.beaconBalance, 0, 'remote ether2')

    // The pool ran out of validator keys, so the remaining 32 ETH were added to the
    // pool buffer

    // buffered ether = LIDO_INIT_BALANCE_ETH + 6 + 30 - 32 + 64 - 32 = 37
    assert.equals(await pool.getBufferedEther(), ETH(37), 'buffered ether')
    assert.equals(await pool.getTotalPooledEther(), ETH(LIDO_INIT_BALANCE_ETH + 6 + 30 + 64), 'total pooled ether')
  })

  it('the oracle reports balance increase on Ethereum2 side 64 => 64.32', async () => {
    // Total shares are equal to deposited eth before ratio change and fee mint

    const oldTotalShares = await token.getTotalShares()
    assert.equals(oldTotalShares, ETH(LIDO_INIT_BALANCE_ETH + 100), 'total shares')

    // Old total pooled Ether

    const oldTotalPooledEther = await pool.getTotalPooledEther()
    assert.equals(oldTotalPooledEther, ETH(LIDO_INIT_BALANCE_ETH + 6 + 30 + 64), 'total pooled ether')

    // Reporting 1.005-fold balance increase (64 => 64.32) to stay in limits

    await pushOracleReport(consensus, oracle, 2, ETH(64.32), ETH(0))

    // Total shares increased because fee minted (fee shares added)
    // shares = oldTotalShares + reward * totalFee * oldTotalShares / (newTotalPooledEther - reward * totalFee)

    // totalFee = 1000 (10%)
    // reward = 320000000000000000
    // oldTotalShares = 101000000000000000000
    // newTotalPooledEther = 101320000000000000000
    // shares2mint = int(320000000000000000 * 1000 * 101000000000000000000 / (101320000000000000000 * 10000 - 1000 * 320000000000000000))
    // shares2mint ~= 31909011926388124

    const newTotalShares = await token.getTotalShares()
    assert.equals(newTotalShares, '101031909011926388121', 'total shares')

    // Total pooled Ether increased

    const newTotalPooledEther = await pool.getTotalPooledEther()
    assert.equals(newTotalPooledEther, ETH(LIDO_INIT_BALANCE_ETH + 6 + 30 + 64 + 0.32), 'total pooled ether')

    // Ether2 stat reported by the pool changed correspondingly

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assert.equals(ether2Stat.beaconBalance, ETH(64.32), 'remote ether2')

    // Buffered Ether amount didn't change

    // buffered ether = LIDO_INIT_BALANCE_ETH + 6 + 30 - 32 + 64 - 32 = 37
    assert.equals(await pool.getBufferedEther(), ETH(37), 'buffered ether')

    // New tokens was minted to distribute fee
    assert.equals(await token.totalSupply(), tokens(LIDO_INIT_BALANCE_ETH + 6 + 30 + 64 + 0.32), 'token total supply')

    const reward = toBN(ETH(64.32 - 64))
    const mintedAmount = new BN(totalFeePoints).mul(reward).divn(10000)

    // Token user balances increased

    // rewards = 350000000000000000
    // alice shares = 6
    // user2 shares = 30
    // user3 shares = 64

    // INITIAL_HOLDER balance = ETH(1) + 320000000000000000 * 0.9 * 1/101 = ~1002851485148514851
    // alice balance = ETH(6) + 320000000000000000 * 0.9 * 6/101 = ~6017108910891089108
    // user2 balance = ETH(30) + 320000000000000000 * 0.9 * 30/101 = ~32576020408163265306
    // user3 balance = ETH(64) + 320000000000000000 * 0.9 * 64/101 = ~64182495049504950495

    assert.equals(await token.balanceOf(INITIAL_HOLDER), '1002851485148514851', 'initial holder tokens')
    assert.equals(await token.balanceOf(alice.address), '6017108910891089108', 'alice tokens')
    assert.equals(await token.balanceOf(user2), '30085544554455445544', 'user2 tokens')
    assert.equals(await token.balanceOf(user3), '64182495049504950495', 'user3 tokens')

    // Fee, in the form of minted tokens, was distributed between treasury, insurance fund
    // and node operators
    // treasuryTokenBalance ~= mintedAmount * treasuryFeePoints / 10000
    assert.equalsDelta(await token.balanceOf(treasuryAddr), '16000000000000000', 1, 'treasury tokens')
    assert.equalsDelta(await token.balanceOf(nodeOperatorsRegistry.address), 0, 1, 'staking module tokens')

    // The node operators' fee is distributed between all active node operators,
    // proportional to their effective stake (the amount of Ether staked by the operator's
    // used and non-stopped validators).
    //
    // In our case, both node operators received the same fee since they have the same
    // effective stake (one signing key used from each operator, staking 32 ETH)

    assert.equalsDelta(await token.balanceOf(nodeOperator1.address), '8000000000000000', 1, 'operator_1 tokens')
    assert.equalsDelta(await token.balanceOf(nodeOperator2.address), '8000000000000000', 1, 'operator_2 tokens')

    // Real minted amount should be a bit less than calculated caused by round errors on mint and transfer operations
    assert(
      mintedAmount
        .sub(
          new BN(0)
            .add(await token.balanceOf(treasuryAddr))
            .add(await token.balanceOf(nodeOperator1.address))
            .add(await token.balanceOf(nodeOperator2.address))
        )
        .lt(mintedAmount.divn(100))
    )
  })

  it('alice requests max own amount of withdrawal', async () => {
    await advanceChainTime(ONE_DAY)

    assert.isFalse(await withdrawalQueue.isPaused())
    assert.equals(await withdrawalQueue.unfinalizedRequestNumber(), 0)

    const balanceBufferBefore = await pool.getBufferedEther()
    const shareTotalBefore = await token.getTotalShares()
    const totalPooledBefore = await token.getTotalPooledEther()

    const balanceAliceBefore = await token.balanceOf(alice.address)
    const sharesAliceBefore = await token.sharesOf(alice.address)

    console.log('balanceAliceBefore', +balanceAliceBefore, +(await token.sharesOf(alice.address)))

    const nonce = 0
    const { name, version, chainId, verifyingContract } = await token.eip712Domain()
    const domainSeparator = makeDomainSeparator(name, version, chainId, verifyingContract)

    const { v, r, s } = signPermit(
      alice.address,
      withdrawalQueue.address,
      balanceAliceBefore.toString(),
      nonce,
      MAX_UINT256,
      domainSeparator,
      alice.key
    )

    const receipt = await withdrawalQueue.requestWithdrawalsWithPermit(
      [balanceAliceBefore.toString()],
      alice.address,
      { value: balanceAliceBefore.toString(), deadline: MAX_UINT256, v, r, s },
      {
        from: alice.address,
      }
    )
    const requestId = getEventArgument(receipt, 'WithdrawalRequested', 'requestId')
    const requestor = getEventArgument(receipt, 'WithdrawalRequested', 'requestor')
    const owner = getEventArgument(receipt, 'WithdrawalRequested', 'owner')
    const amountOfStETH = getEventArgument(receipt, 'WithdrawalRequested', 'amountOfStETH')
    const amountOfShares = getEventArgument(receipt, 'WithdrawalRequested', 'amountOfShares')

    assert.equals(requestId, 1, 'request id')
    assert.equals(requestor, alice.address, 'request requestor')
    assert.equals(owner, alice.address, 'request owner')
    assert.equals(amountOfStETH, balanceAliceBefore.toString(), 'request amountOfStETH')
    assert.almostEqual(
      amountOfShares,
      sharesAliceBefore.toString(),
      StETH('0.000000000000000001'),
      'request amountOfShares'
    )

    assert.equals(await withdrawalQueue.unfinalizedStETH(), balanceAliceBefore)
    assert.equals(await withdrawalQueue.unfinalizedRequestNumber(), 1)

    assert.equals(await pool.getBufferedEther(), balanceBufferBefore, 'buffer balance after request')
    assert.equals(await token.getTotalShares(), shareTotalBefore, 'total shares after request')
    assert.equals(await token.getTotalPooledEther(), totalPooledBefore, 'pool balance after request')
  })

  it('alice info after request withdrawal', async () => {
    const sharePrice = await token.getPooledEthByShares(shares(1))

    const balanceAliceAfter = await token.balanceOf(alice.address)
    const sharesAliceAfter = await token.sharesOf(alice.address)
    const aliceRequests = await withdrawalQueue.getWithdrawalRequests(alice.address)
    const requestsStatuses = await withdrawalQueue.getWithdrawalStatus(aliceRequests)

    const aliceRequest = requestsStatuses[0]

    // NFT owner
    assert.equals(await withdrawalQueue.ownerOf(1), alice.address, 'owner of request')
    // infinalized request number
    assert.equals(await withdrawalQueue.unfinalizedRequestNumber(), 1)
    // count alice requests
    assert.equals(aliceRequests, [1])

    assert.equals(aliceRequest.owner, alice.address, 'request owner')
    assert.equals(aliceRequest.isFinalized, false, 'request not finalized')
    assert.equals(aliceRequest.isClaimed, false, 'request not claimed')
    // TODO: why 0.000000000000000002
    assert.almostEqual(
      aliceRequest.amountOfStETH,
      toBN(6).mul(toBN(sharePrice)),
      StETH('0.000000000000000002'),
      'request amountOfStETH'
    )
    assert.almostEqual(aliceRequest.amountOfShares, StETH(6), StETH('0.000000000000000001'), 'request amountOfShares')

    assert.almostEqual(balanceAliceAfter, 0, StETH('0.000000000000000001'), 'alice balance after request')
    assert.almostEqual(sharesAliceAfter, 0, StETH('0.000000000000000001'), 'alice shares after request')
  })

  it('reports withdrawal', async () => {
    await setBalance(withdrawalVault, ETH(32))

    await advanceChainTime(ONE_DAY)

    const elRewardsVaultBalance = await web3.eth.getBalance(elRewardsVault.address)
    const totalSharesBefore = await token.getTotalShares()
    const balanceBufferBefore = await token.getBufferedEther()
    const totalPooledBefore = await token.getTotalPooledEther()
    withdrawalSHarePrice = await token.getPooledEthByShares(shares(1))

    const [postTotalPooledEther, postTotalShares, ,] = await token.handleOracleReport.call(
      ...Object.values({
        ...DEFAULT_LIDO_ORACLE_REPORT,
        timeElapsed: ONE_DAY,
        clValidators: 2,
        postCLBalance: ETH(64.32),
        elRewardsVaultBalance: ETH(0),
        withdrawalVaultBalance: ETH(0),
      }),
      { from: oracle.address, gasPrice: 1 }
    )

    const simulatedShareRate = postTotalPooledEther.mul(toBN(shareRate(1))).div(postTotalShares)

    const { coverShares, nonCoverShares } = await burner.getSharesRequestedToBurn()
    const sharesRequestedToBurn = coverShares.add(nonCoverShares)
    console.log('+sharesRequestedToBurn', +sharesRequestedToBurn)

    const reportAfterWithdrawal = {
      timeElapsed: ONE_DAY,
      postCLBalance: ETH(64.32),
      sharesRequestedToBurn,
      withdrawalFinalizationBatches: [1], // uint256[], indexes
      elRewardsVaultBalance,
      simulatedShareRate,
    }

    await pushOracleReport(consensus, oracle, 2, ETH(64.32), 0, reportAfterWithdrawal)

    const totalSharesAfter = await token.getTotalShares()
    const balanceBufferAfter = await token.getBufferedEther()
    const totalPooledAfter = await token.getTotalPooledEther()

    assert.almostEqual(
      totalSharesAfter,
      totalSharesBefore.sub(toBN(StETH(6))),
      StETH('0.000000000000000001'),
      'total shares after request'
    )
    assert.almostEqual(
      balanceBufferAfter,
      balanceBufferBefore.sub(toBN(6).mul(toBN(withdrawalSHarePrice))),
      StETH('0.000000000000000001'),
      'buffer balance after request'
    )
    assert.almostEqual(
      totalPooledAfter,
      totalPooledBefore.sub(toBN(6).mul(toBN(withdrawalSHarePrice))),
      StETH('0.000000000000000001'),
      'pool balance after request'
    )
    assert.equals(await withdrawalQueue.getLastFinalizedRequestId(), toBN(1))
  })

  it('alice after withdrawals report info', async () => {
    const balanceAlice = await token.balanceOf(alice.address)
    const sharesAlice = await token.sharesOf(alice.address)
    const aliceRequests = await withdrawalQueue.getWithdrawalRequests(alice.address)
    const requestsStatuses = await withdrawalQueue.getWithdrawalStatus(aliceRequests)

    const aliceRequest = requestsStatuses[0]

    // NFT owner
    assert.equals(await withdrawalQueue.ownerOf(1), alice.address, 'owner of request')
    // infinalized request number
    assert.equals(await withdrawalQueue.unfinalizedRequestNumber(), 0, 'unfinalized request number')
    // count alice requests
    assert.equals(aliceRequests, [1], 'alice requests')

    assert.equals(aliceRequest.owner, alice.address, 'request owner')
    assert.equals(aliceRequest.isFinalized, true, 'request not finalized')
    assert.equals(aliceRequest.isClaimed, false, 'request not claimed')
    // TODO: why 0.000000000000000002
    assert.almostEqual(
      aliceRequest.amountOfStETH,
      toBN(6).mul(toBN(withdrawalSHarePrice)),
      StETH('0.000000000000000002'),
      'request amountOfStETH'
    )
    assert.almostEqual(aliceRequest.amountOfShares, StETH(6), StETH('0.000000000000000001'), 'request amountOfShares')

    assert.almostEqual(balanceAlice, 0, StETH('0.000000000000000001'), 'alice balance after request')
    assert.almostEqual(sharesAlice, 0, StETH('0.000000000000000001'), 'alice shares after request')
  })

  it('report without withdrawal', async () => {
    await advanceChainTime(ONE_DAY)

    await pushOracleReport(consensus, oracle, 2, ETH(64.32), 0)
  })

  it('alice claims withdrawal', async () => {
    const aliceEthBalanceBefore = await web3.eth.getBalance(alice.address)
    const aliceRequestsBefore = await withdrawalQueue.getWithdrawalRequests(alice.address)

    // NFT owner before
    assert.equals(await withdrawalQueue.ownerOf(1), alice.address, 'owner of request')
    // count alice requests
    assert.equals(aliceRequestsBefore, [1], 'alice requests')
    // alice eth balance before ~(balance - gas cost)
    assert.equals(aliceEthBalanceBefore, '3999908707000000000', 'alice eth balance before')

    const lastCheckpointIndex = await withdrawalQueue.getLastCheckpointIndex()
    const aliceHints = await withdrawalQueue.findCheckpointHints([1], 1, lastCheckpointIndex)

    const tx = await withdrawalQueue.claimWithdrawals([1], aliceHints, { from: alice.address, gasPrice: 1 })
    const aliceEthBalanceAfter = await web3.eth.getBalance(alice.address)
    const aliceRequestsAfter = await withdrawalQueue.getWithdrawalRequests(alice.address)

    // NFT owner after
    await assert.reverts(withdrawalQueue.ownerOf(1), 'RequestAlreadyClaimed(1)')
    // count alice requests
    assert.equals(aliceRequestsAfter, [], 'alice requests')
    // alice eth balance after ~(balance - gas cost)
    assert.almostEqual(
      aliceEthBalanceAfter,
      toBN(aliceEthBalanceBefore).add(toBN(6).mul(toBN(withdrawalSHarePrice))),
      tx.receipt.gasUsed
    )

    console.log('pool.getBufferedEther()', +(await pool.getBufferedEther()), +(await token.getTotalShares()))
  })

  it('add 2 more operators', async () => {
    // NO with 1 validator
    nodeOperator3 = {
      name: 'operator_3',
      address: operator_3,
      validators: [
        {
          key: pad('0x030303', 48),
          sig: pad('0x03', 96),
        },
      ],
    }

    // NO with 1 validator
    nodeOperator4 = {
      name: 'operator_4',
      address: operator_4,
      validators: [
        {
          key: pad('0x040404', 48),
          sig: pad('0x04', 96),
        },
      ],
    }

    await setNodeOperator(nodeOperatorsRegistry, nodeOperator3, voting, 2, nobody)
    await setNodeOperator(nodeOperatorsRegistry, nodeOperator4, voting, 3, nobody)

    const totalNodeOperators = await nodeOperatorsRegistry.getNodeOperatorsCount()
    assert.equals(totalNodeOperators, 4, 'total node operators')

    const addedNodeOperator3 = await nodeOperatorsRegistry.getNodeOperator(2, true)
    assert.equals(addedNodeOperator3.name, 'operator_3', 'node operator 3 name')
    assert.equals(addedNodeOperator3.rewardAddress, operator_3, 'node operator 1 address')

    const addedNodeOperator4 = await nodeOperatorsRegistry.getNodeOperator(3, true)
    assert.equals(addedNodeOperator4.name, 'operator_4', 'node operator 3 name')
    assert.equals(addedNodeOperator4.rewardAddress, operator_4, 'node operator 4 address')
  })

  it('bob deposits 2000 ETH and alice deposits 10 ETH', async () => {
    const sharePrice = await token.getPooledEthByShares(shares(1))
    await token.submit(ZERO_ADDRESS, { from: bob.address, value: ETH(2000) })
    await token.submit(ZERO_ADDRESS, { from: alice.address, value: ETH(10) })

    const block = await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex
    )
    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]]),
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

    assert.equals(await depositContractMock.totalCalls(), 4)

    const regCall = await depositContractMock.calls.call(3)
    assert.equal(regCall.pubkey, nodeOperator4.validators[0].key)
    assert.equal(regCall.withdrawal_credentials, withdrawalCredentials)
    assert.equal(regCall.signature, nodeOperator4.validators[0].sig)
    assert.equals(regCall.value, ETH(32))

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 4, 'deposited ether2')
    assert.equals(ether2Stat.beaconBalance, ETH(64.32), 'remote ether2')

    // buffered ether = LIDO_INIT_BALANCE_ETH + 6 + 30 - 32 + 64 - 32 - 6.017...(withdrawals alice) + 2000 - 10 - 32 - 32
    // ~= 1976.982891089108910893
    assert.almostEqual(
      await pool.getBufferedEther(),
      toBN(ETH(1983)).sub(toBN(6).mul(toBN(withdrawalSHarePrice))),
      StETH('0.000000000000000001'),
      'buffered ether'
    )

    const bobSharesCalculated = toBN(e27(StETH(2000)))
      .div(toBN(sharePrice))
      .div(toBN(1000000000))
    const aliceSharesCalculated = toBN(e27(StETH(10)))
      .div(toBN(sharePrice))
      .div(toBN(1000000000))
    const bobShares = await token.sharesOf(bob.address)
    const aliceShares = await token.sharesOf(alice.address)

    // totalSHares before withdrawals = 101031909011926388121
    assert.almostEqual(
      await pool.getTotalShares(),
      toBN('101031909011926388121')
        .sub(toBN(StETH(6)))
        .add(bobShares)
        .add(aliceShares),
      StETH('0.000000000000000001'),
      'total shares'
    )
    assert.almostEqual(
      await pool.getTotalShares(),
      toBN('101031909011926388121')
        .sub(toBN(StETH(6)))
        .add(bobSharesCalculated)
        .add(aliceSharesCalculated),
      StETH('0.000000000000001000'),
      'total shares calculated'
    )

    assert(
      await token.getTotalPooledEther(),
      toBN(ETH(LIDO_INIT_BALANCE_ETH + 6 + 30 + 64 + 0.32 + 2000 + 10)).sub(toBN(6).mul(toBN(withdrawalSHarePrice))),
      'total pooled ether'
    )
  })
})
