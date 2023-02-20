const hre = require('hardhat')
const { BN } = require('bn.js')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { getEventArgument } = require('@aragon/contract-helpers-test')

const { assert } = require('../helpers/assert')
const { pad, ETH, tokens, prepIdsCountsPayload } = require('../helpers/utils')
const { waitBlocks } = require('../helpers/blockchain')
const { deployProtocol } = require('../helpers/protocol')
const { setupNodeOperatorsRegistry } = require('../helpers/staking-modules')
const { SLOTS_PER_FRAME, SECONDS_PER_FRAME } = require('../helpers/constants')
const { pushOracleReport } = require('../helpers/oracle')
const { oracleReportSanityCheckerStubFactory } = require('../helpers/factories')
const { DSMAttestMessage, DSMPauseMessage, signDepositData } = require('../helpers/signatures')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

contract('Lido: penalties, slashing, operator stops', (addresses) => {
  const [
    // node operators
    operator_1,
    operator_2,
    // users who deposit Ether to the pool
    user1,
    // unrelated address
    nobody
  ] = addresses

  let pool, nodeOperatorsRegistry, token
  let oracle, depositContractMock
  let treasuryAddr, guardians, voting
  let depositSecurityModule, depositRoot
  let withdrawalCredentials
  let stakingRouter, consensus
  let elRewardsVault

  before('DAO, node operators registry, token, pool and deposit security module are deployed and initialized', async () => {
      const deployed = await deployProtocol({
        oracleReportSanityCheckerFactory: oracleReportSanityCheckerStubFactory,
        stakingModulesFactory: async (protocol) => {
          const curatedModule = await setupNodeOperatorsRegistry(protocol)
          return [
            {
              module: curatedModule,
              name: 'Curated',
              targetShares: 10000,
              moduleFee: 500,
              treasuryFee: 500
            }
          ]
        }
      })

      // contracts/StETH.sol
      token = deployed.pool

      // contracts/Lido.sol
      pool = deployed.pool

      // contracts/nos/NodeOperatorsRegistry.sol
      nodeOperatorsRegistry = deployed.stakingModules[0]

      // mocks
      oracle = deployed.oracle
      consensus = deployed.consensusContract
      depositContractMock = deployed.depositContract

      stakingRouter = deployed.stakingRouter

      // addresses
      treasuryAddr = deployed.treasury.address
      depositSecurityModule = deployed.depositSecurityModule
      guardians = deployed.guardians
      voting = deployed.voting.address
      elRewardsVault = deployed.elRewardsVault

      depositRoot = await depositContractMock.get_deposit_root()
      withdrawalCredentials = pad('0x0202', 32)

      await stakingRouter.setWithdrawalCredentials(withdrawalCredentials, { from: voting })
    }
  )

  const pushReport = async (clValidators, clBalance) => {
    const elRewards = await web3.eth.getBalance(elRewardsVault.address)
    await pushOracleReport(consensus, oracle, clValidators, clBalance, elRewards)
    await ethers.provider.send('evm_increaseTime', [SECONDS_PER_FRAME + 1000])
    await ethers.provider.send('evm_mine')
  }

  let awaitingTotalShares = new BN(0)
  let awaitingUser1Balance = new BN(0)

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
    nodeOperator1.id = getEventArgument(txn, 'NodeOperatorAdded', 'nodeOperatorId', { decodeForAbi: NodeOperatorsRegistry._json.abi })
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

    const refSlot = 1 * SLOTS_PER_FRAME
    // Reporting 1 ETH balance loss (32 => 31)
    const balanceReported = ETH(31)
    awaitingTotalShares = oldTotalShares
    awaitingUser1Balance = new BN(balanceReported)

    await pushReport(1, balanceReported)

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
    await pushReport(1, balanceReported)

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
    nodeOperator2.id = getEventArgument(txn, 'NodeOperatorAdded', 'nodeOperatorId', { decodeForAbi: NodeOperatorsRegistry._json.abi })
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

    // Reporting 1 ETH balance loss ( total pooled 61 => 60)

    await pushReport(1, ETH(28))

    // Total shares stay the same because no fee shares are added

    const newTotalShares = await token.getTotalShares()
    assertBn(newTotalShares, awaitingTotalShares, `total shares don't change on no reward`)

    // Total pooled Ether decreased

    const newTotalPooledEther = await pool.getTotalPooledEther()
    assertBn(newTotalPooledEther, ETH(60), 'new total pooled ether')

    // Ether2 stat reported by the pool changed correspondingly

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assertBn(ether2Stat.beaconBalance, ETH(28), 'remote ether2')

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
    assert.reverts(pushReport(2, ETH(31)))
  })

  it(`user deposits another 32 ETH to the pool`, async () => {
    const totalPooledEther = await pool.getTotalPooledEther()
    const depositAmount = ETH(32)
    awaitingTotalShares = awaitingTotalShares.add(new BN(depositAmount).mul(awaitingTotalShares).div(totalPooledEther))
    awaitingUser1Balance = awaitingUser1Balance.add(new BN(depositAmount))
    await web3.eth.sendTransaction({ to: pool.address, from: user1, value: depositAmount })

    await hre.network.provider.send("hardhat_mine", ['0x100'])

    const block = await web3.eth.getBlock('latest')
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(block.number, block.hash, depositRoot, 1, keysOpIndex)

    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]])
    ]

    await depositSecurityModule.depositBufferedEther(
      block.number,
      block.hash,
      depositRoot,
      1,
      keysOpIndex,
      '0x',
      signatures
    )
    // TODO: check getBeaconStat call
    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 2, 'no validators have received the current deposit')

    // The amount of tokens corresponding to the deposited ETH value was minted to the user

    assertBn(await token.balanceOf(user1), awaitingUser1Balance, 'user1 tokens')

    assertBn(await token.totalSupply(), tokens(92), 'token total supply')
    // Total shares are equal to deposited eth before ratio change and fee mint
    assertBn(await token.getTotalShares(), awaitingTotalShares, 'total shares')

    // All Ether was buffered within the pool contract atm
    assertBn(await pool.getBufferedEther(), ETH(32), `32 ETH is pooled`)
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
    await nodeOperatorsRegistry.deactivateNodeOperator(0, { from: voting })
    const activeOperatorsAfter = await nodeOperatorsRegistry.getActiveNodeOperatorsCount()
    assertBn(activeOperatorsAfter, activeOperatorsBefore.sub(new BN(1)), 'deactivated one operator')
  })

  it(`voting stops the second operator`, async () => {
    const activeOperatorsBefore = await nodeOperatorsRegistry.getActiveNodeOperatorsCount()
    await nodeOperatorsRegistry.deactivateNodeOperator(1, { from: voting })
    const activeOperatorsAfter = await nodeOperatorsRegistry.getActiveNodeOperatorsCount()
    assertBn(activeOperatorsAfter, activeOperatorsBefore.sub(new BN(1)), 'deactivated one operator')
    assertBn(activeOperatorsAfter, new BN(0), 'no active operators')
  })

  it(`without active staking modules fee is sent to treasury`, async () => {
    const treasurySharesBefore = await token.sharesOf(treasuryAddr)
    const nodeOperator1TokenSharesBefore = await token.sharesOf(nodeOperator1.address)
    const nodeOperator2TokenSharesBefore = await token.sharesOf(nodeOperator2.address)
    const nodeOperatorsRegistrySharesBefore = await token.sharesOf(nodeOperatorsRegistry.address)
    const prevTotalShares = await token.getTotalShares()

    // Fee and its distribution are in basis points, 10000 corresponding to 100%
    // Total fee is 10%
    const totalFeePoints = 0.1 * 10000

    const totalSupplyBefore = await token.getTotalPooledEther()

    await pushReport(2, ETH(90))

    const totalSupplyAfter = await token.getTotalPooledEther()
    const beaconBalanceIncrement = totalSupplyAfter - totalSupplyBefore

    const nodeOperator1TokenSharesAfter = await token.sharesOf(nodeOperator1.address)
    const nodeOperator2TokenSharesAfter = await token.sharesOf(nodeOperator2.address)
    const nodeOperatorsRegistrySharesAfter = await token.sharesOf(nodeOperatorsRegistry.address)
    const treasurySharesAfter = await token.sharesOf(treasuryAddr)

    assertBn(nodeOperator1TokenSharesAfter, nodeOperator1TokenSharesBefore, `first node operator hasn't got fees`)
    assertBn(nodeOperator2TokenSharesAfter, nodeOperator2TokenSharesBefore, `second node operator hasn't got fees`)
    assertBn(nodeOperatorsRegistrySharesAfter, nodeOperatorsRegistrySharesBefore, `NOR stakingModule hasn't got fees`)

    const tenKBN = new BN(10000)
    const totalFeeToDistribute = new BN(beaconBalanceIncrement.toString()).mul(new BN(totalFeePoints)).div(tenKBN)

    const totalPooledEther = await pool.getTotalPooledEther()
    let sharesToMint = totalFeeToDistribute
      .mul(prevTotalShares)
      .div(
        totalPooledEther.sub(totalFeeToDistribute)
      )

    assertBn(treasurySharesAfter.sub(treasurySharesBefore), sharesToMint, 'treasury got the total fee')
  })

  it(`voting starts staking module`, async () => {
    await stakingRouter.setStakingModuleStatus(1, 0, { from: voting })
    assertBn(await stakingRouter.getStakingModulesCount(), new BN(1), 'only 1 module exists')
    assertBn(await stakingRouter.getStakingModuleStatus(1), new BN(0), 'no active staking modules')
  })

  it(`oracle reports profit, previously stopped staking module gets the fee`, async () => {
    const stakingModuleTokenSharesBefore = await token.sharesOf(nodeOperatorsRegistry.address)

    await pushReport(2, ETH(100))

    const stakingModuleTokenSharesAfter = await token.sharesOf(nodeOperatorsRegistry.address)

    assert(
      stakingModuleTokenSharesBefore.sub(stakingModuleTokenSharesAfter).negative,
      `first node operator gained shares under fee distribution`
    )
  })

  it(`oracle reports profit, stopped node operator doesn't get the fee`, async () => {
    const nodeOperator1TokenSharesBefore = await token.sharesOf(nodeOperator1.address)
    const nodeOperator2TokenSharesBefore = await token.sharesOf(nodeOperator2.address)

    await pushReport(2, ETH(96))

    // kicks rewards distribution
    const { operatorIds, keysCounts } = prepIdsCountsPayload(0, 1)
    await nodeOperatorsRegistry.updateExitedValidatorsCount(operatorIds, keysCounts, { from: voting })

    const nodeOperator1TokenSharesAfter = await token.sharesOf(nodeOperator1.address)
    const nodeOperator2TokenSharesAfter = await token.sharesOf(nodeOperator2.address)
    console.log({
      nodeOperator1TokenSharesBefore: nodeOperator1TokenSharesBefore.toString(),
      nodeOperator1TokenSharesAfter: nodeOperator1TokenSharesAfter.toString(),
      nodeOperator2TokenSharesBefore: nodeOperator2TokenSharesBefore.toString(),
      nodeOperator2TokenSharesAfter: nodeOperator2TokenSharesAfter.toString(),
    })
    assertBn(nodeOperator1TokenSharesAfter, nodeOperator1TokenSharesBefore, `first node operator balance hasn't changed`)
    assert(
      !nodeOperator2TokenSharesBefore.sub(nodeOperator2TokenSharesAfter).positive,
      `second node operator gained shares under fee distribution`
    )
  })
})
