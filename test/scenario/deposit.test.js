const { contract, ethers, web3 } = require('hardhat')
const { assert } = require('../helpers/assert')

const { bn } = require('@aragon/contract-helpers-test')

const { EvmSnapshot } = require('../helpers/blockchain')
const { setupNodeOperatorsRegistry } = require('../helpers/staking-modules')
const { deployProtocol } = require('../helpers/protocol')
const { ETH, pad, hexConcat, changeEndianness, prepIdsCountsPayload, tokens } = require('../helpers/utils')
const nodeOperators = require('../helpers/node-operators')
const { depositContractFactory } = require('../helpers/factories')
const { ZERO_ADDRESS } = require('../helpers/constants')

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'
const ADDRESS_3 = '0x0000000000000000000000000000000000000003'
const ADDRESS_4 = '0x0000000000000000000000000000000000000004'

const UNLIMITED = 1000000000
const MAX_DEPOSITS = 150
const CURATED_MODULE_ID = 1
const CALLDATA = '0x0'

contract('Lido with official deposit contract', ([user1, user2, user3, nobody, depositor]) => {
  let app, token, depositContract, operators, stakingRouter
  let voting, snapshot

  before('deploy base app', async () => {
    const deployed = await deployProtocol({
      stakingModulesFactory: async (protocol) => {
        const curatedModule = await setupNodeOperatorsRegistry(protocol)

        await protocol.acl.grantPermission(
          protocol.stakingRouter.address,
          curatedModule.address,
          await curatedModule.MANAGE_NODE_OPERATOR_ROLE()
        )

        return [
          {
            module: curatedModule,
            name: 'curated',
            targetShares: 10000,
            moduleFee: 500,
            treasuryFee: 500,
          },
        ]
      },
      depositSecurityModuleFactory: async () => {
        return { address: depositor }
      },
      depositContractFactory,
      postSetup: async ({ pool, lidoLocator, eip712StETH, withdrawalQueue, appManager, voting }) => {
        await pool.initialize(lidoLocator.address, eip712StETH.address, { value: ETH(1) })
        await pool.resumeProtocolAndStaking({ from: voting.address })
      },
    })

    app = deployed.pool
    token = deployed.token
    stakingRouter = deployed.stakingRouter
    operators = deployed.stakingModules[0]
    voting = deployed.voting.address
    depositContract = deployed.depositContract

    snapshot = new EvmSnapshot(ethers.provider)
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  const checkStat = async ({ depositedValidators, beaconBalance }) => {
    const stat = await app.getBeaconStat()
    assert.equals(stat.depositedValidators, depositedValidators, 'deposited ether check')
    assert.equals(stat.beaconBalance, beaconBalance, 'remote ether check')
  }

  it('deposit works', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    // +1 ETH
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(1) })
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 0, beaconBalance: 0 })
    assert.equals(await app.getTotalPooledEther(), ETH(2))
    assert.equals(await app.getBufferedEther(), ETH(2))
    assert.equals(await token.balanceOf(user1), tokens(1))
    assert.equals(await token.totalSupply(), tokens(2))

    // +2 ETH
    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2) }) // another form of a deposit call
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 0, beaconBalance: 0 })
    assert.equals(bn(await depositContract.get_deposit_count()), 0)
    assert.equals(await app.getTotalPooledEther(), ETH(4))
    assert.equals(await app.getBufferedEther(), ETH(4))
    assert.equals(await token.balanceOf(user2), tokens(2))
    assert.equals(await token.totalSupply(), tokens(4))

    // +30 ETH
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(30) })
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 1, beaconBalance: 0 })
    assert.equals(await app.getTotalPooledEther(), ETH(34))
    assert.equals(await app.getBufferedEther(), ETH(2))
    assert.equals(await token.balanceOf(user1), tokens(1))
    assert.equals(await token.balanceOf(user2), tokens(2))
    assert.equals(await token.balanceOf(user3), tokens(30))
    assert.equals(await token.totalSupply(), tokens(34))

    assert.equals(bn(changeEndianness(await depositContract.get_deposit_count())), 1)

    // +100 ETH
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(100) })
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 4, beaconBalance: 0 })
    assert.equals(await app.getTotalPooledEther(), ETH(134))
    assert.equals(await app.getBufferedEther(), ETH(6))
    assert.equals(await token.balanceOf(user1), tokens(101))
    assert.equals(await token.balanceOf(user2), tokens(2))
    assert.equals(await token.balanceOf(user3), tokens(30))
    assert.equals(await token.totalSupply(), tokens(134))

    assert.equals(bn(changeEndianness(await depositContract.get_deposit_count())), 4)
  })

  it('key removal is taken into account during deposit', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    await operators.addSigningKeys(
      1,
      3,
      hexConcat(pad('0x020204', 48), pad('0x020205', 48), pad('0x020206', 48)),
      hexConcat(pad('0x02', 96), pad('0x02', 96), pad('0x02', 96)),
      { from: voting }
    )

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(32) })
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    assert.equals(bn(changeEndianness(await depositContract.get_deposit_count())), 1)
    await assert.reverts(operators.removeSigningKey(0, 0, { from: voting }), 'OUT_OF_RANGE')

    await operators.removeSigningKey(0, 1, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(100) })
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    // deposit should go to second operator, as the first one got their key limits set to 1
    await assert.reverts(operators.removeSigningKey(1, 0, { from: voting }), 'OUT_OF_RANGE')
    await assert.reverts(operators.removeSigningKey(1, 1, { from: voting }), 'OUT_OF_RANGE')
    assert.equals(bn(changeEndianness(await depositContract.get_deposit_count())), 4)
    assert.equals(await app.getTotalPooledEther(), ETH(133))
    assert.equals(await app.getBufferedEther(), ETH(5))
  })

  it('Node Operators filtering during deposit works when doing a huge deposit', async () => {
    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    // id: 0
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'good', rewardAddress: ADDRESS_1, totalSigningKeysCount: 2, vettedSigningKeysCount: 2 },
      { from: voting }
    )

    // id: 1
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'limited', rewardAddress: ADDRESS_2, totalSigningKeysCount: 2, vettedSigningKeysCount: 1 },
      { from: voting }
    )

    // id: 2
    await nodeOperators.addNodeOperator(
      operators,
      {
        name: 'deactivated',
        rewardAddress: ADDRESS_3,
        totalSigningKeysCount: 2,
        vettedSigningKeysCount: 2,
        isActive: false,
      },
      { from: voting }
    )

    // id: 3
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'short on keys', rewardAddress: ADDRESS_4 },
      { from: voting }
    )

    // Deposit huge chunk
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(32 * 3 + 50 - 1 /* initial */) })
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, {
      from: depositor,
    })

    // assertEvent(tx, 'StakingRouterTransferReceived')

    await checkStat({ depositedValidators: 3, beaconBalance: 0 })
    assert.equals(await app.getTotalPooledEther(), ETH(146))
    assert.equals(await app.getBufferedEther(), ETH(50))
    assert.equals(bn(changeEndianness(await depositContract.get_deposit_count())), 3)

    assert.equals(await web3.eth.getBalance(app.address), ETH(50), 'Lido balance')
    assert.equals(await web3.eth.getBalance(stakingRouter.address), 0, 'StakingRouter balance')

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Next deposit changes nothing
    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(32) })
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 3, beaconBalance: 0 })
    assert.equals(await app.getTotalPooledEther(), ETH(178))
    assert.equals(await app.getBufferedEther(), ETH(82))
    assert.equals(bn(changeEndianness(await depositContract.get_deposit_count())), 3)

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // #1 goes below the limit (nothing changed cause staking limit decreases)
    const { operatorIds, keysCounts } = prepIdsCountsPayload(1, 1)
    await operators.updateExitedValidatorsCount(operatorIds, keysCounts, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 3, beaconBalance: 0 })
    assert.equals(await app.getTotalPooledEther(), ETH(179))
    assert.equals(await app.getBufferedEther(), ETH(83))
    assert.equals(bn(changeEndianness(await depositContract.get_deposit_count())), 3)

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Adding a key & setting staking limit will help
    await operators.addSigningKeys(0, 1, pad('0x0003', 48), pad('0x01', 96), { from: voting })
    await operators.setNodeOperatorStakingLimit(0, 3, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 4, beaconBalance: 0 })
    assert.equals(await app.getTotalPooledEther(), ETH(180))
    assert.equals(await app.getBufferedEther(), ETH(52))
    assert.equals(bn(changeEndianness(await depositContract.get_deposit_count())), 4)

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Reactivation of #2 (doesn't change anything cause staking limit was trimmed on deactivation)
    await operators.activateNodeOperator(2, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(12) })
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 4, beaconBalance: 0 })
    assert.equals(await app.getTotalPooledEther(), ETH(192))
    assert.equals(await app.getBufferedEther(), ETH(64))
    assert.equals(bn(changeEndianness(await depositContract.get_deposit_count())), 4)

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)
  })

  it('Node Operators filtering during deposit works when doing small deposits', async () => {
    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    // id: 0
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'good', rewardAddress: ADDRESS_1, totalSigningKeysCount: 2, vettedSigningKeysCount: 2 },
      { from: voting }
    )

    // id: 1
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'limited', rewardAddress: ADDRESS_2, totalSigningKeysCount: 2, vettedSigningKeysCount: 1 },
      { from: voting }
    )

    // id: 2
    await nodeOperators.addNodeOperator(
      operators,
      {
        name: 'deactivated',
        rewardAddress: ADDRESS_3,
        totalSigningKeysCount: 2,
        vettedSigningKeysCount: 2,
        isActive: false,
      },
      { from: voting }
    )

    // id: 3
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'short on keys', rewardAddress: ADDRESS_4 },
      { from: voting }
    )

    // Small deposits
    for (let i = 0; i < 14; i++) await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(10) })
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(5) })
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 3, beaconBalance: 0 })
    assert.equals(await app.getTotalPooledEther(), ETH(146))
    assert.equals(await app.getBufferedEther(), ETH(50))
    assert.equals(bn(changeEndianness(await depositContract.get_deposit_count())), 3)

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Next deposit changes nothing
    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(32) })
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 3, beaconBalance: 0 })
    assert.equals(await app.getTotalPooledEther(), ETH(178))
    assert.equals(await app.getBufferedEther(), ETH(82))
    assert.equals(bn(changeEndianness(await depositContract.get_deposit_count())), 3)

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // #1 goes below the limit (nothing changed cause staking limit decreases)
    const { operatorIds, keysCounts } = prepIdsCountsPayload(1, 1)
    await operators.updateExitedValidatorsCount(operatorIds, keysCounts, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 3, beaconBalance: 0 })
    assert.equals(await app.getTotalPooledEther(), ETH(179))
    assert.equals(await app.getBufferedEther(), ETH(83))
    assert.equals(bn(changeEndianness(await depositContract.get_deposit_count())), 3)

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Adding a key & setting staking limit will help
    await operators.addSigningKeys(0, 1, pad('0x0003', 48), pad('0x01', 96), { from: voting })
    await operators.setNodeOperatorStakingLimit(0, 3, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 4, beaconBalance: 0 })
    assert.equals(await app.getTotalPooledEther(), ETH(180))
    assert.equals(await app.getBufferedEther(), ETH(52))
    assert.equals(bn(changeEndianness(await depositContract.get_deposit_count())), 4)

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Reactivation of #2 (doesn't change anything cause staking limit was trimmed on deactivation)
    await operators.activateNodeOperator(2, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(12) })
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 4, beaconBalance: 0 })
    assert.equals(await app.getTotalPooledEther(), ETH(192))
    assert.equals(await app.getBufferedEther(), ETH(64))
    assert.equals(bn(changeEndianness(await depositContract.get_deposit_count())), 4)

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)
  })

  it('Deposit finds the right operator', async () => {
    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addNodeOperator('good', ADDRESS_1, { from: voting }) // 0
    await operators.addSigningKeys(
      0,
      2,
      hexConcat(pad('0x0001', 48), pad('0x0002', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96)),
      {
        from: voting,
      }
    )
    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })

    await operators.addNodeOperator('2nd good', ADDRESS_2, { from: voting }) // 1
    await operators.addSigningKeys(
      1,
      2,
      hexConcat(pad('0x0101', 48), pad('0x0102', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96)),
      {
        from: voting,
      }
    )
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await operators.addNodeOperator('deactivated', ADDRESS_3, { from: voting }) // 2
    await operators.addSigningKeys(
      2,
      2,
      hexConcat(pad('0x0201', 48), pad('0x0202', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96)),
      {
        from: voting,
      }
    )
    await operators.setNodeOperatorStakingLimit(2, UNLIMITED, { from: voting })
    await operators.deactivateNodeOperator(2, { from: voting })

    await operators.addNodeOperator('short on keys', ADDRESS_4, { from: voting }) // 3
    await operators.setNodeOperatorStakingLimit(3, UNLIMITED, { from: voting })

    // #1 and #0 get the funds
    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(63) })
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 2, beaconBalance: 0 })
    assert.equals(await app.getTotalPooledEther(), ETH(64))
    assert.equals(await app.getBufferedEther(), ETH(0))
    assert.equals(bn(changeEndianness(await depositContract.get_deposit_count())), 2)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Reactivation of #2 - has the smallest stake
    await operators.activateNodeOperator(2, { from: voting })
    await operators.addSigningKeys(
      2,
      2,
      hexConcat(pad('0x0201', 48), pad('0x0202', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96)),
      {
        from: voting,
      }
    )
    await operators.setNodeOperatorStakingLimit(2, UNLIMITED, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(36) })
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 3, beaconBalance: 0 })
    assert.equals(await app.getTotalPooledEther(), ETH(100))
    assert.equals(await app.getBufferedEther(), ETH(4))
    assert.equals(bn(changeEndianness(await depositContract.get_deposit_count())), 3)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 3)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)
  })

  it('depositBufferedEther() deposits less then DEFAULT_MAX_DEPOSITS_PER_CALL', async () => {
    const defaultMaxDepositPerCall = 150 * 32
    const amountToDeposit = defaultMaxDepositPerCall - 1

    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    const keysCount = 100
    const keys1 = {
      keys: [...Array(keysCount)].map((v, i) => pad('0xaa01' + i.toString(16), 48)),
      sigs: [...Array(keysCount)].map((v, i) => pad('0x' + i.toString(16), 96)),
    }
    const keys2 = {
      keys: [...Array(keysCount)].map((v, i) => pad('0xaa02' + i.toString(16), 48)),
      sigs: [...Array(keysCount)].map((v, i) => pad('0x' + i.toString(16), 96)),
    }
    await operators.addSigningKeys(0, keysCount, hexConcat(...keys1.keys), hexConcat(...keys1.sigs), { from: voting })
    await operators.addSigningKeys(1, keysCount, hexConcat(...keys2.keys), hexConcat(...keys2.sigs), { from: voting })

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(amountToDeposit - 1) })

    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, {
      from: depositor,
      gas: 20000000,
    })

    assert.equals(await app.getTotalPooledEther(), ETH(amountToDeposit))
    assert.equals(await app.getBufferedEther(), ETH(31))
  })

  it('depositBufferedEther() deposits equal to DEFAULT_MAX_DEPOSITS_PER_CALL', async () => {
    const defaultMaxDepositPerCall = 150 * 32
    const amountToDeposit = defaultMaxDepositPerCall + 33

    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    const keysCount = 100
    const keys1 = {
      keys: [...Array(keysCount)].map((v, i) => pad('0xaa01' + i.toString(16), 48)),
      sigs: [...Array(keysCount)].map((v, i) => pad('0x' + i.toString(16), 96)),
    }
    const keys2 = {
      keys: [...Array(keysCount)].map((v, i) => pad('0xaa02' + i.toString(16), 48)),
      sigs: [...Array(keysCount)].map((v, i) => pad('0x' + i.toString(16), 96)),
    }
    await operators.addSigningKeys(0, keysCount, hexConcat(...keys1.keys), hexConcat(...keys1.sigs), { from: voting })
    await operators.addSigningKeys(1, keysCount, hexConcat(...keys2.keys), hexConcat(...keys2.sigs), { from: voting })

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    // Fix deposit tx price
    await web3.eth.sendTransaction({ to: user1, from: user2, value: ETH(2000) })
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(amountToDeposit - 1 /* initial */) })

    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, {
      from: depositor,
      gas: 20000000,
    })

    assert.equals(await app.getTotalPooledEther(), ETH(amountToDeposit))
    assert.equals(await app.getBufferedEther(), ETH(33))
  })
})
