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
const IStakingModule = artifacts.require('contracts/0.8.9/interfaces/IStakingModule.sol:IStakingModule')

const TOTAL_BASIS_POINTS = 10000
const ETH = (value) => web3.utils.toWei(value + '', 'ether')

const cfgCurated = {
  moduleFee: 500,
  treasuryFee: 500,
  targetShare: 10000
}

const cfgCommunity = {
  moduleFee: 750,
  treasuryFee: 250,
  targetShare: 5000
}

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
    await curatedModule.initialize()

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.PAUSE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.RESUME_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.MANAGE_FEE(), appManager, { from: appManager })
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
    await app.initialize(oracle.address)

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
    await stakingRouter.initialize(appManager, wc)

    // Set up the staking router permissions.
    const MODULE_MANAGE_ROLE = await stakingRouter.MODULE_MANAGE_ROLE()

    await stakingRouter.grantRole(MODULE_MANAGE_ROLE, voting, { from: appManager })

    await app.setStakingRouter(stakingRouter.address, { from: voting })
    await app.setMaxFee(1000, { from: voting })

    soloModule = await ModuleSolo.new(app.address, { from: appManager })

    await stakingRouter.addModule('Curated', curatedModule.address, cfgCurated.targetShare, cfgCurated.treasuryFee, cfgCurated.moduleFee, {
      from: voting
    })

    await curatedModule.setAvailableKeysCount(50, { from: appManager })
    await curatedModule.setActiveKeysCount(50, { from: appManager })

    await stakingRouter.addModule('Solo', soloModule.address, cfgCommunity.targetShare, cfgCommunity.treasuryFee, cfgCommunity.moduleFee, {
      from: voting
    })
    await soloModule.setTotalKeys(100, { from: appManager })
    await soloModule.setTotalUsedKeys(10, { from: appManager })
    await soloModule.setTotalStoppedKeys(0, { from: appManager })
  })

  it('Rewards distribution fills treasury', async () => {
    const depositAmount = ETH(1)
    const { moduleFees, totalFee } = await stakingRouter.getStakingRewardsDistribution()
    const treasuryShare = moduleFees.reduce((total, share) => total - share, totalFee)
    const treasuryRewards = (treasuryShare * depositAmount) / TOTAL_BASIS_POINTS

    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(32) })

    const treasuryBalanceBefore = fixRound(await app.balanceOf(treasuryAddr))
    await oracle.reportBeacon(100, 0, depositAmount, { from: appManager })

    const treasuryBalanceAfter = fixRound(await app.balanceOf(treasuryAddr))
    assertBn(treasuryBalanceBefore.add(bn(treasuryRewards)), treasuryBalanceAfter)
  })

  it('Rewards distribution fills modules', async () => {
    const depositAmount = ETH(1)
    const { recipients, moduleFees } = await stakingRouter.getStakingRewardsDistribution()

    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(32) })

    const moduleBalanceBefore = []
    for (let i = 0; i < recipients.length; i++) {
      moduleBalanceBefore.push(fixRound(await app.balanceOf(recipients[i])))
    }

    await oracle.reportBeacon(100, 0, depositAmount, { from: appManager })

    for (let i = 0; i < recipients.length; i++) {
      const moduleBalanceAfter = fixRound(await app.balanceOf(recipients[i]))
      const moduleRewards = (depositAmount * moduleFees[i]) / TOTAL_BASIS_POINTS
      assertBn(moduleBalanceBefore[i].add(bn(moduleRewards)), moduleBalanceAfter)
    }
  })
})

function fixRound(n) {
  const _fix = bn(3) // +/- 3wei
  const _base = bn(10)
  return n.add(_fix).div(_base).mul(_base)
  // const _n = n.add(_fix).div(_base).mul(_base)
  // console.log({ orig: n.toString(), fixed: _n.toString() })
  // return _n
}
