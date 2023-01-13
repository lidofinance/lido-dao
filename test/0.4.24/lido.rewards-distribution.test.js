const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistryMock')

const Lido = artifacts.require('LidoMock.sol')
const OracleMock = artifacts.require('OracleMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')
const StakingRouter = artifacts.require('StakingRouterMock.sol')
const ModuleSolo = artifacts.require('ModuleSolo.sol')
const IStakingModule = artifacts.require('contracts/0.8.9/interfaces/IStakingModule.sol:IStakingModule')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')

const cfgCurated = {
  moduleFee: 500,
  treasuryFee: 500,
  targetShare: 10000
}

const cfgCommunity = {
  moduleFee: 566,
  treasuryFee: 123,
  targetShare: 5000
}

contract('Lido', ([appManager, voting, user2]) => {
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
    await curatedModule.initialize(app.address, '0x01')

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.PAUSE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.RESUME_ROLE(), appManager, { from: appManager })
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

    await acl.createPermission(voting, curatedModule.address, await curatedModule.SET_NODE_OPERATOR_NAME_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(voting, curatedModule.address, await curatedModule.SET_NODE_OPERATOR_ADDRESS_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(voting, curatedModule.address, await curatedModule.SET_NODE_OPERATOR_LIMIT_ROLE(), appManager, {
      from: appManager
    })

    // Initialize the app's proxy.
    await app.initialize(oracle.address, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS)

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
    const wc = '0x'.padEnd(66, '1234')
    await stakingRouter.initialize(appManager, app.address, wc)

    // Set up the staking router permissions.
    const MODULE_MANAGE_ROLE = await stakingRouter.MODULE_MANAGE_ROLE()

    await stakingRouter.grantRole(MODULE_MANAGE_ROLE, voting, { from: appManager })

    await app.setStakingRouter(stakingRouter.address, { from: voting })

    soloModule = await ModuleSolo.new(app.address, { from: appManager })

    await stakingRouter.addModule('Curated', curatedModule.address, cfgCurated.targetShare, cfgCurated.moduleFee, cfgCurated.treasuryFee, {
      from: voting
    })

    await curatedModule.increaseTotalSigningKeysCount(500_000, { from: appManager })
    await curatedModule.increaseDepositedSigningKeysCount(499_950, { from: appManager })
    await curatedModule.increaseVettedSigningKeysCount(499_950, { from: appManager })

    await stakingRouter.addModule('Solo', soloModule.address, cfgCommunity.targetShare, cfgCommunity.moduleFee, cfgCommunity.treasuryFee, {
      from: voting
    })
    await soloModule.setTotalKeys(100, { from: appManager })
    await soloModule.setTotalUsedKeys(10, { from: appManager })
    await soloModule.setTotalStoppedKeys(0, { from: appManager })
  })

  it.skip('Rewards distribution fills treasury', async () => {
    // TODO: fix. broken after merging
    const beaconBalance = ETH(1)
    const { moduleFees, totalFee, precisionPoints } = await stakingRouter.getStakingRewardsDistribution()
    const treasuryShare = moduleFees.reduce((total, share) => total.sub(share), totalFee)
    const treasuryRewards = bn(beaconBalance).mul(treasuryShare).div(precisionPoints)
    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(32) })

    const treasuryBalanceBefore = await app.balanceOf(treasuryAddr)
    await oracle.reportBeacon(100, 0, beaconBalance, { from: appManager })

    const treasuryBalanceAfter = await app.balanceOf(treasuryAddr)
    assert(treasuryBalanceAfter.gt(treasuryBalanceBefore))
    assertBn(fixRound(treasuryBalanceBefore.add(treasuryRewards)), fixRound(treasuryBalanceAfter))
  })

  it.skip('Rewards distribution fills modules', async () => {
    // TODO: fix. broken after merging
    const beaconBalance = ETH(1)
    const { recipients, moduleFees, precisionPoints } = await stakingRouter.getStakingRewardsDistribution()

    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(32) })

    const moduleBalanceBefore = []
    for (let i = 0; i < recipients.length; i++) {
      moduleBalanceBefore.push(await app.balanceOf(recipients[i]))
    }

    await oracle.reportBeacon(100, 0, beaconBalance, { from: appManager })

    for (let i = 0; i < recipients.length; i++) {
      const moduleBalanceAfter = await app.balanceOf(recipients[i])
      const moduleRewards = bn(beaconBalance).mul(moduleFees[i]).div(precisionPoints)
      assert(moduleBalanceAfter.gt(moduleBalanceBefore[i]))
      assertBn(fixRound(moduleBalanceBefore[i].add(moduleRewards)), fixRound(moduleBalanceAfter))
    }
  })
})

function fixRound(n) {
  const _fix = bn(5) // +/- 5wei
  const _base = bn(10)
  return n.add(_fix).div(_base).mul(_base)
}
