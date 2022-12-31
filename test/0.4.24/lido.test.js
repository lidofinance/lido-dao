const { hash } = require('eth-ens-namehash')
const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { getInstalledApp } = require('@aragon/contract-helpers-test/src/aragon-os')
const { assertBn, assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS, bn, getEventAt } = require('@aragon/contract-helpers-test')
const { BN } = require('bn.js')
const { formatEther } = require('ethers/lib/utils')
const { getEthBalance, formatStEth, formatBN, hexConcat, pad, ETH, tokens } = require('../helpers/utils')
const nodeOperators = require('../helpers/node-operators')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

const Lido = artifacts.require('LidoMock.sol')
const ELRewardsVault = artifacts.require('LidoExecutionLayerRewardsVault.sol')
const OracleMock = artifacts.require('OracleMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')
const ERC20Mock = artifacts.require('ERC20Mock.sol')
const VaultMock = artifacts.require('AragonVaultMock.sol')
const RewardEmulatorMock = artifacts.require('RewardEmulatorMock.sol')
const StakingRouter = artifacts.require('StakingRouterMock.sol')
const BeaconChainDepositorMock = artifacts.require('BeaconChainDepositorMock.sol')

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'
const ADDRESS_3 = '0x0000000000000000000000000000000000000003'
const ADDRESS_4 = '0x0000000000000000000000000000000000000004'

const UNLIMITED = 1000000000
const TOTAL_BASIS_POINTS = 10000
const TOTAL_PRECISION_BASIS_POINTS = bn(10).pow(bn(20)) // 100 * 10e18
const toPrecBP = (bp) => bn(bp).mul(TOTAL_PRECISION_BASIS_POINTS).div(bn(10000))

const assertNoEvent = (receipt, eventName, msg) => {
  const event = getEventAt(receipt, eventName)
  assert.equal(event, undefined, msg)
}

// Divides a BN by 1e15
const div15 = (bn) => bn.div(new BN('1000000000000000'))
const MAX_DEPOSITS = 150
const CURATED_MODULE_ID = 1
const CALLDATA = '0x0'

const STETH = ETH

contract('Lido', ([appManager, voting, user1, user2, user3, nobody, depositor, treasury]) => {
  let appBase, nodeOperatorsRegistryBase, app, oracle, depositContract, operators
  let treasuryAddr
  let dao, acl
  let elRewardsVault, rewarder
  let stakingRouter
  let beaconChainDepositor
  let yetAnotherOracle, anyToken

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
    await operators.initialize(app.address, '0x01')

    // StakingRouter
    stakingRouter = await StakingRouter.new(depositContract.address)
    await stakingRouter.initialize(appManager, app.address, ZERO_ADDRESS)
    await stakingRouter.grantRole(await stakingRouter.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(), voting, { from: appManager })
    await stakingRouter.grantRole(await stakingRouter.MODULE_MANAGE_ROLE(), voting, { from: appManager })
    await stakingRouter.grantRole(await stakingRouter.STAKING_ROUTER_DEPOSIT_ROLE(), app.address, { from: appManager })

    // BeaconChainDepositor
    beaconChainDepositor = await BeaconChainDepositorMock.new(depositContract.address)

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
    await acl.createPermission(stakingRouter.address, operators.address, await operators.INVALIDATE_READY_TO_DEPOSIT_KEYS(), appManager, {
      from: appManager
    })

    // Initialize the app's proxy.
    await app.initialize(oracle.address, treasury, stakingRouter.address, depositor)

    await stakingRouter.addModule(
      'Curated',
      operators.address,
      10_000, // 100 % _targetShare
      500, // 5 % _moduleFee
      500, // 5 % _treasuryFee
      { from: voting }
    )

    assert((await app.isStakingPaused()) === true)
    assert((await app.isStopped()) === true)
    await app.resume({ from: voting })
    assert((await app.isStakingPaused()) === false)
    assert((await app.isStopped()) === false)

    treasuryAddr = await app.getTreasury()

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

  const checkStat = async ({ depositedValidators, beaconValidators, beaconBalance }) => {
    const stat = await app.getBeaconStat()
    assertBn(stat.depositedValidators, depositedValidators, 'depositedValidators check')
    assertBn(stat.beaconValidators, beaconValidators, 'beaconValidators check')
    assertBn(stat.beaconBalance, beaconBalance, 'beaconBalance check')
  }

  // Assert reward distribution. The values must be divided by 1e15.
  const checkRewards = async ({ treasury, operator }) => {
    const [treasury_b, operators_b, a1, a2, a3, a4] = await Promise.all([
      app.balanceOf(treasuryAddr),
      app.balanceOf(operators.address),
      app.balanceOf(ADDRESS_1),
      app.balanceOf(ADDRESS_2),
      app.balanceOf(ADDRESS_3),
      app.balanceOf(ADDRESS_4)
    ])

    assertBn(div15(treasury_b), treasury, 'treasury token balance check')
    assertBn(div15(operators_b.add(a1).add(a2).add(a3).add(a4)), operator, 'node operators token balance check')
  }

  async function getStEthBalance(address) {
    return formatStEth(await app.balanceOf(address))
  }

  const logLidoState = async () => {
    const elRewardsVaultBalance = await getEthBalance(elRewardsVault.address)
    const lidoBalance = await getEthBalance(app.address)
    const lidoTotalSupply = formatBN(await app.totalSupply())
    const lidoTotalPooledEther = formatBN(await app.getTotalPooledEther())
    const lidoBufferedEther = formatBN(await app.getBufferedEther())
    const lidoTotalShares = formatBN(await app.getTotalShares())
    const beaconStat = await app.getBeaconStat()
    const depositedValidators = beaconStat.depositedValidators.toString()
    const beaconValidators = beaconStat.beaconValidators.toString()
    const beaconBalance = formatEther(beaconStat.beaconBalance)

    console.log({
      elRewardsVaultBalance,
      lidoBalance,
      lidoTotalSupply,
      lidoTotalPooledEther,
      lidoBufferedEther,
      lidoTotalShares,
      depositedValidators,
      beaconValidators,
      beaconBalance
    })
  }

  const logBalances = async () => {
    const user2stEthBalance = await getStEthBalance(user2)
    const treasuryStEthBalance = await getStEthBalance(treasuryAddr)
    console.log({ user2stEthBalance, treasuryStEthBalance })
  }

  const logAll = async () => {
    await logLidoState()
    await logBalances()
    console.log()
  }

  const setupNodeOperatorsForELRewardsVaultTests = async (userAddress, initialDepositAmount) => {
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

    const [curated] = await stakingRouter.getStakingModules()

    await web3.eth.sendTransaction({ to: app.address, from: userAddress, value: initialDepositAmount })

    // deposit(maxDeposits, stakingModuleId, calldata)
    await app.methods[`deposit(uint256,uint24,bytes)`](MAX_DEPOSITS, curated.id, CALLDATA, { from: depositor })
  }

  it('Execution layer rewards distribution works when zero rewards reported', async () => {
    const depositAmount = 32
    const elRewards = depositAmount / TOTAL_BASIS_POINTS
    const beaconRewards = 0

    await setupNodeOperatorsForELRewardsVaultTests(user2, ETH(depositAmount))
    await oracle.reportBeacon(100, 1, ETH(depositAmount))

    await rewarder.reward({ from: user1, value: ETH(elRewards) })
    await oracle.reportBeacon(101, 1, ETH(depositAmount + beaconRewards))

    assertBn(await app.getTotalPooledEther(), ETH(depositAmount + elRewards + beaconRewards))
    assertBn(await app.totalSupply(), ETH(depositAmount + elRewards + beaconRewards))
    assertBn(await app.balanceOf(user2), STETH(depositAmount + elRewards))
    assertBn(await app.getTotalELRewardsCollected(), ETH(elRewards))
  })

  it('Execution layer rewards distribution works when negative rewards reported', async () => {
    const depositAmount = 32
    const elRewards = depositAmount / TOTAL_BASIS_POINTS
    const beaconRewards = -2

    await setupNodeOperatorsForELRewardsVaultTests(user2, ETH(depositAmount))
    await oracle.reportBeacon(100, 1, ETH(depositAmount))

    await rewarder.reward({ from: user1, value: ETH(elRewards) })
    await oracle.reportBeacon(101, 1, ETH(depositAmount + beaconRewards))

    assertBn(await app.getTotalPooledEther(), ETH(depositAmount + elRewards + beaconRewards))
    assertBn(await app.balanceOf(user2), STETH(depositAmount + elRewards + beaconRewards))
    assertBn(await app.getTotalELRewardsCollected(), ETH(elRewards))
  })

  it('Execution layer rewards distribution works when positive rewards reported', async () => {
    const depositAmount = 32
    const elRewards = depositAmount / TOTAL_BASIS_POINTS
    const beaconRewards = 3

    await setupNodeOperatorsForELRewardsVaultTests(user2, ETH(depositAmount))
    await oracle.reportBeacon(100, 1, ETH(depositAmount))

    await rewarder.reward({ from: user1, value: ETH(elRewards) })
    await oracle.reportBeacon(101, 1, ETH(depositAmount + beaconRewards))

    assertBn(await app.getTotalPooledEther(), ETH(depositAmount + elRewards + beaconRewards))
    assertBn(await app.getTotalELRewardsCollected(), ETH(elRewards))

    const protocolPrecisionFeePoints = await app.getFee()
    const stakersReward = bn(ETH(elRewards + beaconRewards))
      .mul(TOTAL_PRECISION_BASIS_POINTS.sub(protocolPrecisionFeePoints))
      .div(TOTAL_PRECISION_BASIS_POINTS)
    assertBn(await app.balanceOf(user2), bn(STETH(depositAmount)).add(stakersReward))
  })

  it('Attempt to set invalid execution layer rewards withdrawal limit', async () => {
    const initialValue = await app.getELRewardsWithdrawalLimit()

    assertEvent(await app.setELRewardsWithdrawalLimit(1, { from: voting }), 'ELRewardsWithdrawalLimitSet', {
      expectedArgs: { limitPoints: 1 }
    })

    await assertNoEvent(app.setELRewardsWithdrawalLimit(1, { from: voting }), 'ELRewardsWithdrawalLimitSet')

    await app.setELRewardsWithdrawalLimit(10000, { from: voting })
    await assertRevert(app.setELRewardsWithdrawalLimit(10001, { from: voting }), 'VALUE_OVER_100_PERCENT')

    await app.setELRewardsWithdrawalLimit(initialValue, { from: voting })

    // unable to receive execution layer rewards from arbitrary account
    assertRevert(app.receiveELRewards({ from: user1, value: ETH(1) }))
  })

  it('setStakingRouter event works', async () => {
    assert.equal(await app.getStakingRouter(), stakingRouter.address)

    assertEvent(await app.setStakingRouter(voting, { from: voting }), 'StakingRouterSet', {
      expectedArgs: { stakingRouterAddress: voting }
    })

    assert.equal(await app.getStakingRouter(), voting)
  })

  it('setDepositSecurityModule event works', async () => {
    assert.equal(await app.getDepositSecurityModule(), depositor)

    assertEvent(await app.setDepositSecurityModule(voting, { from: voting }), 'DepositSecurityModuleSet', {
      expectedArgs: { dsmAddress: voting }
    })

    assert.equal(await app.getDepositSecurityModule(), voting)
  })

  it('setModulesFee works', async () => {
    const [curated] = await stakingRouter.getStakingModules()

    let module1 = await stakingRouter.getStakingModule(curated.id)
    assertBn(module1.targetShare, 10000)
    assertBn(module1.moduleFee, 500)
    assertBn(module1.treasuryFee, 500)

    // stakingModuleId, targetShare, moduleFee, treasuryFee
    await stakingRouter.updateStakingModule(module1.id, module1.targetShare, 300, 700, { from: voting })

    module1 = await stakingRouter.getStakingModule(curated.id)

    await assertRevert(
      stakingRouter.updateStakingModule(module1.id, module1.targetShare, 300, 700, { from: user1 }),
      `AccessControl: account ${user1.toLowerCase()} is missing role ${await stakingRouter.MODULE_MANAGE_ROLE()}`
    )

    await assertRevert(
      stakingRouter.updateStakingModule(module1.id, module1.targetShare, 300, 700, { from: nobody }),
      `AccessControl: account ${nobody.toLowerCase()} is missing role ${await stakingRouter.MODULE_MANAGE_ROLE()}`
    )

    await assertRevert(
      stakingRouter.updateStakingModule(module1.id, 10001, 300, 700, { from: voting }),
      `ed with custom error 'ErrorValueOver100Percent("_targetShare")`
    )

    await assertRevert(
      stakingRouter.updateStakingModule(module1.id, 10000, 10001, 700, { from: voting }),
      `ed with custom error 'ErrorValueOver100Percent("_moduleFee + _treasuryFee")`
    )

    await assertRevert(
      stakingRouter.updateStakingModule(module1.id, 10000, 300, 10001, { from: voting }),
      `ed with custom error 'ErrorValueOver100Percent("_moduleFee + _treasuryFee")`
    )

    // distribution fee calculates on active keys in modules
    const depositAmount = 32
    await setupNodeOperatorsForELRewardsVaultTests(user2, ETH(depositAmount))

    const totalFee = await app.getFee()
    assertBn(totalFee, toPrecBP(1000))

    const distribution = await app.getFeeDistribution({ from: nobody })
    assertBn(distribution.modulesFee, toPrecBP(300))
    assertBn(distribution.treasuryFee, toPrecBP(700))
  })

  it('setWithdrawalCredentials works', async () => {
    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await assertRevert(
      stakingRouter.setWithdrawalCredentials(pad('0x0203', 32), { from: user1 }),
      `AccessControl: account ${user1.toLowerCase()} is missing role ${await stakingRouter.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE()}`
    )

    assert.equal(await stakingRouter.getWithdrawalCredentials(), pad('0x0202', 32))
    assert.equal(await app.getWithdrawalCredentials(), pad('0x0202', 32))
  })

  it('setOracle works', async () => {
    await assertRevert(app.setProtocolContracts(ZERO_ADDRESS, user2, { from: voting }), 'ORACLE_ZERO_ADDRESS')
    const receipt = await app.setProtocolContracts(yetAnotherOracle.address, oracle.address, { from: voting })
    assertEvent(receipt, 'ProtocolContactsSet', {
      expectedArgs: {
        oracle: yetAnotherOracle.address,
        treasury: oracle.address,
        insuranceFund: ZERO_ADDRESS
      }
    })
    assert.equal(await app.getOracle(), yetAnotherOracle.address)
  })

  it('setWithdrawalCredentials resets unused keys', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(1, 2, hexConcat(pad('0x050505', 48), pad('0x060606', 48)), hexConcat(pad('0x02', 96), pad('0x03', 96)), {
      from: voting
    })

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 1)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 2)

    await stakingRouter.setWithdrawalCredentials(pad('0x0203', 32), { from: voting })

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 0)
    assert.equal(await app.getWithdrawalCredentials({ from: nobody }), pad('0x0203', 32))
  })

  it('pad64 works', async () => {
    await assertRevert(beaconChainDepositor.pad64('0x'))
    await assertRevert(beaconChainDepositor.pad64('0x11'))
    await assertRevert(beaconChainDepositor.pad64('0x1122'))
    await assertRevert(beaconChainDepositor.pad64(pad('0x1122', 31)))
    await assertRevert(beaconChainDepositor.pad64(pad('0x1122', 65)))
    await assertRevert(beaconChainDepositor.pad64(pad('0x1122', 265)))

    assert.equal(await beaconChainDepositor.pad64(pad('0x1122', 32)), pad('0x1122', 32) + '0'.repeat(64))
    assert.equal(await beaconChainDepositor.pad64(pad('0x1122', 36)), pad('0x1122', 36) + '0'.repeat(56))
    assert.equal(await beaconChainDepositor.pad64(pad('0x1122', 64)), pad('0x1122', 64))
  })

  it('Lido.deposit(uint256,uint24,bytes) reverts when called by account without DEPOSIT_ROLE granted', async () => {
    await assertRevert(
      app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: nobody }),
      'APP_AUTH_DSM_FAILED'
    )
  })

  it('deposit works', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

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

    // zero deposits revert
    await assertRevert(app.submit(ZERO_ADDRESS, { from: user1, value: ETH(0) }), 'ZERO_DEPOSIT')
    await assertRevert(web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(0) }), 'ZERO_DEPOSIT')

    // can not deposit with unset withdrawalCredentials
    await assertRevert(
      app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor }),
      `ErrorEmptyWithdrawalsCredentials`
    )
    // set withdrawalCredentials with keys, because they were trimmed
    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    // +1 ETH
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(1) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await depositContract.totalCalls(), 0)
    assertBn(await app.getTotalPooledEther(), ETH(1))
    assertBn(await app.getTotalELRewardsCollected(), 0)
    assertBn(await app.balanceOf(user1), tokens(1))
    assertBn(await app.totalSupply(), tokens(1))

    // +2 ETH
    const receipt = await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2) }) // another form of a deposit call

    assertEvent(receipt, 'Transfer', { expectedArgs: { from: ZERO_ADDRESS, to: user2, value: ETH(2) } })

    await checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await depositContract.totalCalls(), 0)
    assertBn(await app.getTotalPooledEther(), ETH(3))
    assertBn(await app.getTotalELRewardsCollected(), 0)
    assertBn(await app.balanceOf(user2), tokens(2))
    assertBn(await app.totalSupply(), tokens(3))

    // +30 ETH
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(30) })

    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    // now deposit works
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(33))
    assertBn(await app.getBufferedEther(), ETH(1))
    assertBn(await app.balanceOf(user1), tokens(1))
    assertBn(await app.balanceOf(user2), tokens(2))
    assertBn(await app.balanceOf(user3), tokens(30))
    assertBn(await app.totalSupply(), tokens(33))

    assertBn(await depositContract.totalCalls(), 1)
    const c0 = await depositContract.calls.call(0)
    assert.equal(c0.pubkey, pad('0x010203', 48))
    assert.equal(c0.withdrawal_credentials, pad('0x0202', 32))
    assert.equal(c0.signature, pad('0x01', 96))
    assertBn(c0.value, ETH(32))

    // +100 ETH, test partial unbuffering
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(100) })
    await app.deposit(1, 1, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 2, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(133))
    assertBn(await app.getBufferedEther(), ETH(69))
    assertBn(await app.balanceOf(user1), tokens(101))
    assertBn(await app.balanceOf(user2), tokens(2))
    assertBn(await app.balanceOf(user3), tokens(30))
    assertBn(await app.totalSupply(), tokens(133))

    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 4, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(133))
    assertBn(await app.getBufferedEther(), ETH(5))
    assertBn(await app.balanceOf(user1), tokens(101))
    assertBn(await app.balanceOf(user2), tokens(2))
    assertBn(await app.balanceOf(user3), tokens(30))
    assertBn(await app.totalSupply(), tokens(133))

    assertBn(await depositContract.totalCalls(), 4)
    const calls = {}
    for (const i of [1, 2, 3]) {
      calls[i] = await depositContract.calls.call(i)
      assert.equal(calls[i].withdrawal_credentials, pad('0x0202', 32))
      assert.equal(calls[i].signature, pad('0x01', 96))
      assertBn(calls[i].value, ETH(32))
    }
    assert.equal(calls[1].pubkey, pad('0x010204', 48))
    assert.equal(calls[2].pubkey, pad('0x010205', 48))
    assert.equal(calls[3].pubkey, pad('0x010206', 48))
  })

  it('deposit uses the expected signing keys', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    const op0 = {
      keys: Array.from({ length: 3 }, (_, i) => `0x11${i}${i}` + 'abcd'.repeat(46 / 2)),
      sigs: Array.from({ length: 3 }, (_, i) => `0x11${i}${i}` + 'cdef'.repeat(94 / 2))
    }

    const op1 = {
      keys: Array.from({ length: 3 }, (_, i) => `0x22${i}${i}` + 'efab'.repeat(46 / 2)),
      sigs: Array.from({ length: 3 }, (_, i) => `0x22${i}${i}` + 'fcde'.repeat(94 / 2))
    }

    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addSigningKeys(0, 3, hexConcat(...op0.keys), hexConcat(...op0.sigs), { from: voting })
    await operators.addSigningKeys(1, 3, hexConcat(...op1.keys), hexConcat(...op1.sigs), { from: voting })

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(32) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    assertBn(await depositContract.totalCalls(), 1, 'first submit: total deposits')

    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2 * 32) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    assertBn(await depositContract.totalCalls(), 3, 'second submit: total deposits')

    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(3 * 32) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    assertBn(await depositContract.totalCalls(), 6, 'third submit: total deposits')

    const calls = await Promise.all(Array.from({ length: 6 }, (_, i) => depositContract.calls(i)))
    const keys = [...op0.keys, ...op1.keys]
    const sigs = [...op0.sigs, ...op1.sigs]
    const pairs = keys.map((key, i) => `${key}|${sigs[i]}`)

    assert.sameMembers(
      calls.map((c) => `${c.pubkey}|${c.signature}`),
      pairs,
      'pairs'
    )
  })

  it('deposit works when the first node operator is inactive', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(1, 1, pad('0x030405', 48), pad('0x06', 96), { from: voting })

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await operators.deactivateNodeOperator(0, { from: voting })
    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(32) })

    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    assertBn(await depositContract.totalCalls(), 1)
  })

  it('submits with zero and non-zero referrals work', async () => {
    const REFERRAL = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF'
    let receipt
    receipt = await app.submit(REFERRAL, { from: user2, value: ETH(2) })
    assertEvent(receipt, 'Submitted', { expectedArgs: { sender: user2, amount: ETH(2), referral: REFERRAL } })
    receipt = await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(5) })
    assertEvent(receipt, 'Submitted', { expectedArgs: { sender: user2, amount: ETH(5), referral: ZERO_ADDRESS } })
  })

  const verifyStakeLimitState = async (
    expectedMaxStakeLimit,
    expectedLimitIncrease,
    expectedCurrentStakeLimit,
    expectedIsStakingPaused,
    expectedIsStakingLimited
  ) => {
    currentStakeLimit = await app.getCurrentStakeLimit()
    assertBn(currentStakeLimit, expectedCurrentStakeLimit)

    isStakingPaused = await app.isStakingPaused()
    assert.equal(isStakingPaused, expectedIsStakingPaused)
    ;({
      isStakingPaused,
      isStakingLimitSet,
      currentStakeLimit,
      maxStakeLimit,
      maxStakeLimitGrowthBlocks,
      prevStakeLimit,
      prevStakeBlockNumber
    } = await app.getStakeLimitFullInfo())

    assertBn(currentStakeLimit, expectedCurrentStakeLimit)
    assertBn(maxStakeLimit, expectedMaxStakeLimit)
    assert.equal(isStakingPaused, expectedIsStakingPaused)
    assert.equal(isStakingLimitSet, expectedIsStakingLimited)

    if (isStakingLimitSet) {
      assertBn(maxStakeLimitGrowthBlocks, expectedLimitIncrease > 0 ? expectedMaxStakeLimit / expectedLimitIncrease : 0)
    }
  }

  it('staking pause & unlimited resume works', async () => {
    let receipt

    const MAX_UINT256 = bn(2).pow(bn(256)).sub(bn(1))
    await verifyStakeLimitState(bn(0), bn(0), MAX_UINT256, false, false)
    receipt = await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2) })
    assertEvent(receipt, 'Submitted', { expectedArgs: { sender: user2, amount: ETH(2), referral: ZERO_ADDRESS } })

    await assertRevert(app.pauseStaking(), 'APP_AUTH_FAILED')
    receipt = await app.pauseStaking({ from: voting })
    assertEvent(receipt, 'StakingPaused')
    verifyStakeLimitState(bn(0), bn(0), bn(0), true, false)

    await assertRevert(web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(2) }), `STAKING_PAUSED`)
    await assertRevert(app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2) }), `STAKING_PAUSED`)

    await assertRevert(app.resumeStaking(), 'APP_AUTH_FAILED')
    receipt = await app.resumeStaking({ from: voting })
    assertEvent(receipt, 'StakingResumed')
    await verifyStakeLimitState(bn(0), bn(0), MAX_UINT256, false, false)

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(1.1) })
    receipt = await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(1.4) })
    assertEvent(receipt, 'Submitted', { expectedArgs: { sender: user2, amount: ETH(1.4), referral: ZERO_ADDRESS } })
  })

  const mineNBlocks = async (n) => {
    for (let index = 0; index < n; index++) {
      await ethers.provider.send('evm_mine')
    }
  }

  it('staking resume with a limit works', async () => {
    let receipt

    const blocksToReachMaxStakeLimit = 300
    const expectedMaxStakeLimit = ETH(3)
    const limitIncreasePerBlock = bn(expectedMaxStakeLimit).div(bn(blocksToReachMaxStakeLimit)) // 1 * 10**16

    receipt = await app.resumeStaking({ from: voting })
    assertEvent(receipt, 'StakingResumed')

    await assertRevert(app.setStakingLimit(expectedMaxStakeLimit, limitIncreasePerBlock), 'APP_AUTH_FAILED')
    receipt = await app.setStakingLimit(expectedMaxStakeLimit, limitIncreasePerBlock, { from: voting })
    assertEvent(receipt, 'StakingLimitSet', {
      expectedArgs: {
        maxStakeLimit: expectedMaxStakeLimit,
        stakeLimitIncreasePerBlock: limitIncreasePerBlock
      }
    })

    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, expectedMaxStakeLimit, false, true)
    receipt = await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2) })
    assertEvent(receipt, 'Submitted', { expectedArgs: { sender: user2, amount: ETH(2), referral: ZERO_ADDRESS } })
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, ETH(1), false, true)
    await assertRevert(app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2.5) }), `STAKE_LIMIT`)
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, bn(ETH(1)).add(limitIncreasePerBlock), false, true)

    // expect to grow for another 1.5 ETH since last submit
    // every revert produces new block, so we need to account that block
    await mineNBlocks(blocksToReachMaxStakeLimit / 2 - 1)
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, ETH(2.5), false, true)
    await assertRevert(app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2.6) }), `STAKE_LIMIT`)
    receipt = await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2.5) })
    assertEvent(receipt, 'Submitted', { expectedArgs: { sender: user2, amount: ETH(2.5), referral: ZERO_ADDRESS } })
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, limitIncreasePerBlock.muln(2), false, true)

    await assertRevert(app.submit(ZERO_ADDRESS, { from: user2, value: ETH(0.1) }), `STAKE_LIMIT`)
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, limitIncreasePerBlock.muln(3), false, true)
    // once again, we are subtracting blocks number induced by revert checks
    await mineNBlocks(blocksToReachMaxStakeLimit / 3 - 4)

    receipt = await app.submit(ZERO_ADDRESS, { from: user1, value: ETH(1) })
    assertEvent(receipt, 'Submitted', { expectedArgs: { sender: user1, amount: ETH(1), referral: ZERO_ADDRESS } })
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, ETH(0), false, true)

    // check that limit is restored completely
    await mineNBlocks(blocksToReachMaxStakeLimit)
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, expectedMaxStakeLimit, false, true)

    // check that limit is capped by maxLimit value and doesn't grow infinitely
    await mineNBlocks(10)
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, expectedMaxStakeLimit, false, true)

    await assertRevert(app.setStakingLimit(ETH(0), ETH(0), { from: voting }), `ZERO_MAX_STAKE_LIMIT`)
    await assertRevert(app.setStakingLimit(ETH(1), ETH(1.1), { from: voting }), `TOO_LARGE_LIMIT_INCREASE`)
    await assertRevert(app.setStakingLimit(ETH(1), bn(10), { from: voting }), `TOO_SMALL_LIMIT_INCREASE`)
  })

  it('resume staking with an one-shot limit works', async () => {
    let receipt

    const expectedMaxStakeLimit = ETH(7)
    const limitIncreasePerBlock = 0

    receipt = await app.resumeStaking({ from: voting })
    assertEvent(receipt, 'StakingResumed')
    receipt = await app.setStakingLimit(expectedMaxStakeLimit, limitIncreasePerBlock, { from: voting })
    assertEvent(receipt, 'StakingLimitSet', {
      expectedArgs: {
        maxStakeLimit: expectedMaxStakeLimit,
        stakeLimitIncreasePerBlock: limitIncreasePerBlock
      }
    })

    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, expectedMaxStakeLimit, false, true)
    receipt = await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(5) })
    assertEvent(receipt, 'Submitted', { expectedArgs: { sender: user2, amount: ETH(5), referral: ZERO_ADDRESS } })
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, ETH(2), false, true)
    receipt = await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2) })
    assertEvent(receipt, 'Submitted', { expectedArgs: { sender: user2, amount: ETH(2), referral: ZERO_ADDRESS } })
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, ETH(0), false, true)
    await assertRevert(app.submit(ZERO_ADDRESS, { from: user2, value: ETH(0.1) }), `STAKE_LIMIT`)
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, ETH(0), false, true)
    await mineNBlocks(100)
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, ETH(0), false, true)
  })

  it('resume staking with various changing limits work', async () => {
    let receipt

    const expectedMaxStakeLimit = ETH(9)
    const limitIncreasePerBlock = bn(expectedMaxStakeLimit).divn(100)

    receipt = await app.resumeStaking({ from: voting })
    assertEvent(receipt, 'StakingResumed')
    receipt = await app.setStakingLimit(expectedMaxStakeLimit, limitIncreasePerBlock, { from: voting })
    assertEvent(receipt, 'StakingLimitSet', {
      expectedArgs: {
        maxStakeLimit: expectedMaxStakeLimit,
        stakeLimitIncreasePerBlock: limitIncreasePerBlock
      }
    })

    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, expectedMaxStakeLimit, false, true)

    const smallerExpectedMaxStakeLimit = ETH(5)
    const smallerLimitIncreasePerBlock = bn(smallerExpectedMaxStakeLimit).divn(200)

    receipt = await app.setStakingLimit(smallerExpectedMaxStakeLimit, smallerLimitIncreasePerBlock, { from: voting })
    assertEvent(receipt, 'StakingLimitSet', {
      expectedArgs: {
        maxStakeLimit: smallerExpectedMaxStakeLimit,
        stakeLimitIncreasePerBlock: smallerLimitIncreasePerBlock
      }
    })

    await verifyStakeLimitState(smallerExpectedMaxStakeLimit, smallerLimitIncreasePerBlock, smallerExpectedMaxStakeLimit, false, true)

    const largerExpectedMaxStakeLimit = ETH(10)
    const largerLimitIncreasePerBlock = bn(largerExpectedMaxStakeLimit).divn(1000)

    receipt = await app.setStakingLimit(largerExpectedMaxStakeLimit, largerLimitIncreasePerBlock, { from: voting })
    assertEvent(receipt, 'StakingLimitSet', {
      expectedArgs: {
        maxStakeLimit: largerExpectedMaxStakeLimit,
        stakeLimitIncreasePerBlock: largerLimitIncreasePerBlock
      }
    })

    await verifyStakeLimitState(largerExpectedMaxStakeLimit, largerLimitIncreasePerBlock, smallerExpectedMaxStakeLimit, false, true)

    await assertRevert(app.removeStakingLimit(), 'APP_AUTH_FAILED')
    receipt = await app.removeStakingLimit({ from: voting })
    assertEvent(receipt, 'StakingLimitRemoved')

    await verifyStakeLimitState(0, 0, bn(2).pow(bn(256)).sub(bn(1)), false, false)
  })

  it('reverts when trying to call unknown function', async () => {
    const wrongMethodABI = '0x00'
    await assertRevert(web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(1), data: wrongMethodABI }), 'NON_EMPTY_DATA')
    await assertRevert(web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(0), data: wrongMethodABI }), 'NON_EMPTY_DATA')
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

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(33) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    assertBn(await depositContract.totalCalls(), 1)
    await assertRevert(operators.removeSigningKey(0, 0, { from: voting }), 'KEY_WAS_USED')

    assertBn(await app.getBufferedEther(), ETH(1))

    await operators.removeSigningKey(0, 1, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(100) })

    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    assertBn(await depositContract.totalCalls(), 1)
    assertBn(await app.getTotalPooledEther(), ETH(133))
    assertBn(await app.getBufferedEther(), ETH(101))
  })

  it("out of signing keys doesn't revert but buffers", async () => {
    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(100) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await depositContract.totalCalls(), 1)
    assertBn(await app.getTotalPooledEther(), ETH(100))
    assertBn(await app.getBufferedEther(), ETH(100 - 32))

    // buffer unwinds
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(1) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await depositContract.totalCalls(), 3)
    assertBn(await app.getTotalPooledEther(), ETH(101))
    assertBn(await app.getBufferedEther(), ETH(5))
  })

  it('handleOracleReport works', async () => {
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

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(34) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })

    await assertRevert(app.handleOracleReport(1, ETH(30), { from: appManager }), 'APP_AUTH_FAILED')

    await oracle.reportBeacon(100, 1, ETH(30))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(30) })

    await assertRevert(app.handleOracleReport(1, ETH(29), { from: nobody }), 'APP_AUTH_FAILED')

    await oracle.reportBeacon(50, 1, ETH(100)) // stale data
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(100) })

    await oracle.reportBeacon(200, 1, ETH(33))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(33) })
  })

  it('oracle data affects deposits', async () => {
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

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(34) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await depositContract.totalCalls(), 1)
    assertBn(await app.getTotalPooledEther(), ETH(34))
    assertBn(await app.getBufferedEther(), ETH(2))

    // down
    await oracle.reportBeacon(100, 1, ETH(15))

    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(15) })
    assertBn(await depositContract.totalCalls(), 1)
    assertBn(await app.getTotalPooledEther(), ETH(17))
    assertBn(await app.getBufferedEther(), ETH(2))
    assertBn(await app.totalSupply(), tokens(17))

    // deposit, ratio is 0.5
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(2) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(15) })
    assertBn(await depositContract.totalCalls(), 1)
    assertBn(await app.getTotalPooledEther(), ETH(19))
    assertBn(await app.getBufferedEther(), ETH(4))
    assertBn(await app.balanceOf(user1), tokens(2))
    assertBn(await app.totalSupply(), tokens(19))

    // up
    await assertRevert(oracle.reportBeacon(200, 2, ETH(48)), 'REPORTED_MORE_DEPOSITED')
    await oracle.reportBeacon(200, 1, ETH(48))

    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(48) })
    assertBn(await depositContract.totalCalls(), 1)
    assertBn(await app.getTotalPooledEther(), ETH(52))
    assertBn(await app.getBufferedEther(), ETH(4))
    assertBn(await app.totalSupply(), tokens(52))
  })

  it('can stop and resume', async () => {
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

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(40) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getBufferedEther(), ETH(8))

    await assertRevert(app.stop({ from: user2 }), 'APP_AUTH_FAILED')
    await app.stop({ from: voting })
    assert((await app.isStakingPaused()) === true)

    await assertRevert(web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(4) }), 'STAKING_PAUSED')
    await assertRevert(web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(4) }), 'STAKING_PAUSED')
    await assertRevert(app.submit('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', { from: user1, value: ETH(4) }), 'STAKING_PAUSED')

    await assertRevert(app.resume({ from: user2 }), 'APP_AUTH_FAILED')
    await app.resume({ from: voting })
    assert((await app.isStakingPaused()) === false)

    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(4) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getBufferedEther(), ETH(12))
  })

  it('rewards distribution works in a simple case', async () => {
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

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(34) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await oracle.reportBeacon(300, 1, ETH(36))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(36) })
    assertBn(await app.totalSupply(), ETH(38)) // remote + buffered
    await checkRewards({ treasury: 199, operator: 199 })
  })

  it('rewards distribution works', async () => {
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

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(34) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    // some slashing occurred
    await oracle.reportBeacon(100, 1, ETH(30))

    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(30) })
    // ToDo check buffer=2
    assertBn(await app.totalSupply(), tokens(32)) // 30 remote (slashed) + 2 buffered = 32
    await checkRewards({ treasury: 0, operator: 0 })

    // rewarded 200 Ether (was 30, became 230)
    await oracle.reportBeacon(200, 1, ETH(130))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(130) })
    // Todo check reward effects
    // await checkRewards({ treasury: 0, insurance: 0, operator: 0 })

    await oracle.reportBeacon(300, 1, ETH(2230))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(2230) })
    assertBn(await app.totalSupply(), tokens(2232))
    // Todo check reward effects
    // await checkRewards({ treasury: tokens(33), insurance: tokens(22), operator: tokens(55) })
  })

  it('deposits accounted properly during rewards distribution', async () => {
    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    // Only 32 ETH deposited
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(32) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(32) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    assertBn(await app.totalSupply(), tokens(64))

    await oracle.reportBeacon(300, 1, ETH(36))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(36) })
    assertBn(await app.totalSupply(), tokens(68))
    await checkRewards({ treasury: 200, operator: 199 })
  })

  it('Node Operators filtering during deposit works when doing a huge deposit', async () => {
    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    // id: 0
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'good', rewardAddress: ADDRESS_1, totalSigningKeys: 2, stakingLimit: UNLIMITED },
      { from: voting }
    )

    // id: 1
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'limited', rewardAddress: ADDRESS_2, totalSigningKeys: 2, stakingLimit: 1 },
      { from: voting }
    )

    // id: 2
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'deactivated', rewardAddress: ADDRESS_3, totalSigningKeys: 2, stakingLimit: 2, isActive: false },
      { from: voting }
    )

    // id: 3
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'short on keys', rewardAddress: ADDRESS_4, stakingLimit: UNLIMITED },
      { from: voting }
    )

    // Deposit huge chunk
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(32 * 3 + 50) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(146))
    assertBn(await app.getBufferedEther(), ETH(50))
    assertBn(await depositContract.totalCalls(), 3)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Next deposit changes nothing
    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(32) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(178))
    assertBn(await app.getBufferedEther(), ETH(82))
    assertBn(await depositContract.totalCalls(), 3)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // #1 goes below the limit
    await operators.reportStoppedValidators(1, 1, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(179))
    assertBn(await app.getBufferedEther(), ETH(83))
    assertBn(await depositContract.totalCalls(), 3)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Adding a key will help
    await operators.addSigningKeys(0, 1, pad('0x0003', 48), pad('0x01', 96), { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 4, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(180))
    assertBn(await app.getBufferedEther(), ETH(52))
    assertBn(await depositContract.totalCalls(), 4)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Reactivation of #2 doesn't change anything cause keys of #2 was trimmed
    await operators.activateNodeOperator(2, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(12) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 4, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(192))
    assertBn(await app.getBufferedEther(), ETH(64))
    assertBn(await depositContract.totalCalls(), 4)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)
  })

  it('Node Operators filtering during deposit works when doing small deposits', async () => {
    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    // id: 0
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'good', rewardAddress: ADDRESS_1, stakingLimit: UNLIMITED, totalSigningKeys: 2 },
      { from: voting }
    )

    // id: 1
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'limited', rewardAddress: ADDRESS_2, stakingLimit: 1, totalSigningKeys: 2 },
      { from: voting }
    )

    // id: 2 (unused keys were trimmed)
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'deactivated', rewardAddress: ADDRESS_3, totalSigningKeys: 2, stakingLimit: 2, isActive: false },
      { from: voting }
    )

    // id: 3
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'short on keys', rewardAddress: ADDRESS_4, stakingLimit: UNLIMITED },
      { from: voting }
    )

    // Small deposits
    for (let i = 0; i < 14; i++) await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(10) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(6) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(146))
    assertBn(await app.getBufferedEther(), ETH(50))
    assertBn(await depositContract.totalCalls(), 3)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Next deposit changes nothing
    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(32) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(178))
    assertBn(await app.getBufferedEther(), ETH(82))
    assertBn(await depositContract.totalCalls(), 3)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // #1 goes below the limit (doesn't change situation. validator stop decreases limit)
    await operators.reportStoppedValidators(1, 1, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(179))
    assertBn(await app.getBufferedEther(), ETH(83))
    assertBn(await depositContract.totalCalls(), 3)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Adding a key will help
    await operators.addSigningKeys(0, 1, pad('0x0003', 48), pad('0x01', 96), { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 4, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(180))
    assertBn(await app.getBufferedEther(), ETH(52))
    assertBn(await depositContract.totalCalls(), 4)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Reactivation of #2 (changes nothing, it's not used keys were trimmed)
    await operators.activateNodeOperator(2, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(12) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 4, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(192))
    assertBn(await app.getBufferedEther(), ETH(64))
    assertBn(await depositContract.totalCalls(), 4)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 0)
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
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 2, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(64))
    assertBn(await app.getBufferedEther(), ETH(0))
    assertBn(await depositContract.totalCalls(), 2)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Reactivation of #2 - has the smallest stake
    await operators.activateNodeOperator(2, { from: voting })
    await operators.addSigningKeys(2, 2, hexConcat(pad('0x0201', 48), pad('0x0202', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(36) })
    await app.methods['deposit(uint256,uint24,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(100))
    assertBn(await app.getBufferedEther(), ETH(4))
    assertBn(await depositContract.totalCalls(), 3)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)
  })

  it('burnShares works', async () => {
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(1) })

    // not permitted from arbitrary address
    await assertRevert(app.burnShares(user1, ETH(1), { from: nobody }), 'APP_AUTH_FAILED')

    // voting can burn shares of any user
    const expectedPreTokenAmount = await app.getPooledEthByShares(ETH(0.5))
    let receipt = await app.burnShares(user1, ETH(0.5), { from: voting })
    const expectedPostTokenAmount = await app.getPooledEthByShares(ETH(0.5))
    assertEvent(receipt, 'SharesBurnt', {
      expectedArgs: {
        account: user1,
        preRebaseTokenAmount: expectedPreTokenAmount,
        postRebaseTokenAmount: expectedPostTokenAmount,
        sharesAmount: ETH(0.5)
      }
    })

    const expectedPreDoubledAmount = await app.getPooledEthByShares(ETH(0.5))
    receipt = await app.burnShares(user1, ETH(0.5), { from: voting })
    const expectedPostDoubledAmount = await app.getPooledEthByShares(ETH(0.5))
    assertEvent(receipt, 'SharesBurnt', {
      expectedArgs: {
        account: user1,
        preRebaseTokenAmount: expectedPreDoubledAmount,
        postRebaseTokenAmount: expectedPostDoubledAmount,
        sharesAmount: ETH(0.5)
      }
    })

    assertBn(expectedPreTokenAmount.mul(bn(2)), expectedPreDoubledAmount)
    assertBn(tokens(0), await app.getPooledEthByShares(ETH(0.5)))

    // user1 has zero shares after all
    assertBn(await app.sharesOf(user1), tokens(0))

    // voting can't continue burning if user already has no shares
    await assertRevert(app.burnShares(user1, 1, { from: voting }), 'BURN_AMOUNT_EXCEEDS_BALANCE')
  })

  context('treasury', () => {
    it('treasury address has been set after init', async () => {
      assert.notEqual(await app.getTreasury(), ZERO_ADDRESS)
    })

    it(`treasury can't be set by an arbitrary address`, async () => {
      await assertRevert(app.setProtocolContracts(await app.getOracle(), user1, { from: nobody }))
      await assertRevert(app.setProtocolContracts(await app.getOracle(), user1, { from: user1 }))
    })

    it('voting can set treasury', async () => {
      const receipt = await app.setProtocolContracts(await app.getOracle(), user1, { from: voting })
      assertEvent(receipt, 'ProtocolContactsSet', { expectedArgs: { treasury: user1 } })
      assert.equal(await app.getTreasury(), user1)
    })

    it('reverts when treasury is zero address', async () => {
      await assertRevert(app.setProtocolContracts(await app.getOracle(), ZERO_ADDRESS, { from: voting }), 'TREASURY_ZERO_ADDRESS')
    })
  })

  context('recovery vault', () => {
    beforeEach(async () => {
      await anyToken.mint(app.address, 100)
    })

    it('reverts when vault is not set', async () => {
      await assertRevert(app.transferToVault(anyToken.address, { from: nobody }), 'RECOVER_VAULT_ZERO')
    })

    context('recovery works with vault mock deployed', () => {
      let vault

      beforeEach(async () => {
        // Create a new vault and set that vault as the default vault in the kernel
        const vaultId = hash('vault.aragonpm.test')
        const vaultBase = await VaultMock.new()
        const vaultReceipt = await dao.newAppInstance(vaultId, vaultBase.address, '0x', true)
        const vaultAddress = getInstalledApp(vaultReceipt)
        vault = await VaultMock.at(vaultAddress)
        await vault.initialize()

        await dao.setRecoveryVaultAppId(vaultId)
      })

      it('recovery with erc20 tokens works and emits event', async () => {
        const receipt = await app.transferToVault(anyToken.address, { from: nobody })
        assertEvent(receipt, 'RecoverToVault', { expectedArgs: { vault: vault.address, token: anyToken.address, amount: 100 } })
      })

      it('recovery with unaccounted ether works and emits event', async () => {
        await app.makeUnaccountedEther({ from: user1, value: ETH(10) })
        const receipt = await app.transferToVault(ZERO_ADDRESS, { from: nobody })
        assertEvent(receipt, 'RecoverToVault', { expectedArgs: { vault: vault.address, token: ZERO_ADDRESS, amount: ETH(10) } })
      })
    })
  })
})
