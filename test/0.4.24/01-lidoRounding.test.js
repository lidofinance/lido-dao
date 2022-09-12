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

    await app.submit(ZERO_ADDRESS, { from: user2, value: totalShares })
    await app.methods['depositBufferedEther()']({ from: depositor })
    await oracle.reportBeacon(100, 0, totalPooledEther.sub(totalShares))

    const ethToDeposit = new BN('10000000000000000000')
    await app.submit(ZERO_ADDRESS, { from: user3, value: ethToDeposit })
    const stranger_steth_balance_after = await app.balanceOf(user3)

    assertBn(stranger_steth_balance_after, ethToDeposit.sub(new BN(1)))
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
    assertBn(eth, ethToDeposit.sub(new BN(9)))
  })
})
