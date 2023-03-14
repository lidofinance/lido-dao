const { contract, artifacts, ethers, network, web3 } = require('hardhat')
const { assert } = require('../helpers/assert')

const { getEventArgument, bn } = require('@aragon/contract-helpers-test')

const { pad, ETH, StETH, shares, prepIdsCountsPayload } = require('../helpers/utils')
const { waitBlocks } = require('../helpers/blockchain')
const { deployProtocol } = require('../helpers/protocol')
const { setupNodeOperatorsRegistry } = require('../helpers/staking-modules')
const { SECONDS_PER_FRAME } = require('../helpers/constants')
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
    nobody,
  ] = addresses

  let pool, nodeOperatorsRegistry, token
  let oracle, depositContractMock
  let treasuryAddr, guardians, voting
  let depositSecurityModule, depositRoot
  let withdrawalCredentials
  let stakingRouter, consensus
  let elRewardsVault

  before(
    'DAO, node operators registry, token, pool and deposit security module are deployed and initialized',
    async () => {
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
              treasuryFee: 500,
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

  // storing incremental calculated values that changes all across the test suite
  let expectedUser1Balance = StETH(0)
  let expectedUser1Shares = shares(0)

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
      {
        key: pad('0x030303', 48),
        sig: pad('0x03', 96),
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

    // The key was added

    const totalKeys = await nodeOperatorsRegistry.getTotalSigningKeyCount(nodeOperator1.id, { from: nobody })
    assert.equals(totalKeys, 1, 'total signing keys')

    // The key was not used yet

    const unusedKeys = await nodeOperatorsRegistry.getUnusedSigningKeyCount(nodeOperator1.id, { from: nobody })
    assert.equals(unusedKeys, 1, 'unused signing keys')
  })

  it('the user deposits 32 ETH to the pool', async () => {
    await web3.eth.sendTransaction({ to: pool.address, from: user1, value: ETH(32) })

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
      ),
    ]
    await depositSecurityModule.depositBufferedEther(
      block.number,
      block.hash,
      depositRoot,
      1,
      keysOpIndex,
      '0x00',
      signatures
    )

    // No Ether was deposited yet to the validator contract

    assert.equals(await depositContractMock.totalCalls(), 0, 'no validators registered yet')

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 0, 'no validators have received the ether2')
    assert.equals(ether2Stat.beaconBalance, 0, 'remote ether2 not reported yet')

    assert.equals(await pool.getBufferedEther(), ETH(33), `All Ether was buffered within the pool contract atm`)
    assert.equals(await pool.getTotalPooledEther(), ETH(33), 'total pooled ether')

    expectedUser1Balance = StETH(32)
    expectedUser1Shares = shares(32)

    assert.equals(await token.sharesOf(user1), shares(32), 'User1 holds 32 shares')
    assert.equals(
      await token.balanceOf(user1),
      expectedUser1Balance,
      'The amount of tokens corresponding to the deposited ETH value was minted to the user'
    )
    assert.equals(await token.totalSupply(), StETH(33), 'token total supply')

    assert.equals(
      await token.getTotalShares(),
      shares(33),
      'Total shares are equal to deposited eth before ratio change and fee mint'
    )
  })

  it(`voting grants first operator right to have one validator`, async () => {
    await nodeOperatorsRegistry.setNodeOperatorStakingLimit(nodeOperator1.id, 1, { from: voting })
  })

  it(`new validator doesn't get buffered ether even if there's 32 ETH deposit in the pool`, async () => {
    assert.equals(
      await pool.getBufferedEther(),
      ETH(33),
      `all ether is buffered until there's a validator to deposit it`
    )
    assert.equals(await pool.getTotalPooledEther(), ETH(33), 'total pooled ether')
    assert.equals(
      await nodeOperatorsRegistry.getUnusedSigningKeyCount(0),
      1,
      'one key available for the first validator'
    )
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
      ),
    ]
    await depositSecurityModule.depositBufferedEther(
      block.number,
      block.hash,
      depositRoot,
      1,
      keysOpIndex,
      '0x00',
      signatures
    )
  })

  it('new validator gets the 32 ETH deposit from the pool', async () => {
    assert.equals(await pool.getBufferedEther(), ETH(1), `only initial eth is left`)
    assert.equals(await pool.getTotalPooledEther(), ETH(33), 'total pooled ether')
    assert.equals(
      await nodeOperatorsRegistry.getUnusedSigningKeyCount(0),
      0,
      'no more available keys for the first validator'
    )
  })

  it('first oracle report is taken as-is for Lido', async () => {
    assert.equals(await pool.getTotalPooledEther(), ETH(33), '32 ETH deposit + 1 ETH initial')

    // Reporting 1 ETH balance loss (32 => 31)
    await pushReport(1, ETH(31))

    assert.equals(
      await token.getTotalShares(),
      shares(33),
      'Total shares stay the same because no fee shares are added'
    )

    assert.equals(await pool.getTotalPooledEther(), ETH(32), 'Total pooled Ether decreased')

    const clStat = await pool.getBeaconStat()
    assert.equals(clStat.depositedValidators, 1, 'validators count')
    assert.equals(clStat.beaconBalance, ETH(31), 'Ether2 stat reported by the pool changed correspondingly')

    assert.equals(await pool.getBufferedEther(), ETH(1), 'Initial stake remains in the buffer')
    assert.equals(await token.totalSupply(), StETH(32), 'Token total supply penalized')

    assert.equals(await token.sharesOf(user1), shares(32), 'User1 still holds 32 shares')
    expectedUser1Balance = bn(shares(32)).muln(32).divn(33) // 32/33 ETH/share is a new price
    assert.equals(await token.balanceOf(user1), expectedUser1Balance, `Token user balances decreased`)

    assert.equals(await token.balanceOf(treasuryAddr), 0, 'No fees distributed yet: treasury')
    assert.equals(await token.balanceOf(nodeOperator1.address), 0, 'No fees distributed yet: operator_1')
  })

  it('the oracle reports balance loss on CL side', async () => {
    assert.equals(
      await token.getTotalShares(),
      shares(33),
      'Total shares are equal to deposited eth before ratio change and fee mint'
    )
    assert.equals(
      await pool.getTotalPooledEther(),
      ETH(32),
      'Old total pooled Ether 31 ETH od previous report + 1 ETH initial'
    )

    // Reporting 2 ETH balance loss (31 => 29)
    await pushReport(1, ETH(29))

    assert.equals(
      await token.getTotalShares(),
      shares(33),
      `Total shares stay the same because no fee shares are added`
    )
    assert.equals(await pool.getTotalPooledEther(), ETH(30), 'Total pooled Ether decreased')

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 1, 'deposited validators')
    assert.equals(ether2Stat.beaconBalance, ETH(29), 'Ether2 stat reported by the pool changed correspondingly')

    assert.equals(await pool.getBufferedEther(), ETH(1), 'Buffered Ether amount didnt change')
    assert.equals(await token.totalSupply(), StETH(30), 'Total supply accounts for penalties taken by the validator')

    expectedUser1Balance = bn(shares(32)).muln(30).divn(33) // New share price is 30/33 ETH/share
    assert.equals(await token.balanceOf(user1), expectedUser1Balance, 'Token user1 balances decreased')

    assert.equals(await token.balanceOf(treasuryAddr), 0, 'No fees distributed yet: treasury')
    assert.equals(await token.balanceOf(nodeOperator1.address), 0, 'No fees distributed yet: operator_1')
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
    const validatorsLimit = 1000000000

    const txn = await nodeOperatorsRegistry.addNodeOperator(nodeOperator2.name, nodeOperator2.address, { from: voting })

    // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
    nodeOperator2.id = getEventArgument(txn, 'NodeOperatorAdded', 'nodeOperatorId', {
      decodeForAbi: NodeOperatorsRegistry._json.abi,
    })
    assert.equals(nodeOperator2.id, 1, 'correct operator id added')

    assert.equals(await nodeOperatorsRegistry.getNodeOperatorsCount(), 2, 'total node operators updated')

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
    assert.equals(totalKeys, 1, 'second operator added one key')

    // The key was not used yet

    const unusedKeys = await nodeOperatorsRegistry.getUnusedSigningKeyCount(nodeOperator2.id, { from: nobody })
    assert.equals(unusedKeys, 1, 'unused signing keys')
  })

  it('the user deposits another 32 ETH to the pool', async () => {
    assert.equals(await token.totalSupply(), StETH(30), 'token total supply before')
    assert.equals(await token.getTotalShares(), shares(33), 'token total supply before')

    await web3.eth.sendTransaction({ to: pool.address, from: user1, value: ETH(32) })
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
      ),
    ]
    await depositSecurityModule.depositBufferedEther(
      block.number,
      block.hash,
      depositRoot,
      1,
      keysOpIndex,
      '0x00',
      signatures
    )

    assert.equals(await depositContractMock.totalCalls(), 2)

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assert.equals(ether2Stat.beaconBalance, ETH(29), 'remote ether2 as reported last time')

    assert.equals(await pool.getBufferedEther(), ETH(1), 'Only initial ether is in the buffer')
    assert.equals(await pool.getTotalPooledEther(), ETH(62), 'total pooled ether')
    assert.equals(await token.totalSupply(), StETH(62), 'token total supply')

    // 32 ETH deposit to shares if price is 30/33 ETH/shares
    const sharesAdded = bn(ETH(32))
      .mul(bn(ETH(33)))
      .div(bn(shares(30)))
    expectedUser1Shares = bn(expectedUser1Shares).add(sharesAdded)
    assert.equals(await token.sharesOf(user1), expectedUser1Shares, 'User1 acquires new shares by new share price')
    assert.equals(
      await token.getTotalShares(),
      bn(shares(1)).add(expectedUser1Shares),
      'total shares are changed proportionally'
    )

    expectedUser1Balance = bn(expectedUser1Balance).add(bn(StETH(32)))
    assert.equals(await token.balanceOf(user1), expectedUser1Balance, 'user1 tokens')
  })

  it('the oracle reports balance loss for the third time', async () => {
    assert.equals(await pool.getTotalPooledEther(), ETH(62), 'Old total pooled Ether')
    const expectedTotalShares = bn(shares(1)).add(bn(expectedUser1Shares))
    assert.equals(await token.getTotalShares(), expectedTotalShares, 'Old total shares')

    // Reporting 1 ETH balance loss ( total pooled 61 => 60)
    await pushReport(1, ETH(28))

    assert.equals(
      await token.getTotalShares(),
      bn(shares(1)).add(expectedUser1Shares),
      'Total shares stay the same because no fee shares are added'
    )
    assert.equals(await pool.getTotalPooledEther(), ETH(61), 'Total pooled Ether decreased')

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 2, 'Another validator is deposited')
    assert.equals(ether2Stat.beaconBalance, ETH(28), 'Ether2 stat reported by the pool changed correspondingly')

    assert.equals(await pool.getBufferedEther(), ETH(1), 'Only initial ETH in the buffer')
    assert.equals(await pool.getTotalPooledEther(), ETH(61), 'Total pooled Ether')
    assert.equals(await token.totalSupply(), StETH(61), 'token total supply shrunk by loss taken')
    assert.equals(await token.getTotalShares(), expectedTotalShares, 'total shares stays same')

    assert.equals(await token.sharesOf(user1), expectedUser1Shares, 'User1 shares stays same')
    expectedUser1Balance = bn(expectedUser1Shares) // New price
      .mul(bn(StETH(61)))
      .div(expectedTotalShares)
    assert.equals(await token.balanceOf(user1), expectedUser1Balance, 'Token user balances decreased')

    assert.equals(await token.balanceOf(treasuryAddr), 0, 'No fees distributed yet: treasury')
    assert.equals(await token.balanceOf(nodeOperator1.address), 0, 'No fees distributed yet: operator_1')
  })

  it(`the oracle can't report less validators than previously`, async () => {
    await assert.reverts(pushReport(0, ETH(31)))
  })

  it(`user deposits another 32 ETH to the pool`, async () => {
    assert.equals(await pool.getTotalPooledEther(), ETH(61), 'Old total pooled Ether')
    const oldTotalShares = bn(shares(1)).add(bn(expectedUser1Shares))
    assert.equals(await token.getTotalShares(), oldTotalShares, 'Old total shares')

    await web3.eth.sendTransaction({ to: pool.address, from: user1, value: ETH(32) })

    await network.provider.send('hardhat_mine', ['0x100'])

    const block = await web3.eth.getBlock('latest')
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(block.number, block.hash, depositRoot, 1, keysOpIndex)

    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]]),
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

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 2, 'no validators have received the current deposit')

    assert.equals(await pool.getBufferedEther(), ETH(33), '33 ETH is pooled')
    assert.equals(await pool.getTotalPooledEther(), ETH(93), 'Total pooled Ether')
    assert.equals(await token.totalSupply(), StETH(93), 'token total supply')

    const sharesAdded = bn(ETH(32))
      .mul(oldTotalShares)
      .div(bn(ETH(61)))
    assert.equals(
      await token.getTotalShares(),
      oldTotalShares.add(sharesAdded),
      'Total shares are equal to deposited eth before ratio change and fee mint'
    )

    expectedUser1Shares = bn(expectedUser1Shares).add(sharesAdded)
    assert.equals(await token.sharesOf(user1), expectedUser1Shares, 'User1 bought shares on 32 ETH')
    expectedUser1Balance = expectedUser1Balance.add(bn(StETH(32)))
    assert.equals(
      await token.balanceOf(user1),
      expectedUser1Balance,
      'The amount of tokens corresponding to the deposited ETH value was minted to the user'
    )
  })

  it(`voting stops the staking module`, async () => {
    await stakingRouter.setStakingModuleStatus(1, 2, { from: voting })
    assert.equals(await stakingRouter.getStakingModulesCount(), 1, 'only 1 module exists')
    assert.equals(await stakingRouter.getStakingModuleStatus(1), 2, 'no active staking modules')
  })

  it(`first operator adds a second validator`, async () => {
    const numKeys = 1
    await nodeOperatorsRegistry.addSigningKeysOperatorBH(
      nodeOperator1.id,
      numKeys,
      nodeOperator1.validators[1].key,
      nodeOperator1.validators[1].sig,
      {
        from: nodeOperator1.address,
      }
    )

    // The key was added

    const totalFirstOperatorKeys = await nodeOperatorsRegistry.getTotalSigningKeyCount(nodeOperator1.id, {
      from: nobody,
    })
    assert.equals(totalFirstOperatorKeys, 2, 'added one signing key to total')

    const unusedKeys = await nodeOperatorsRegistry.getUnusedSigningKeyCount(nodeOperator1.id, { from: nobody })
    assert.equals(unusedKeys, 1, 'one signing key is unused')
  })

  it(`voting stops the first operator`, async () => {
    const activeOperatorsBefore = await nodeOperatorsRegistry.getActiveNodeOperatorsCount()
    await nodeOperatorsRegistry.deactivateNodeOperator(0, { from: voting })
    const activeOperatorsAfter = await nodeOperatorsRegistry.getActiveNodeOperatorsCount()
    assert.equals(activeOperatorsAfter, activeOperatorsBefore.subn(1), 'deactivated one operator')
  })

  it(`voting stops the second operator`, async () => {
    const activeOperatorsBefore = await nodeOperatorsRegistry.getActiveNodeOperatorsCount()
    await nodeOperatorsRegistry.deactivateNodeOperator(1, { from: voting })
    const activeOperatorsAfter = await nodeOperatorsRegistry.getActiveNodeOperatorsCount()
    assert.equals(activeOperatorsAfter, activeOperatorsBefore.subn(1), 'deactivated one operator')
    assert.equals(activeOperatorsAfter, 0, 'no active operators')
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

    assert.equals(nodeOperator1TokenSharesAfter, nodeOperator1TokenSharesBefore, `first node operator hasn't got fees`)
    assert.equals(nodeOperator2TokenSharesAfter, nodeOperator2TokenSharesBefore, `second node operator hasn't got fees`)
    assert.equals(
      nodeOperatorsRegistrySharesAfter,
      nodeOperatorsRegistrySharesBefore,
      `NOR stakingModule hasn't got fees`
    )

    const tenKBN = bn(10000)
    const totalFeeToDistribute = bn(beaconBalanceIncrement.toString()).mul(bn(totalFeePoints)).div(tenKBN)

    const totalPooledEther = await pool.getTotalPooledEther()
    const sharesToMint = totalFeeToDistribute.mul(prevTotalShares).div(totalPooledEther.sub(totalFeeToDistribute))

    assert.equals(treasurySharesAfter.sub(treasurySharesBefore), sharesToMint, 'treasury got the total fee')
  })

  it(`voting starts staking module`, async () => {
    await stakingRouter.setStakingModuleStatus(1, 0, { from: voting })
    assert.equals(await stakingRouter.getStakingModulesCount(), 1, 'only 1 module exists')
    assert.equals(await stakingRouter.getStakingModuleStatus(1), 0, 'no active staking modules')
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
    assert.equals(
      nodeOperator1TokenSharesAfter,
      nodeOperator1TokenSharesBefore,
      `first node operator balance hasn't changed`
    )
    assert(
      !nodeOperator2TokenSharesBefore.sub(nodeOperator2TokenSharesAfter).positive,
      `second node operator gained shares under fee distribution`
    )
  })
})
