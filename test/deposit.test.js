const { artifacts } = require('hardhat')

const { assertBn, assertRevert } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')
const { newDao, newApp } = require('./0.4.24/helpers/dao')
const { BN } = require('bn.js')
const nodeOperators = require('./helpers/node-operators')

const { pad, hexConcat, ETH, changeEndianness } = require('./helpers/utils')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')
const Lido = artifacts.require('LidoMock.sol')
const OracleMock = artifacts.require('OracleMock.sol')
const DepositContract = artifacts.require('DepositContract')
const VaultMock = artifacts.require('VaultMock.sol')
const StakingRouter = artifacts.require('StakingRouterMock.sol')

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'
const ADDRESS_3 = '0x0000000000000000000000000000000000000003'
const ADDRESS_4 = '0x0000000000000000000000000000000000000004'

const UNLIMITED = 1000000000
const MAX_DEPOSITS = 150
const CURATED_MODULE_ID = 1
const CALLDATA = '0x0'

const tokens = ETH

contract('Lido with official deposit contract', ([appManager, voting, user1, user2, user3, nobody, depositor, treasury]) => {
  let appBase, stEthBase, nodeOperatorsRegistryBase, app, token, oracle, depositContract, operators, stakingRouter
  let treasuryAddr, insuranceAddr

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await Lido.new()
    oracle = await OracleMock.new()
    nodeOperatorsRegistryBase = await NodeOperatorsRegistry.new()
  })

  beforeEach('deploy dao and app', async () => {
    depositContract = await DepositContract.new()
    const { dao, acl } = await newDao(appManager)

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    let proxyAddress = await newApp(dao, 'lido', appBase.address, appManager)
    app = await Lido.at(proxyAddress)
    await app.resumeProtocolAndStaking()

    // NodeOperatorsRegistry
    proxyAddress = await newApp(dao, 'node-operators-registry', nodeOperatorsRegistryBase.address, appManager)
    operators = await NodeOperatorsRegistry.at(proxyAddress)
    await operators.initialize(app.address, '0x')

    // Staking ROuter
    stakingRouter = await StakingRouter.new(depositContract.address, { from: appManager })
    await stakingRouter.initialize(appManager, app.address, ZERO_ADDRESS)
    await stakingRouter.grantRole(await stakingRouter.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(), voting, { from: appManager })
    await stakingRouter.grantRole(await stakingRouter.MODULE_MANAGE_ROLE(), voting, { from: appManager })
    await stakingRouter.addModule(
      'Curated',
      operators.address,
      10_000, // 100 % _targetShare
      500, // 5 % _moduleFee
      500, // 5 % _treasuryFee
      { from: voting }
    )

    // token
    // proxyAddress = await newApp(dao, 'steth', stEthBase.address, appManager)
    token = app
    // await token.initialize(app.address)

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.PAUSE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.RESUME_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_EL_REWARDS_VAULT_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_EL_REWARDS_WITHDRAWAL_LIMIT_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(voting, app.address, await app.STAKING_PAUSE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.STAKING_CONTROL_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.MANAGE_PROTOCOL_CONTRACTS_ROLE(), appManager, { from: appManager })

    await acl.createPermission(voting, operators.address, await operators.MANAGE_SIGNING_KEYS(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.ADD_NODE_OPERATOR_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.ACTIVATE_NODE_OPERATOR_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.DEACTIVATE_NODE_OPERATOR_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_NAME_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_ADDRESS_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_LIMIT_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.UPDATE_EXITED_VALIDATORS_KEYS_COUNT_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(
      stakingRouter.address,
      operators.address,
      await operators.REQUEST_VALIDATORS_KEYS_FOR_DEPOSITS_ROLE(),
      appManager,
      {
        from: appManager
      }
    )
    await acl.createPermission(
      stakingRouter.address,
      operators.address,
      await operators.INVALIDATE_READY_TO_DEPOSIT_KEYS_ROLE(),
      appManager,
      {
        from: appManager
      }
    )

    // Initialize the app's proxy.
    await app.initialize(oracle.address, treasury, stakingRouter.address, depositor, ZERO_ADDRESS)

    treasuryAddr = await app.getTreasury()

    await oracle.setPool(app.address)
  })

  const checkStat = async ({ depositedValidators, beaconBalance }) => {
    const stat = await app.getBeaconStat()
    assertBn(stat.depositedValidators, depositedValidators, 'deposited ether check')
    assertBn(stat.beaconBalance, beaconBalance, 'remote ether check')
  }

  it('deposit works', async () => {
    console.log('--addresses---')
    console.log('operators', operators.address)
    console.log('lido', app.address)
    console.log('staking_router', stakingRouter.address)

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
    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 0, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(1))
    assertBn(await app.getBufferedEther(), ETH(1))
    assertBn(await token.balanceOf(user1), tokens(1))
    assertBn(await token.totalSupply(), tokens(1))

    // +2 ETH
    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2) }) // another form of a deposit call
    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 0, beaconBalance: 0 })
    assertBn(bn(await depositContract.get_deposit_count()), 0)
    assertBn(await app.getTotalPooledEther(), ETH(3))
    assertBn(await app.getBufferedEther(), ETH(3))
    assertBn(await token.balanceOf(user2), tokens(2))
    assertBn(await token.totalSupply(), tokens(3))

    // +30 ETH
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(30) })
    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 1, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(33))
    assertBn(await app.getBufferedEther(), ETH(1))
    assertBn(await token.balanceOf(user1), tokens(1))
    assertBn(await token.balanceOf(user2), tokens(2))
    assertBn(await token.balanceOf(user3), tokens(30))
    assertBn(await token.totalSupply(), tokens(33))

    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 1)

    // +100 ETH
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(100) })
    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 4, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(133))
    assertBn(await app.getBufferedEther(), ETH(5))
    assertBn(await token.balanceOf(user1), tokens(101))
    assertBn(await token.balanceOf(user2), tokens(2))
    assertBn(await token.balanceOf(user3), tokens(30))
    assertBn(await token.totalSupply(), tokens(133))

    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 4)
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

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(33) })
    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 1)
    await assertRevert(operators.removeSigningKey(0, 0, { from: voting }), 'KEY_WAS_USED')

    await operators.removeSigningKey(0, 1, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(100) })
    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    // deposit should go to second operator, as the first one got their key limits set to 1
    await assertRevert(operators.removeSigningKey(1, 0, { from: voting }), 'KEY_WAS_USED')
    await assertRevert(operators.removeSigningKey(1, 1, { from: voting }), 'KEY_WAS_USED')
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 4)
    assertBn(await app.getTotalPooledEther(), ETH(133))
    assertBn(await app.getBufferedEther(), ETH(5))
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
      { name: 'deactivated', rewardAddress: ADDRESS_3, totalSigningKeysCount: 2, vettedSigningKeysCount: 2, isActive: false },
      { from: voting }
    )

    // id: 3
    await nodeOperators.addNodeOperator(operators, { name: 'short on keys', rewardAddress: ADDRESS_4 }, { from: voting })

    // Deposit huge chunk
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(32 * 3 + 50) })
    tx = await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    // assertEvent(tx, 'StakingRouterTransferReceived')

    await checkStat({ depositedValidators: 3, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(146))
    assertBn(await app.getBufferedEther(), ETH(50))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 3)

    assertBn(await web3.eth.getBalance(app.address), ETH(50), 'Lido balance')
    assertBn(await web3.eth.getBalance(stakingRouter.address), 0, 'StakingRouter balance')

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Next deposit changes nothing
    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(32) })
    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 3, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(178))
    assertBn(await app.getBufferedEther(), ETH(82))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 3)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // #1 goes below the limit (nothing changed cause staking limit decreases)
    await operators.updateExitedValidatorsKeysCount(1, 1, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 3, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(179))
    assertBn(await app.getBufferedEther(), ETH(83))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 3)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Adding a key & setting staking limit will help
    await operators.addSigningKeys(0, 1, pad('0x0003', 48), pad('0x01', 96), { from: voting })
    operators.setNodeOperatorStakingLimit(0, 3, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 4, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(180))
    assertBn(await app.getBufferedEther(), ETH(52))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 4)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Reactivation of #2 (doesn't change anything cause staking limit was trimmed on deactivation)
    await operators.activateNodeOperator(2, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(12) })
    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 4, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(192))
    assertBn(await app.getBufferedEther(), ETH(64))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 4)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)
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
      { name: 'deactivated', rewardAddress: ADDRESS_3, totalSigningKeysCount: 2, vettedSigningKeysCount: 2, isActive: false },
      { from: voting }
    )

    // id: 3
    await nodeOperators.addNodeOperator(operators, { name: 'short on keys', rewardAddress: ADDRESS_4 }, { from: voting })

    // Small deposits
    for (let i = 0; i < 14; i++) await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(10) })
    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(6) })
    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 3, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(146))
    assertBn(await app.getBufferedEther(), ETH(50))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 3)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Next deposit changes nothing
    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(32) })
    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 3, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(178))
    assertBn(await app.getBufferedEther(), ETH(82))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 3)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // #1 goes below the limit (nothing changed cause staking limit decreases)
    await operators.updateExitedValidatorsKeysCount(1, 1, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 3, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(179))
    assertBn(await app.getBufferedEther(), ETH(83))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 3)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Adding a key & setting staking limit will help
    await operators.addSigningKeys(0, 1, pad('0x0003', 48), pad('0x01', 96), { from: voting })
    operators.setNodeOperatorStakingLimit(0, 3, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 4, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(180))
    assertBn(await app.getBufferedEther(), ETH(52))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 4)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Reactivation of #2 (doesn't change anything cause staking limit was trimmed on deactivation)
    await operators.activateNodeOperator(2, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(12) })
    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 4, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(192))
    assertBn(await app.getBufferedEther(), ETH(64))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 4)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)
  })

  it('Deposit finds the right operator', async () => {
    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addNodeOperator('good', ADDRESS_1, { from: voting }) // 0
    await operators.addSigningKeys(0, 2, hexConcat(pad('0x0001', 48), pad('0x0002', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })
    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })

    await operators.addNodeOperator('2nd good', ADDRESS_2, { from: voting }) // 1
    await operators.addSigningKeys(1, 2, hexConcat(pad('0x0101', 48), pad('0x0102', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await operators.addNodeOperator('deactivated', ADDRESS_3, { from: voting }) // 2
    await operators.addSigningKeys(2, 2, hexConcat(pad('0x0201', 48), pad('0x0202', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })
    await operators.setNodeOperatorStakingLimit(2, UNLIMITED, { from: voting })
    await operators.deactivateNodeOperator(2, { from: voting })

    await operators.addNodeOperator('short on keys', ADDRESS_4, { from: voting }) // 3
    await operators.setNodeOperatorStakingLimit(3, UNLIMITED, { from: voting })

    // #1 and #0 get the funds
    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(64) })
    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 2, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(64))
    assertBn(await app.getBufferedEther(), ETH(0))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 2)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Reactivation of #2 - has the smallest stake
    await operators.activateNodeOperator(2, { from: voting })
    await operators.addSigningKeys(2, 2, hexConcat(pad('0x0201', 48), pad('0x0202', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })
    await operators.setNodeOperatorStakingLimit(2, UNLIMITED, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(36) })
    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 3, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(100))
    assertBn(await app.getBufferedEther(), ETH(4))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 3)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 3)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)
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
      sigs: [...Array(keysCount)].map((v, i) => pad('0x' + i.toString(16), 96))
    }
    const keys2 = {
      keys: [...Array(keysCount)].map((v, i) => pad('0xaa02' + i.toString(16), 48)),
      sigs: [...Array(keysCount)].map((v, i) => pad('0x' + i.toString(16), 96))
    }
    await operators.addSigningKeys(0, keysCount, hexConcat(...keys1.keys), hexConcat(...keys1.sigs), { from: voting })
    await operators.addSigningKeys(1, keysCount, hexConcat(...keys2.keys), hexConcat(...keys2.sigs), { from: voting })

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(amountToDeposit) })

    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor, gas: 20000000 })

    assertBn(await app.getTotalPooledEther(), ETH(amountToDeposit))
    assertBn(await app.getBufferedEther(), ETH(31))
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
      sigs: [...Array(keysCount)].map((v, i) => pad('0x' + i.toString(16), 96))
    }
    const keys2 = {
      keys: [...Array(keysCount)].map((v, i) => pad('0xaa02' + i.toString(16), 48)),
      sigs: [...Array(keysCount)].map((v, i) => pad('0x' + i.toString(16), 96))
    }
    await operators.addSigningKeys(0, keysCount, hexConcat(...keys1.keys), hexConcat(...keys1.sigs), { from: voting })
    await operators.addSigningKeys(1, keysCount, hexConcat(...keys2.keys), hexConcat(...keys2.sigs), { from: voting })

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    // Fix deposit tx price
    await web3.eth.sendTransaction({ to: user1, from: user2, value: ETH(2000) })
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(amountToDeposit) })

    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor, gas: 20000000 })

    assertBn(await app.getTotalPooledEther(), ETH(amountToDeposit))
    assertBn(await app.getBufferedEther(), ETH(33))
  })
})
