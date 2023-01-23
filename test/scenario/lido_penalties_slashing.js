const { assert } = require('chai')
const { BN } = require('bn.js')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { getEventArgument } = require('@aragon/contract-helpers-test')

const { assertRevert } = require('../helpers/assertThrow')
const { pad, ETH, tokens } = require('../helpers/utils')
const { deployDaoAndPool } = require('./helpers/deploy')
const { signDepositData } = require('../0.8.9/helpers/signatures')
const { waitBlocks } = require('../helpers/blockchain')

const INodeOperatorsRegistry = artifacts.require('contracts/0.4.24/interfaces/INodeOperatorsRegistry.sol:INodeOperatorsRegistry')

contract('Lido: penalties, slashing, operator stops', (addresses) => {
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
    // unrelated address
    nobody,
    depositor
  ] = addresses

  let pool, nodeOperatorsRegistry, token
  let oracleMock, depositContractMock
  let treasuryAddr, guardians
  let depositSecurityModule, depositRoot
  let withdrawalCredentials
  let stakingRouter

  before('DAO, node operators registry, token, pool and deposit security module are deployed and initialized', async () => {
    const deployed = await deployDaoAndPool(appManager, voting, depositor)

    // contracts/StETH.sol
    token = deployed.pool

    // contracts/Lido.sol
    pool = deployed.pool
    await pool.resumeProtocolAndStaking()

    // contracts/nos/NodeOperatorsRegistry.sol
    nodeOperatorsRegistry = deployed.nodeOperatorsRegistry

    // mocks
    oracleMock = deployed.oracleMock
    depositContractMock = deployed.depositContractMock

    stakingRouter = deployed.stakingRouter

    // stakingRouter.addModule('NOR', nodeOperatorsRegistry.address, 10000, 500, 500, { from: voting })

    // addresses
    treasuryAddr = deployed.treasuryAddr
    depositSecurityModule = deployed.depositSecurityModule
    guardians = deployed.guardians

    depositRoot = await depositContractMock.get_deposit_root()
    withdrawalCredentials = pad('0x0202', 32)

    await stakingRouter.setWithdrawalCredentials(withdrawalCredentials, { from: voting })
  })

  // Fee and its distribution are in basis points, 10000 corresponding to 100%

  // Total fee is 1%
  const totalFeePoints = 0.01 * 10000

  const treasuryFeePoints = 0.3 * 10000
  const nodeOperatorsFeePoints = 0.7 * 10000

  let awaitingTotalShares = new BN(0)
  let awaitingUser1Balance = new BN(0)

  it('voting sets fee and its distribution', async () => {
    await pool.setFee(totalFeePoints, { from: voting })
    await pool.setFeeDistribution(treasuryFeePoints, nodeOperatorsFeePoints, { from: voting })

    // Fee and distribution were set

    assertBn(await pool.getFee({ from: nobody }), totalFeePoints, 'total fee')

    const distribution = await pool.getFeeDistribution({ from: nobody })
    assertBn(distribution.treasuryFeeBasisPoints, treasuryFeePoints, 'treasury fee')
    assertBn(distribution.operatorsFeeBasisPoints, nodeOperatorsFeePoints, 'node operators fee')
  })

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
      },
      {
        key: pad('0x030303', 48),
        sig: pad('0x03', 96)
      }
    ]
  }

  it('voting adds the first node operator', async () => {
    const txn = await nodeOperatorsRegistry.addNodeOperator(nodeOperator1.name, nodeOperator1.address, { from: voting })

    // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
    nodeOperator1.id = getEventArgument(txn, 'NodeOperatorAdded', 'id', { decodeForAbi: INodeOperatorsRegistry._json.abi })
    assertBn(nodeOperator1.id, 0, 'operator id')

    assertBn(await nodeOperatorsRegistry.getNodeOperatorsCount(), 1, 'total node operators')
  })

  it('the first node operator registers one validator', async () => {
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

    // The key was added

    const totalKeys = await nodeOperatorsRegistry.getTotalSigningKeyCount(nodeOperator1.id, { from: nobody })
    assertBn(totalKeys, 1, 'total signing keys')

    // The key was not used yet

    const unusedKeys = await nodeOperatorsRegistry.getUnusedSigningKeyCount(nodeOperator1.id, { from: nobody })
    assertBn(unusedKeys, 1, 'unused signing keys')
  })

  it('the user deposits 32 ETH to the pool', async () => {
    const depositAmount = ETH(32)
    awaitingTotalShares = new BN(depositAmount)
    awaitingUser1Balance = new BN(depositAmount)
    await web3.eth.sendTransaction({ to: pool.address, from: user1, value: depositAmount })
    const block = await web3.eth.getBlock('latest')
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    const signatures = [
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        block.number,
        block.hash,
        depositRoot,
        1,
        keysOpIndex,
        '0x00',
        guardians.privateKeys[guardians.addresses[0]]
      ),
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        block.number,
        block.hash,
        depositRoot,
        1,
        keysOpIndex,
        '0x00',
        guardians.privateKeys[guardians.addresses[1]]
      )
    ]
    await depositSecurityModule.depositBufferedEther(block.number, block.hash, depositRoot, 1, keysOpIndex, '0x00', signatures)

    // No Ether was deposited yet to the validator contract

    assertBn(await depositContractMock.totalCalls(), 0, 'no validators registered yet')

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 0, 'no validators have received the ether2')
    assertBn(ether2Stat.beaconBalance, 0, 'remote ether2 not reported yet')

    // All Ether was buffered within the pool contract atm

    assertBn(await pool.getBufferedEther(), ETH(32), `all ether is buffered until there's a validator to deposit it`)
    assertBn(await pool.getTotalPooledEther(), ETH(32), 'total pooled ether')

    // The amount of tokens corresponding to the deposited ETH value was minted to the user

    assertBn(await token.balanceOf(user1), awaitingUser1Balance, 'user1 tokens')

    assertBn(await token.totalSupply(), tokens(32), 'token total supply')
    // Total shares are equal to deposited eth before ratio change and fee mint
    assertBn(await token.getTotalShares(), awaitingTotalShares, 'total shares')
  })

  it(`voting grants first operator right to have one validator`, async () => {
    await nodeOperatorsRegistry.setNodeOperatorStakingLimit(nodeOperator1.id, 1, { from: voting })
  })

  it(`new validator doesn't get buffered ether even if there's 32 ETH deposit in the pool`, async () => {
    assertBn(await pool.getBufferedEther(), ETH(32), `all ether is buffered until there's a validator to deposit it`)
    assertBn(await pool.getTotalPooledEther(), ETH(32), 'total pooled ether')
    assertBn(await nodeOperatorsRegistry.getUnusedSigningKeyCount(0), 1, 'one key available for the first validator')
  })

  it(`pushes pooled eth to the available validator`, async () => {
    const block = await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()
    const signatures = [
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        block.number,
        block.hash,
        depositRoot,
        1,
        keysOpIndex,
        '0x00',
        guardians.privateKeys[guardians.addresses[0]]
      ),
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        block.number,
        block.hash,
        depositRoot,
        1,
        keysOpIndex,
        '0x00',
        guardians.privateKeys[guardians.addresses[1]]
      )
    ]
    await depositSecurityModule.depositBufferedEther(block.number, block.hash, depositRoot, 1, keysOpIndex, '0x00', signatures)
  })

  it('new validator gets the 32 ETH deposit from the pool', async () => {
    assertBn(await pool.getBufferedEther(), ETH(0), `all ether is buffered until there's a validator to deposit it`)
    assertBn(await pool.getTotalPooledEther(), ETH(32), 'total pooled ether')
    assertBn(await nodeOperatorsRegistry.getUnusedSigningKeyCount(0), 0, 'no more available keys for the first validator')
  })

  it('first oracle report is taken as-is for Lido', async () => {
    const oldTotalShares = await token.getTotalShares()

    // Old total pooled Ether

    const oldTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(oldTotalPooledEther, ETH(32), 'total pooled ether')

    const epoch = 100
    // Reporting 1 ETH balance loss (32 => 31)
    const balanceReported = ETH(31)
    awaitingTotalShares = oldTotalShares
    awaitingUser1Balance = new BN(balanceReported)
    await oracleMock.reportBeacon(epoch, 1, balanceReported)

    // Total shares stay the same because no fee shares are added

    const newTotalShares = await token.getTotalShares()
    assertBn(newTotalShares, awaitingTotalShares, `total shares don't change on no reward`)

    // Total pooled Ether decreased

    const newTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(newTotalPooledEther, balanceReported, 'total pooled ether equals the reported balance')

    // Ether2 stat reported by the pool changed correspondingly

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 1, 'deposited ether2')
    assertBn(ether2Stat.beaconBalance, balanceReported, 'remote ether2 balance equals the reported value')

    // Buffered Ether amount didn't change

    assertBn(await pool.getBufferedEther(), ETH(0), 'buffered ether')

    // Total supply accounts for penalties taken by the validator
    assertBn(await token.totalSupply(), tokens(31), 'token total supply')

    // Token user balances decreased
    assertBn(await token.balanceOf(user1), awaitingUser1Balance, `user1 balance decreased`)

    // No fees distributed yet
    assertBn(await token.balanceOf(treasuryAddr), new BN(0), 'treasury tokens')
    assertBn(await token.balanceOf(nodeOperator1.address), new BN(0), 'operator_1 tokens')
  })

  it('the oracle reports balance loss on Ethereum2 side', async () => {
    // Total shares are equal to deposited eth before ratio change and fee mint
    assertBn(await token.getTotalShares(), awaitingTotalShares, 'old total shares')

    // Old total pooled Ether

    const oldTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(oldTotalPooledEther, ETH(31), 'old total pooled ether')

    const balanceReported = ETH(29)
    awaitingUser1Balance = new BN(balanceReported)

    // Reporting 2 ETH balance loss (31 => 29)
    await oracleMock.reportBeacon(101, 1, balanceReported) // 101 is an epoch number

    // Total shares stay the same because no fee shares are added

    const newTotalShares = await token.getTotalShares()
    assertBn(newTotalShares, awaitingTotalShares, `total shares don't change without rewards`)

    // Total pooled Ether decreased

    const newTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(newTotalPooledEther, balanceReported, 'new total pooled ether')

    // Ether2 stat reported by the pool changed correspondingly

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 1, 'deposited ether2')
    assertBn(ether2Stat.beaconBalance, balanceReported, 'remote ether2')

    // Buffered Ether amount didn't change

    assertBn(await pool.getBufferedEther(), ETH(0), 'buffered ether')

    // Total supply accounts for penalties taken by the validator
    assertBn(await token.totalSupply(), tokens(29), 'token total supply shrunk by loss taken')

    // Token user balances decreased
    assertBn(await token.balanceOf(user1), awaitingUser1Balance, 'user1 tokens shrunk by loss taken')

    // No fees distributed yet
    assertBn(await token.balanceOf(treasuryAddr), new BN(0), 'no treasury tokens on no reward')

    assertBn(await token.balanceOf(nodeOperator1.address), new BN(0), 'no operator_1 reward')
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
    const validatorsLimit = 1000000000

    const txn = await nodeOperatorsRegistry.addNodeOperator(nodeOperator2.name, nodeOperator2.address, { from: voting })

    // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
    nodeOperator2.id = getEventArgument(txn, 'NodeOperatorAdded', 'id', { decodeForAbi: INodeOperatorsRegistry._json.abi })
    assertBn(nodeOperator2.id, 1, 'correct operator id added')

    assertBn(await nodeOperatorsRegistry.getNodeOperatorsCount(), 2, 'total node operators updated')

    const numKeys = 1

    await nodeOperatorsRegistry.addSigningKeysOperatorBH(
      nodeOperator2.id,
      numKeys,
      nodeOperator2.validators[0].key,
      nodeOperator2.validators[0].sig,
      {
        from: nodeOperator2.address
      }
    )

    // The key was added

    await nodeOperatorsRegistry.setNodeOperatorStakingLimit(1, validatorsLimit, { from: voting })

    const totalKeys = await nodeOperatorsRegistry.getTotalSigningKeyCount(nodeOperator2.id, { from: nobody })
    assertBn(totalKeys, 1, 'second operator added one key')

    // The key was not used yet

    const unusedKeys = await nodeOperatorsRegistry.getUnusedSigningKeyCount(nodeOperator2.id, { from: nobody })
    assertBn(unusedKeys, 1, 'unused signing keys')
  })

  it('the user deposits another 32 ETH to the pool', async () => {
    const depositAmount = ETH(32)
    awaitingUser1Balance = awaitingUser1Balance.add(new BN(depositAmount))
    const tokenSupplyBefore = await token.totalSupply()
    await web3.eth.sendTransaction({ to: pool.address, from: user1, value: depositAmount })
    const block = await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()
    const signatures = [
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        block.number,
        block.hash,
        depositRoot,
        1,
        keysOpIndex,
        '0x00',
        guardians.privateKeys[guardians.addresses[0]]
      ),
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        block.number,
        block.hash,
        depositRoot,
        1,
        keysOpIndex,
        '0x00',
        guardians.privateKeys[guardians.addresses[1]]
      )
    ]
    await depositSecurityModule.depositBufferedEther(block.number, block.hash, depositRoot, 1, keysOpIndex, '0x00', signatures)

    assertBn(await depositContractMock.totalCalls(), 2)

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assertBn(ether2Stat.beaconBalance, ETH(29), 'remote ether2 as reported last time')

    // All Ether was buffered within the pool contract atm

    assertBn(await pool.getBufferedEther(), ETH(0), 'buffered ether')
    assertBn(await pool.getTotalPooledEther(), ETH(61), 'total pooled ether')

    // The amount of tokens corresponding to the deposited ETH value was minted to the user

    assertBn(await token.balanceOf(user1), awaitingUser1Balance, 'user1 tokens')

    assertBn(await token.totalSupply(), tokens(61), 'token total supply')

    const oldShares = awaitingTotalShares
    const newDeposit = new BN(depositAmount)
    const sharesAdded = newDeposit.mul(oldShares).div(tokenSupplyBefore)
    awaitingTotalShares = awaitingTotalShares.add(sharesAdded)
    assertBn(await token.getTotalShares(), new BN(depositAmount).add(sharesAdded), 'total shares are changed proportionally')
    assertBn(await token.balanceOf(user1), awaitingUser1Balance, `user1 balance increased by deposited ETH`)
  })

  it('the oracle reports balance loss for the third time', async () => {
    // Old total pooled Ether
    const oldTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(oldTotalPooledEther, ETH(61), 'old total pooled ether')

    const lossReported = ETH(1)
    awaitingUser1Balance = awaitingUser1Balance.sub(new BN(lossReported))

    // Reporting 1 ETH balance loss (61 => 60)
    await oracleMock.reportBeacon(103, 2, ETH(60)) // 103 is an epoch number

    // Total shares stay the same because no fee shares are added

    const newTotalShares = await token.getTotalShares()
    assertBn(newTotalShares, awaitingTotalShares, `total shares don't change on no reward`)

    // Total pooled Ether decreased

    const newTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(newTotalPooledEther, ETH(60), 'new total pooled ether')

    // Ether2 stat reported by the pool changed correspondingly

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assertBn(ether2Stat.beaconBalance, ETH(60), 'remote ether2')

    // Buffered Ether amount didn't change

    assertBn(await pool.getBufferedEther(), ETH(0), 'buffered ether')

    // Total supply accounts for penalties taken by the validator
    assertBn(await token.totalSupply(), tokens(60), 'token total supply shrunk by loss taken')

    // Token user balances decreased
    assertBn(await token.balanceOf(user1), awaitingUser1Balance, 'user1 tokens shrunk by loss taken')

    // No fees distributed yet
    assertBn(await token.balanceOf(treasuryAddr), new BN(0), 'no treasury tokens on no reward')

    assertBn(await token.balanceOf(nodeOperator1.address), new BN(0), 'no operator_1 reward')
    assertBn(await token.balanceOf(user1), ETH(60), `user1 balance decreased by lost ETH`)
  })

  it(`the oracle can't report less validators than previously`, () => {
    assertRevert(oracleMock.reportBeacon(101, 1, ETH(31)))
  })

  it(`voting stops the staking module`, async () => {
    await stakingRouter.setStakingModuleStatus(1, 2, { from: voting })
    assertBn(await stakingRouter.getStakingModulesCount(), new BN(1), 'only 1 module exists')
    assertBn(await stakingRouter.getStakingModuleStatus(1), new BN(2), 'no active staking modules')
  })

  it(`first operator adds a second validator`, async () => {
    const numKeys = 1
    await nodeOperatorsRegistry.addSigningKeysOperatorBH(
      nodeOperator1.id,
      numKeys,
      nodeOperator1.validators[1].key,
      nodeOperator1.validators[1].sig,
      {
        from: nodeOperator1.address
      }
    )

    // The key was added

    const totalFirstOperatorKeys = await nodeOperatorsRegistry.getTotalSigningKeyCount(nodeOperator1.id, { from: nobody })
    assertBn(totalFirstOperatorKeys, 2, 'added one signing key to total')

    const unusedKeys = await nodeOperatorsRegistry.getUnusedSigningKeyCount(nodeOperator1.id, { from: nobody })
    assertBn(unusedKeys, 1, 'one signing key is unused')
  })

  it(`voting stops the first operator`, async () => {
    const activeOperatorsBefore = await nodeOperatorsRegistry.getActiveNodeOperatorsCount()
    await nodeOperatorsRegistry.setNodeOperatorActive(0, false, { from: voting })
    const activeOperatorsAfter = await nodeOperatorsRegistry.getActiveNodeOperatorsCount()
    assertBn(activeOperatorsAfter, activeOperatorsBefore.sub(new BN(1)), 'deactivated one operator')
  })

  it(`user deposits another 32 ETH to the pool`, async () => {
    const totalPooledEther = await pool.getTotalPooledEther()
    const depositAmount = ETH(32)
    awaitingTotalShares = awaitingTotalShares.add(new BN(depositAmount).mul(awaitingTotalShares).div(totalPooledEther))
    awaitingUser1Balance = awaitingUser1Balance.add(new BN(depositAmount))

    await web3.eth.sendTransaction({ to: pool.address, from: user1, value: depositAmount })
    const block = await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()
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

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 2, 'no validators have received the current deposit')

    // The amount of tokens corresponding to the deposited ETH value was minted to the user

    assertBn(await token.balanceOf(user1), awaitingUser1Balance, 'user1 tokens')

    assertBn(await token.totalSupply(), tokens(95), 'token total supply')
    // Total shares are equal to deposited eth before ratio change and fee mint
    assertBn(await token.getTotalShares(), awaitingTotalShares, 'total shares')

    // All Ether was buffered within the pool contract atm
    assertBn(await pool.getBufferedEther(), ETH(32), `32 ETH is pooled`)
  })

  it(`oracle reports profit, stopped node operator doesn't get the fee`, async () => {
    const nodeOperator1TokenSharesBefore = await token.sharesOf(nodeOperator1.address)
    const nodeOperator2TokenSharesBefore = await token.sharesOf(nodeOperator2.address)

    await oracleMock.reportBeacon(105, 2, tokens(96)) // 105 is an epoch number

    const nodeOperator1TokenSharesAfter = await token.sharesOf(nodeOperator1.address)
    const nodeOperator2TokenSharesAfter = await token.sharesOf(nodeOperator2.address)
    assertBn(nodeOperator1TokenSharesAfter, nodeOperator1TokenSharesBefore, `first node operator balance hasn't changed`)
    assert(
      nodeOperator2TokenSharesBefore.sub(nodeOperator2TokenSharesAfter).negative,
      `second node operator gained shares under fee distribution`
    )
  })

  it(`voting stops the second operator`, async () => {
    const activeOperatorsBefore = await nodeOperatorsRegistry.getActiveNodeOperatorsCount()
    await nodeOperatorsRegistry.setNodeOperatorActive(1, false, { from: voting })
    const activeOperatorsAfter = await nodeOperatorsRegistry.getActiveNodeOperatorsCount()
    assertBn(activeOperatorsAfter, activeOperatorsBefore.sub(new BN(1)), 'deactivated one operator')
    assertBn(activeOperatorsAfter, new BN(0), 'no active operators')
  })

  it(`without active staking modules fee is sent to treasury`, async () => {
    const treasurySharesBefore = await token.sharesOf(treasuryAddr)
    await oracleMock.reportBeacon(105, 2, tokens(98)) // 105 is an epoch number

    const nodeOperator1TokenSharesAfter = await token.sharesOf(nodeOperator1.address)
    const nodeOperator2TokenSharesAfter = await token.sharesOf(nodeOperator2.address)
    const treasurySharesAfter = await token.sharesOf(treasuryAddr)

    assertBn(nodeOperator1TokenSharesAfter, nodeOperator1TokenSharesBefore, `first node operator hasn't got fees`)
    assertBn(nodeOperator2TokenSharesAfter, nodeOperator2TokenSharesBefore, `second node operator hasn't got fees`)

    const tenKBN = new BN(10000)
    const totalFeeToDistribute = new BN(ETH(2)).mul(new BN(totalFeePoints)).div(tenKBN)

    const sharesToMint = totalFeeToDistribute.mul(prevTotalShares).div(totalPooledEther.sub(totalFeeToDistribute))
    const treasuryFeeTotalMinusInsurance = sharesToMint

    const treasuryFeeTotalTreasuryPlusNodeOperators = sharesToMint
      .mul(new BN(treasuryFeePoints).add(new BN(nodeOperatorsFeePoints)))
      .div(tenKBN)

    assertBn(treasurySharesAfter.sub(treasurySharesBefore), treasuryFeeTotalMinusInsurance, 'treasury got the total fee - insurance fee')
    assertBn(
      treasurySharesAfter.sub(treasurySharesBefore),
      treasuryFeeTotalTreasuryPlusNodeOperators,
      'treasury got the regular fee + node operators fee'
    )

    // TODO: the following line is from staking router
    assertBn(treasurySharesAfter.sub(treasurySharesBefore), new BN('2715279303023647411'), 'treasury got the total fee')
  })

  it(`voting starts staking module`, async () => {
    await stakingRouter.setStakingModuleStatus(1, 0, { from: voting })
    assertBn(await stakingRouter.getStakingModulesCount(), new BN(1), 'only 1 module exists')
    assertBn(await stakingRouter.getStakingModuleStatus(1), new BN(0), 'no active staking modules')
  })

  it(`oracle reports profit, previously stopped staking module gets the fee`, async () => {
    const stakingModuleTokenSharesBefore = await token.sharesOf(nodeOperatorsRegistry.address)

    await oracleMock.reportBeacon(106, 2, tokens(100)) // 106 is an epoch number

    const stakingModuleTokenSharesAfter = await token.sharesOf(nodeOperatorsRegistry.address)

    assert(
      stakingModuleTokenSharesBefore.sub(stakingModuleTokenSharesAfter).negative,
      `first node operator gained shares under fee distribution`
    )
  })
})
