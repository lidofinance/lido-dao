const { assert } = require('chai')
const { assertBn, assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { BN } = require('bn.js')
const { newDao, newApp } = require('./helpers/dao')
const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

const Lido = artifacts.require('LidoMock.sol')
const ELRewardsVault = artifacts.require('LidoExecutionLayerRewardsVault.sol')
const OracleMock = artifacts.require('OracleMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')
const ERC20Mock = artifacts.require('ERC20Mock.sol')
const RewardEmulatorMock = artifacts.require('RewardEmulatorMock.sol')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')

contract('Lido', ([appManager, voting, user1, user2, user3, nobody, depositor]) => {
  let appBase, nodeOperatorsRegistryBase, app, oracle, depositContract, operators
  let treasuryAddr, insuranceAddr
  let dao, acl
  let elRewardsVault, rewarder

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await Lido.new()
    oracle = await OracleMock.new()
    yetAnotherOracle = await OracleMock.new()
    depositContract = await DepositContractMock.new()
    nodeOperatorsRegistryBase = await NodeOperatorsRegistry.new()
    anyToken = await ERC20Mock.new()
  })

  beforeEach('deploy dao and app', async () => {
    ;({ dao, acl } = await newDao(appManager))

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    let proxyAddress = await newApp(dao, 'lido', appBase.address, appManager)
    app = await Lido.at(proxyAddress)

    // NodeOperatorsRegistry
    proxyAddress = await newApp(dao, 'node-operators-registry', nodeOperatorsRegistryBase.address, appManager)
    operators = await NodeOperatorsRegistry.at(proxyAddress)
    await operators.initialize(app.address)

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.PAUSE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.RESUME_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.MANAGE_FEE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.MANAGE_WITHDRAWAL_KEY(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.BURN_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.MANAGE_PROTOCOL_CONTRACTS_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_EL_REWARDS_VAULT_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_EL_REWARDS_WITHDRAWAL_LIMIT_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(voting, app.address, await app.STAKING_PAUSE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.STAKING_CONTROL_ROLE(), appManager, { from: appManager })

    await acl.createPermission(voting, operators.address, await operators.MANAGE_SIGNING_KEYS(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.ADD_NODE_OPERATOR_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_ACTIVE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_NAME_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_ADDRESS_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_LIMIT_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.REPORT_STOPPED_VALIDATORS_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(depositor, app.address, await app.DEPOSIT_ROLE(), appManager, { from: appManager })

    // Initialize the app's proxy.
    await app.initialize(depositContract.address, oracle.address, operators.address)

    assert((await app.isStakingPaused()) === true)
    assert((await app.isStopped()) === true)
    await app.resume({ from: voting })
    assert((await app.isStakingPaused()) === false)
    assert((await app.isStopped()) === false)

    treasuryAddr = await app.getTreasury()
    insuranceAddr = await app.getInsuranceFund()

    await oracle.setPool(app.address)
    await depositContract.reset()

    elRewardsVault = await ELRewardsVault.new(app.address, treasuryAddr)
    rewarder = await RewardEmulatorMock.new(elRewardsVault.address)
    await assertRevert(app.setELRewardsVault(elRewardsVault.address), 'APP_AUTH_FAILED')
    let receipt = await app.setELRewardsVault(elRewardsVault.address, { from: voting })
    assertEvent(receipt, 'ELRewardsVaultSet', { expectedArgs: { executionLayerRewardsVault: elRewardsVault.address } })

    const elRewardsWithdrawalLimitPoints = 3
    await assertRevert(app.setELRewardsWithdrawalLimit(elRewardsWithdrawalLimitPoints), 'APP_AUTH_FAILED')
    receipt = await app.setELRewardsWithdrawalLimit(elRewardsWithdrawalLimitPoints, { from: voting })
    assertEvent(receipt, 'ELRewardsWithdrawalLimitSet', { expectedArgs: { limitPoints: elRewardsWithdrawalLimitPoints } })
  })

  it('balanceOf error after submit should not be greater than 1 wei', async () => {
    const totalShares = new BN('3954885183194715680671922')
    const totalPooledEther = new BN('42803292811181753711139770')
    // rate = 10.822891393424902

    await app.submit(ZERO_ADDRESS, { from: user2, value: totalShares })
    await app.methods['depositBufferedEther()']({ from: depositor })
    await oracle.reportBeacon(100, 0, totalPooledEther.sub(totalShares))

    const ethToDeposit = new BN('10000000000000000000')
    await app.submit(ZERO_ADDRESS, { from: user3, value: ethToDeposit })
    const stranger_steth_balance_after = await app.balanceOf(user3)

    assertBn(stranger_steth_balance_after, ethToDeposit)
  })

  it('getSharesByPooledEth then getPooledEthByShares behave as before rounding fixes', async () => {
    const totalShares = new BN('3954885183194715680671922')
    const totalPooledEther = new BN('42803292811181753711139770')

    await app.submit(ZERO_ADDRESS, { from: user2, value: totalShares })
    await app.methods['depositBufferedEther()']({ from: depositor })
    await oracle.reportBeacon(100, 0, totalPooledEther.sub(totalShares))

    const ethToDeposit = new BN('10000000000000000000')
    const shares = await app.getSharesByPooledEth(ethToDeposit)
    const eth = await app.getPooledEthByShares(shares)

    assertBn(eth, ethToDeposit.sub(new BN(8)))
  })

  it('getPooledEthByShares then getSharesByPooledEth behave as before rounding fixes', async () => {
    const totalShares = new BN('3954885183194715680671922')
    const totalPooledEther = new BN('42803292811181753711139770')

    await app.submit(ZERO_ADDRESS, { from: user2, value: totalShares })
    await app.methods['depositBufferedEther()']({ from: depositor })
    await oracle.reportBeacon(100, 0, totalPooledEther.sub(totalShares))

    const eth = await app.getPooledEthByShares(totalShares)
    const shares = await app.getSharesByPooledEth(eth)

    assertBn(shares, totalShares)
  })

  it('tests submitting total ETH supply twice', async () => {
    // There are under 123M of circulating ETH right now.
    // Less than 20M can be produced each year.
    // Thus, in 100 years, we can expect no more than 2500M ETH.

    const totalEthSupplyIn100Years = new BN('2500000000000000000000000000')

    await app.submit(ZERO_ADDRESS, { from: user2, value: totalEthSupplyIn100Years })
    await app.methods['depositBufferedEther()']({ from: depositor })
    const user2_steth_balance_after = await app.balanceOf(user2)
    assertBn(user2_steth_balance_after, totalEthSupplyIn100Years)

    await oracle.reportBeacon(100, 0, ETH(42))

    await app.submit(ZERO_ADDRESS, { from: user3, value: totalEthSupplyIn100Years })
    await app.methods['depositBufferedEther()']({ from: depositor })
    const user3_steth_balance_after = await app.balanceOf(user3)
    assertBn(user3_steth_balance_after, totalEthSupplyIn100Years)
  })

  it('sum of Transfer events goes farther away from balanceOf', async () => {
    const eth10 = new BN('10000000000000000000')

    await app.submit(ZERO_ADDRESS, { from: user2, value: eth10 })
    await app.methods['depositBufferedEther()']({ from: depositor })
    const user2_steth_balance_after = await app.balanceOf(user2)
    assertBn(user2_steth_balance_after, eth10)

    await oracle.reportBeacon(100, 0, ETH(42))

    let sumByTransferEvents = new BN(0)

    const receipt = await app.submit(ZERO_ADDRESS, { from: user3, value: eth10 })
    await app.methods['depositBufferedEther()']({ from: depositor })
    const user3_steth_balance_after = await app.balanceOf(user3)

    assertBn(user3_steth_balance_after, eth10)

    const valueInTranferEvent = eth10.sub(new BN(5))

    assertEvent(receipt, 'Transfer', {
      expectedArgs: { value: valueInTranferEvent }
    })
    sumByTransferEvents = sumByTransferEvents.add(valueInTranferEvent)

    assertBn(user3_steth_balance_after, sumByTransferEvents.add(new BN(5)))

    const receipt2 = await app.submit(ZERO_ADDRESS, { from: user3, value: eth10 })
    await app.methods['depositBufferedEther()']({ from: depositor })
    const user3_steth_balance_after2 = await app.balanceOf(user3)

    assertBn(user3_steth_balance_after2, eth10.add(eth10))
    assertEvent(receipt2, 'Transfer', {
      expectedArgs: { value: valueInTranferEvent }
    })
    sumByTransferEvents = sumByTransferEvents.add(valueInTranferEvent)

    assertBn(user3_steth_balance_after2, sumByTransferEvents.add(new BN(10)))
  })

  it('tests submitting by 1 wei', async () => {
    const wei1 = new BN(1)

    await app.submit(ZERO_ADDRESS, { from: user2, value: wei1 })
    await app.methods['depositBufferedEther()']({ from: depositor })
    const user2_steth_balance_after = await app.balanceOf(user2)
    assertBn(user2_steth_balance_after, wei1)

    await app.submit(ZERO_ADDRESS, { from: user2, value: wei1 })
    await app.methods['depositBufferedEther()']({ from: depositor })
    const user2_steth_balance_after2 = await app.balanceOf(user2)
    assertBn(user2_steth_balance_after2, new BN(2))

    await oracle.reportBeacon(100, 0, new BN(2))

    await app.submit(ZERO_ADDRESS, { from: user3, value: wei1 })
    await app.methods['depositBufferedEther()']({ from: depositor })
    const user3_steth_balance_after = await app.balanceOf(user3)
    assertBn(user3_steth_balance_after, wei1)

    await app.submit(ZERO_ADDRESS, { from: user3, value: wei1 })
    await app.methods['depositBufferedEther()']({ from: depositor })
    const user3_steth_balance_after2 = await app.balanceOf(user3)
    assertBn(user3_steth_balance_after2, new BN(2))
  })

  it('fix 1 wei rounding error', async () => {
    const totalShares = new BN('3954')
    const totalPooledEther = new BN('42800')
    // rate = 10.824481537683359

    await app.submit(ZERO_ADDRESS, { from: user2, value: totalShares })
    await app.methods['depositBufferedEther()']({ from: depositor })
    await oracle.reportBeacon(100, 0, totalPooledEther.sub(totalShares))

    const ethToDeposit = new BN('10')
    await app.submit(ZERO_ADDRESS, { from: user3, value: ethToDeposit })
    const stranger_steth_balance_after = await app.balanceOf(user3)

    assertBn(stranger_steth_balance_after, ethToDeposit)
  })

  // need for rounding in public functions ?
})
