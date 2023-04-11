const { contract, artifacts, web3 } = require('hardhat')
const { assert } = require('../helpers/assert')
const { BN } = require('bn.js')
const { getEventArgument } = require('@aragon/contract-helpers-test')

const { pad, toBN, ETH, tokens, hexConcat } = require('../helpers/utils')

const { DSMAttestMessage, DSMPauseMessage } = require('../helpers/signatures')
const { waitBlocks } = require('../helpers/blockchain')
const { deployProtocol } = require('../helpers/protocol')
const { setupNodeOperatorsRegistry } = require('../helpers/staking-modules')
const { pushOracleReport } = require('../helpers/oracle')
const { INITIAL_HOLDER } = require('../helpers/constants')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')
const CURATED_MODULE_ID = 1
const TOTAL_BASIS_POINTS = 10000
const CURATED_MODULE_MODULE_FEE = 500
const CURATED_MODULE_TREASURY_FEE = 500

// Fee and its distribution are in basis points, 10000 corresponding to 100%
// Total fee is 10%
const totalFeePoints = 0.1 * TOTAL_BASIS_POINTS

contract('Lido: happy path', (addresses) => {
  const [
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
  ] = addresses

  let pool, nodeOperatorsRegistry, token
  let oracle, depositContractMock
  let treasuryAddr, guardians, voting
  let depositSecurityModule, depositRoot
  let withdrawalCredentials, stakingRouter
  let consensus

  before(
    'DAO, node operators registry, token, pool and deposit security module are deployed and initialized',
    async () => {
      const deployed = await deployProtocol({
        stakingModulesFactory: async (protocol) => {
          const curatedModule = await setupNodeOperatorsRegistry(protocol, true)
          return [
            {
              module: curatedModule,
              name: 'Curated',
              targetShares: 10000,
              moduleFee: CURATED_MODULE_MODULE_FEE,
              treasuryFee: CURATED_MODULE_TREASURY_FEE,
            },
          ]
        },
      })

      // contracts/StETH.sol
      token = deployed.pool

      // contracts/Lido.sol
      pool = deployed.pool

      // contracts/nos/NodeOperatorsRegistry.sol
      nodeOperatorsRegistry = deployed.stakingModules[0]

      // contracts/0.8.9/StakingRouter.sol
      stakingRouter = deployed.stakingRouter

      // mocks
      oracle = deployed.oracle
      depositContractMock = deployed.depositContract
      consensus = deployed.consensusContract

      // addresses
      treasuryAddr = deployed.treasury.address
      depositSecurityModule = deployed.depositSecurityModule
      guardians = deployed.guardians
      voting = deployed.voting.address

      depositRoot = await depositContractMock.get_deposit_root()
      withdrawalCredentials = '0x'.padEnd(66, '1234')

      await stakingRouter.setWithdrawalCredentials(withdrawalCredentials, { from: voting })
    }
  )

  it('voting sets withdrawal credentials', async () => {
    const wc = '0x'.padEnd(66, '1234')
    assert.equal(await pool.getWithdrawalCredentials({ from: nobody }), wc, 'withdrawal credentials')

    withdrawalCredentials = '0x'.padEnd(66, '5678')
    await stakingRouter.setWithdrawalCredentials(withdrawalCredentials, { from: voting })

    // Withdrawal credentials were set

    assert.equal(
      await stakingRouter.getWithdrawalCredentials({ from: nobody }),
      withdrawalCredentials,
      'withdrawal credentials'
    )
  })

  // Each node operator has its Ethereum 1 address, a name and a set of registered
  // validators, each of them defined as a (public key, signature) pair
  const nodeOperator1 = {
    name: 'operator_1',
    address: operator_1,
    validators: [
      {
        key: pad('0x010101', 48),
        sig: pad('0x01', 96),
      },
    ],
  }

  it('voting adds the first node operator', async () => {
    const txn = await nodeOperatorsRegistry.addNodeOperator(nodeOperator1.name, nodeOperator1.address, { from: voting })

    // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
    nodeOperator1.id = getEventArgument(txn, 'NodeOperatorAdded', 'nodeOperatorId', {
      decodeForAbi: NodeOperatorsRegistry._json.abi,
    })
    assert.equals(nodeOperator1.id, 0, 'operator id')

    assert.equals(await nodeOperatorsRegistry.getNodeOperatorsCount(), 1, 'total node operators')
  })

  it('the first node operator registers one validator', async () => {
    // How many validators can this node operator register
    const validatorsLimit = 1000000000
    const numKeys = 1

    await nodeOperatorsRegistry.addSigningKeysOperatorBH(
      nodeOperator1.id,
      numKeys,
      nodeOperator1.validators[0].key,
      nodeOperator1.validators[0].sig,
      {
        from: nodeOperator1.address,
      }
    )

    await nodeOperatorsRegistry.setNodeOperatorStakingLimit(0, validatorsLimit, { from: voting })

    // The key was added

    const totalKeys = await nodeOperatorsRegistry.getTotalSigningKeyCount(nodeOperator1.id, { from: nobody })
    assert.equals(totalKeys, 1, 'total signing keys')

    // The key was not used yet

    const unusedKeys = await nodeOperatorsRegistry.getUnusedSigningKeyCount(nodeOperator1.id, { from: nobody })
    assert.equals(unusedKeys, 1, 'unused signing keys')
  })

  it('the first user deposits 3 ETH to the pool', async () => {
    await web3.eth.sendTransaction({ to: pool.address, from: user1, value: ETH(2) })
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

    assert.equals(await pool.getBufferedEther(), ETH(3), 'buffered ether')
    assert.equals(await pool.getTotalPooledEther(), ETH(3), 'total pooled ether')

    // The amount of tokens corresponding to the deposited ETH value was minted to the user

    assert.equals(await token.balanceOf(user1), tokens(2), 'user1 tokens')

    assert.equals(await token.totalSupply(), tokens(3), 'token total supply')
  })

  it('the second user deposits 30 ETH to the pool', async () => {
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

    assert.equals(await pool.getBufferedEther(), ETH(1), 'buffered ether')
    assert.equals(await pool.getTotalPooledEther(), ETH(1 + 32), 'total pooled ether')

    // The amount of tokens corresponding to the deposited ETH value was minted to the users

    assert.equals(await token.balanceOf(user1), tokens(2), 'user1 tokens')
    assert.equals(await token.balanceOf(user2), tokens(30), 'user2 tokens')

    assert.equals(await token.totalSupply(), tokens(3 + 30), 'token total supply')
  })

  it('at this point, the pool has ran out of signing keys', async () => {
    const unusedKeys = await nodeOperatorsRegistry.getUnusedSigningKeyCount(nodeOperator1.id, { from: nobody })
    assert.equals(unusedKeys, 0, 'unused signing keys')
  })

  const nodeOperator2 = {
    name: 'operator_2',
    address: operator_2,
    validators: [
      {
        key: pad('0x020202', 48),
        sig: pad('0x02', 96),
      },
    ],
  }

  it('voting adds the second node operator who registers one validator', async () => {
    // TODO: we have to submit operators with 0 validators allowed only
    const validatorsLimit = 1000000000

    const txn = await nodeOperatorsRegistry.addNodeOperator(nodeOperator2.name, nodeOperator2.address, { from: voting })

    // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
    nodeOperator2.id = getEventArgument(txn, 'NodeOperatorAdded', 'nodeOperatorId', {
      decodeForAbi: NodeOperatorsRegistry._json.abi,
    })
    assert.equals(nodeOperator2.id, 1, 'operator id')

    assert.equals(await nodeOperatorsRegistry.getNodeOperatorsCount(), 2, 'total node operators')

    const numKeys = 1

    await nodeOperatorsRegistry.addSigningKeysOperatorBH(
      nodeOperator2.id,
      numKeys,
      nodeOperator2.validators[0].key,
      nodeOperator2.validators[0].sig,
      {
        from: nodeOperator2.address,
      }
    )

    // The key was added

    await nodeOperatorsRegistry.setNodeOperatorStakingLimit(1, validatorsLimit, { from: voting })

    const totalKeys = await nodeOperatorsRegistry.getTotalSigningKeyCount(nodeOperator2.id, { from: nobody })
    assert.equals(totalKeys, 1, 'total signing keys')

    // The key was not used yet

    const unusedKeys = await nodeOperatorsRegistry.getUnusedSigningKeyCount(nodeOperator2.id, { from: nobody })
    assert.equals(unusedKeys, 1, 'unused signing keys')
  })

  it('the third user deposits 64 ETH to the pool', async () => {
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

    assert.equals(await pool.getBufferedEther(), ETH(1 + 32), 'buffered ether')
    assert.equals(await pool.getTotalPooledEther(), ETH(33 + 64), 'total pooled ether')

    // The amount of tokens corresponding to the deposited ETH value was minted to the users

    assert.equals(await token.balanceOf(user1), tokens(2), 'user1 tokens')
    assert.equals(await token.balanceOf(user2), tokens(30), 'user2 tokens')
    assert.equals(await token.balanceOf(user3), tokens(64), 'user3 tokens')

    assert.equals(await token.totalSupply(), tokens(3 + 30 + 64), 'token total supply')
  })

  it('the oracle reports balance increase on Ethereum2 side', async () => {
    // Total shares are equal to deposited eth before ratio change and fee mint

    const oldTotalShares = await token.getTotalShares()
    assert.equals(oldTotalShares, ETH(97), 'total shares')

    // Old total pooled Ether

    const oldTotalPooledEther = await pool.getTotalPooledEther()
    assert.equals(oldTotalPooledEther, ETH(33 + 64), 'total pooled ether')

    // Reporting 1.005-fold balance increase (64 => 64.32) to stay in limits

    await pushOracleReport(consensus, oracle, 2, ETH(64.32), ETH(0))

    // Total shares increased because fee minted (fee shares added)
    // shares = oldTotalShares + reward * totalFee * oldTotalShares / (newTotalPooledEther - reward * totalFee)

    const newTotalShares = await token.getTotalShares()
    assert.equals(newTotalShares, '97031905270948112819', 'total shares')

    // Total pooled Ether increased

    const newTotalPooledEther = await pool.getTotalPooledEther()
    assert.equals(newTotalPooledEther, ETH(33 + 64.32), 'total pooled ether')

    // Ether2 stat reported by the pool changed correspondingly

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assert.equals(ether2Stat.beaconBalance, ETH(64.32), 'remote ether2')

    // Buffered Ether amount didn't change

    assert.equals(await pool.getBufferedEther(), ETH(33), 'buffered ether')

    // New tokens was minted to distribute fee
    assert.equals(await token.totalSupply(), tokens(97.32), 'token total supply')

    const reward = toBN(ETH(64.32 - 64))
    const mintedAmount = new BN(totalFeePoints).mul(reward).divn(10000)

    // Token user balances increased

    assert.equals(await token.balanceOf(INITIAL_HOLDER), '1002969072164948453', 'initial holder tokens')
    assert.equals(await token.balanceOf(user1), '2005938144329896907', 'user1 tokens')
    assert.equals(await token.balanceOf(user2), '30089072164948453608', 'user2 tokens')
    assert.equals(await token.balanceOf(user3), '64190020618556701031', 'user3 tokens')

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

  // node operator with 10 validators
  const nodeOperator3 = {
    id: 2,
    name: 'operator_3',
    address: operator_3,
    validators: [...Array(10).keys()].map((i) => ({
      key: pad('0xaa01' + i.toString(16), 48),
      sig: pad('0x' + i.toString(16), 96),
    })),
  }

  it('nodeOperator3 registered in NodeOperatorsRegistry and adds 10 signing keys', async () => {
    const validatorsCount = 10
    await nodeOperatorsRegistry.addNodeOperator(nodeOperator3.name, nodeOperator3.address, { from: voting })
    await nodeOperatorsRegistry.addSigningKeysOperatorBH(
      nodeOperator3.id,
      validatorsCount,
      hexConcat(...nodeOperator3.validators.map((v) => v.key)),
      hexConcat(...nodeOperator3.validators.map((v) => v.sig)),
      {
        from: nodeOperator3.address,
      }
    )
    await nodeOperatorsRegistry.setNodeOperatorStakingLimit(nodeOperator3.id, validatorsCount, { from: voting })
  })

  it('nodeOperator3 removes signing key with id 5', async () => {
    const signingKeyIndexToRemove = 5
    await nodeOperatorsRegistry.removeSigningKeyOperatorBH(nodeOperator3.id, signingKeyIndexToRemove, {
      from: nodeOperator3.address,
    })
    const nodeOperatorInfo = await nodeOperatorsRegistry.getNodeOperator(nodeOperator3.id, false)
    assert.equals(nodeOperatorInfo.totalVettedValidators, 5)
  })

  it('deposit to nodeOperator3 validators', async () => {
    const amountToDeposit = ETH(32 * 10)
    await web3.eth.sendTransaction({ to: pool.address, from: user1, value: amountToDeposit })
    await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
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

    let nodeOperatorInfo = await nodeOperatorsRegistry.getNodeOperator(nodeOperator3.id, false)

    // validate that only 5 signing keys used after key removing
    assert.equals(nodeOperatorInfo.totalVettedValidators, nodeOperatorInfo.totalDepositedValidators)
    assert.equals(nodeOperatorInfo.totalAddedValidators, 9)

    // validate that all other validators used and pool still has buffered ether
    nodeOperatorInfo = await nodeOperatorsRegistry.getNodeOperator(nodeOperator1.id, false)
    assert.equals(nodeOperatorInfo.totalAddedValidators, nodeOperatorInfo.totalDepositedValidators)
    nodeOperatorInfo = await nodeOperatorsRegistry.getNodeOperator(nodeOperator2.id, false)
    assert.equals(nodeOperatorInfo.totalAddedValidators, nodeOperatorInfo.totalDepositedValidators)
  })

  it('getFee and getFeeDistribution works as expected', async () => {
    // Need to have at least single deposited key, otherwise StakingRouter.getStakingRewardsDistribution
    // will return zero fees because no modules with non-zero total active validators
    // This is done in the changes in the tests above, but assuming there are no such changes
    // one could use the following:
    // await nodeOperatorsRegistry.increaseNodeOperatorDepositedSigningKeysCount(0, 1)

    function getFeeRelativeToTotalFee(absoluteFee) {
      return (absoluteFee * TOTAL_BASIS_POINTS) / totalFeePoints
    }

    assert.equals(await pool.getFee({ from: nobody }), totalFeePoints, 'total fee')
    const distribution = await pool.getFeeDistribution({ from: nobody })
    assert.equals(distribution.insuranceFeeBasisPoints, 0, 'insurance fee')
    assert.equals(
      distribution.treasuryFeeBasisPoints,
      getFeeRelativeToTotalFee(CURATED_MODULE_TREASURY_FEE),
      'treasury fee'
    )
    assert.equals(
      distribution.operatorsFeeBasisPoints,
      getFeeRelativeToTotalFee(CURATED_MODULE_MODULE_FEE),
      'node operators fee'
    )
  })
})
