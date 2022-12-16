const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn, assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistryMock')

const Lido = artifacts.require('LidoMock.sol')
const OracleMock = artifacts.require('OracleMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')
const StakingRouter = artifacts.require('StakingRouter.sol')
const ModuleSolo = artifacts.require('ModuleSolo.sol')

const TOTAL_BASIS_POINTS = 10000
const ETH = (value) => web3.utils.toWei(value + '', 'ether')

contract('Lido', ([appManager, voting, user2, depositor]) => {
  let appBase, nodeOperatorsRegistryBase, app, oracle, depositContract, curatedModule, stakingRouter, soloModule
  let treasuryAddr
  let dao, acl

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await Lido.new()
    oracle = await OracleMock.new()
    depositContract = await DepositContractMock.new()
    nodeOperatorsRegistryBase = await NodeOperatorsRegistry.new()
  })

  beforeEach('deploy dao and app', async () => {
    ;({ dao, acl } = await newDao(appManager))

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    let proxyAddress = await newApp(dao, 'lido', appBase.address, appManager)
    app = await Lido.at(proxyAddress)

    // NodeOperatorsRegistry
    proxyAddress = await newApp(dao, 'node-operators-registry', nodeOperatorsRegistryBase.address, appManager)
    curatedModule = await NodeOperatorsRegistry.at(proxyAddress)
    await curatedModule.initialize(app.address)

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

    await acl.createPermission(voting, curatedModule.address, await curatedModule.MANAGE_SIGNING_KEYS(), appManager, { from: appManager })
    await acl.createPermission(voting, curatedModule.address, await curatedModule.ADD_NODE_OPERATOR_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(voting, curatedModule.address, await curatedModule.SET_NODE_OPERATOR_ACTIVE_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(voting, curatedModule.address, await curatedModule.SET_NODE_OPERATOR_NAME_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(voting, curatedModule.address, await curatedModule.SET_NODE_OPERATOR_ADDRESS_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(voting, curatedModule.address, await curatedModule.SET_NODE_OPERATOR_LIMIT_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(voting, curatedModule.address, await curatedModule.REPORT_STOPPED_VALIDATORS_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(depositor, app.address, await app.DEPOSIT_ROLE(), appManager, { from: appManager })

    // Initialize the app's proxy.
    await app.initialize(depositContract.address, oracle.address, curatedModule.address)

    assert((await app.isStakingPaused()) === true)
    assert((await app.isStopped()) === true)
    await app.resume({ from: voting })
    assert((await app.isStakingPaused()) === false)
    assert((await app.isStopped()) === false)

    treasuryAddr = await app.getTreasury()

    await oracle.setPool(app.address)
    await depositContract.reset()
  })

  beforeEach('setup staking router', async () => {
    stakingRouter = await StakingRouter.new(depositContract.address)
    // initialize
    await stakingRouter.initialize(app.address)

    await app.setStakingRouter(stakingRouter.address)

    soloModule = await ModuleSolo.new(1, app.address, 500, { from: appManager })

    const cfgCurated = {
      treasuryFee: 500,
      targetShare: 10000,
      recycleShare: 0 // 0%, no effect if targetShare >=10000
    }

    await stakingRouter.addModule(
      'Curated',
      curatedModule.address,
      cfgCurated.targetShare,
      cfgCurated.recycleShare,
      cfgCurated.treasuryFee,
      { from: appManager }
    )
    await curatedModule.setTotalKeys(100, { from: appManager })
    await curatedModule.setTotalUsedKeys(50, { from: appManager })
    await curatedModule.setTotalStoppedKeys(100, { from: appManager })

    const cfgCommunity = {
      treasuryFee: 500,
      targetShare: 10000,
      recycleShare: 0 // 0%, no effect if targetShare >=10000
    }

    await stakingRouter.addModule(
      'Solo',
      soloModule.address,
      cfgCommunity.targetShare,
      cfgCommunity.recycleShare,
      cfgCommunity.treasuryFee,
      { from: appManager }
    )
    await soloModule.setTotalKeys(100, { from: appManager })
    await soloModule.setTotalUsedKeys(50, { from: appManager })
    await soloModule.setTotalStoppedKeys(100, { from: appManager })

    stakingModules = [curatedModule, soloModule]
  })

  it('Rewards distribution fills treasury', async () => {
    const depositAmount = ETH(1)
    const treasuryRewards = (depositAmount * 500) / TOTAL_BASIS_POINTS

    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(32) })

    const treasuryBalanceBefore = await app.balanceOf(treasuryAddr)
    await oracle.reportBeacon(100, 0, depositAmount, { from: appManager })

    const treasuryBalanceAfter = await app.balanceOf(treasuryAddr)
    assertBn(treasuryBalanceBefore.add(bn(treasuryRewards)).sub(bn(1)), treasuryBalanceAfter)
  })

  it('Rewards distribution fills modules', async () => {
    const depositAmount = ETH(1)
    const { modulesShares } = await stakingRouter.getSharesTable()
    const moduleFee = (depositAmount * modulesShares[0]) / TOTAL_BASIS_POINTS
    const rewards = (moduleFee * (await soloModule.getFee())) / TOTAL_BASIS_POINTS

    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(32) })

    const moduleBalanceBefore = await app.balanceOf(soloModule.address)

    await oracle.reportBeacon(100, 0, depositAmount, { from: appManager })

    const moduleBalanceAfter = await app.balanceOf(soloModule.address)
    assertBn(moduleBalanceBefore.add(bn(rewards).sub(bn(1))), moduleBalanceAfter)
  })
})
