const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn, assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')
const { BN } = require('bn.js')

const StETH = artifacts.require('StETH.sol') // we can just import due to StETH imported in test_helpers/Imports.sol
const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

const Lido = artifacts.require('TestLido.sol')
const OracleMock = artifacts.require('OracleMock.sol')
const ValidatorRegistrationMock = artifacts.require('ValidatorRegistrationMock.sol')

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'
const ADDRESS_3 = '0x0000000000000000000000000000000000000003'
const ADDRESS_4 = '0x0000000000000000000000000000000000000004'

const UNLIMITED = 1000000000

const pad = (hex, bytesLength) => {
  const absentZeroes = bytesLength * 2 + 2 - hex.length
  if (absentZeroes > 0) hex = '0x' + '0'.repeat(absentZeroes) + hex.substr(2)
  return hex
}

const hexConcat = (first, ...rest) => {
  let result = first.startsWith('0x') ? first : '0x' + first
  rest.forEach((item) => {
    result += item.startsWith('0x') ? item.substr(2) : item
  })
  return result
}

// Divides a BN by 1e15
const div15 = (bn) => bn.div(new BN(1000000)).div(new BN(1000000)).div(new BN(1000))

const ETH = (value) => web3.utils.toWei(value + '', 'ether')
const tokens = ETH

contract('Lido', ([appManager, voting, user1, user2, user3, nobody]) => {
  let appBase, stEthBase, nodeOperatorsRegistryBase, app, token, oracle, validatorRegistration, operators
  let treasuryAddr, insuranceAddr

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await Lido.new()
    stEthBase = await StETH.new()
    oracle = await OracleMock.new()
    validatorRegistration = await ValidatorRegistrationMock.new()
    nodeOperatorsRegistryBase = await NodeOperatorsRegistry.new()
  })

  beforeEach('deploy dao and app', async () => {
    const { dao, acl } = await newDao(appManager)

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    let proxyAddress = await newApp(dao, 'lido', appBase.address, appManager)
    app = await Lido.at(proxyAddress)

    // NodeOperatorsRegistry
    proxyAddress = await newApp(dao, 'node-operators-registry', nodeOperatorsRegistryBase.address, appManager)
    operators = await NodeOperatorsRegistry.at(proxyAddress)
    await operators.initialize(app.address)

    // token
    proxyAddress = await newApp(dao, 'steth', stEthBase.address, appManager)
    token = await StETH.at(proxyAddress)
    await token.initialize(app.address)

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.PAUSE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.MANAGE_FEE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.MANAGE_WITHDRAWAL_KEY(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_DEPOSIT_ITERATION_LIMIT(), appManager, { from: appManager })

    await acl.createPermission(app.address, token.address, await token.MINT_ROLE(), appManager, { from: appManager })
    await acl.createPermission(app.address, token.address, await token.BURN_ROLE(), appManager, { from: appManager })

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

    // Initialize the app's proxy.
    await app.initialize(token.address, validatorRegistration.address, oracle.address, operators.address, 10)
    treasuryAddr = await app.getTreasury()
    insuranceAddr = await app.getInsuranceFund()

    await oracle.setPool(app.address)
    await validatorRegistration.reset()
  })

  const checkStat = async ({ depositedValidators, beaconValidators, beaconBalance }) => {
    const stat = await app.getBeaconStat()
    assertBn(stat.depositedValidators, depositedValidators, 'depositedValidators check')
    assertBn(stat.beaconValidators, beaconValidators, 'beaconValidators check')
    assertBn(stat.beaconBalance, beaconBalance, 'beaconBalance check')
  }

  // Assert reward distribution. The values must be divided by 1e15.
  const checkRewards = async ({ treasury, insurance, operator }) => {
    const [treasury_b, insurance_b, operators_b, a1, a2, a3, a4] = await Promise.all([
      token.balanceOf(treasuryAddr),
      token.balanceOf(insuranceAddr),
      token.balanceOf(operators.address),
      token.balanceOf(ADDRESS_1),
      token.balanceOf(ADDRESS_2),
      token.balanceOf(ADDRESS_3),
      token.balanceOf(ADDRESS_4)
    ])

    assertBn(div15(treasury_b), treasury, 'treasury token balance check')
    assertBn(div15(insurance_b), insurance, 'insurance fund token balance check')
    assertBn(div15(operators_b.add(a1).add(a2).add(a3).add(a4)), operator, 'node operators token balance check')
  }

  it('setFee works', async () => {
    await app.setFee(110, { from: voting })
    await assertRevert(app.setFee(110, { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.setFee(110, { from: nobody }), 'APP_AUTH_FAILED')
    await assertRevert(app.setFee(11000, { from: voting }), 'VALUE_OVER_100_PERCENT')

    assertBn(await app.getFee({ from: nobody }), 110)
  })

  it('setFeeDistribution works', async () => {
    await app.setFeeDistribution(3000, 2000, 5000, { from: voting })
    await assertRevert(app.setFeeDistribution(3000, 2000, 5000, { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.setFeeDistribution(3000, 2000, 5000, { from: nobody }), 'APP_AUTH_FAILED')

    await assertRevert(app.setFeeDistribution(3000, 2000, 5001, { from: voting }), 'FEES_DONT_ADD_UP')
    await assertRevert(app.setFeeDistribution(3000, 2000 - 1, 5000, { from: voting }), 'FEES_DONT_ADD_UP')
    await assertRevert(app.setFeeDistribution(0, 0, 15000, { from: voting }), 'FEES_DONT_ADD_UP')

    const distribution = await app.getFeeDistribution({ from: nobody })
    assertBn(distribution.treasuryFeeBasisPoints, 3000)
    assertBn(distribution.insuranceFeeBasisPoints, 2000)
    assertBn(distribution.operatorsFeeBasisPoints, 5000)
  })

  it('setWithdrawalCredentials works', async () => {
    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await assertRevert(app.setWithdrawalCredentials('0x0204', { from: voting }), 'INVALID_LENGTH')
    await assertRevert(app.setWithdrawalCredentials(pad('0x0203', 32), { from: user1 }), 'APP_AUTH_FAILED')

    assert.equal(await app.getWithdrawalCredentials({ from: nobody }), pad('0x0202', 32))
  })

  it('setWithdrawalCredentials resets unused keys', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, UNLIMITED, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, UNLIMITED, { from: voting })

    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(1, 2, hexConcat(pad('0x050505', 48), pad('0x060606', 48)), hexConcat(pad('0x02', 96), pad('0x03', 96)), {
      from: voting
    })
    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 1)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 2)

    await app.setWithdrawalCredentials(pad('0x0203', 32), { from: voting })

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 0)
    assert.equal(await app.getWithdrawalCredentials({ from: nobody }), pad('0x0203', 32))
  })

  it('setDepositIterationLimit works', async () => {
    await app.setDepositIterationLimit(22, { from: voting })
    assertBn(await app.getDepositIterationLimit(), 22)

    await assertRevert(app.setDepositIterationLimit(0, { from: voting }), 'ZERO_LIMIT')
    await assertRevert(app.setDepositIterationLimit(33, { from: user1 }), 'APP_AUTH_FAILED')
  })

  it('pad64 works', async () => {
    await assertRevert(app.pad64('0x'))
    await assertRevert(app.pad64('0x11'))
    await assertRevert(app.pad64('0x1122'))
    await assertRevert(app.pad64(pad('0x1122', 31)))
    await assertRevert(app.pad64(pad('0x1122', 65)))
    await assertRevert(app.pad64(pad('0x1122', 265)))

    assert.equal(await app.pad64(pad('0x1122', 32)), pad('0x1122', 32) + '0'.repeat(64))
    assert.equal(await app.pad64(pad('0x1122', 36)), pad('0x1122', 36) + '0'.repeat(56))
    assert.equal(await app.pad64(pad('0x1122', 64)), pad('0x1122', 64))
  })

  it('toLittleEndian64 works', async () => {
    await assertRevert(app.toLittleEndian64('0x010203040506070809'))
    assertBn(await app.toLittleEndian64('0x0102030405060708'), bn('0x0807060504030201' + '0'.repeat(48)))
    assertBn(await app.toLittleEndian64('0x0100000000000008'), bn('0x0800000000000001' + '0'.repeat(48)))
    assertBn(await app.toLittleEndian64('0x10'), bn('0x1000000000000000' + '0'.repeat(48)))
  })

  it('deposit works', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, UNLIMITED, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, UNLIMITED, { from: voting })

    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    // zero deposits revert
    await assertRevert(app.submit(ZERO_ADDRESS, { from: user1, value: ETH(0) }), 'ZERO_DEPOSIT')
    await assertRevert(web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(0) }), 'ZERO_DEPOSIT')

    // +1 ETH
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(1) })
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await validatorRegistration.totalCalls(), 0)
    assertBn(await app.getTotalPooledEther(), ETH(1))
    assertBn(await app.getBufferedEther(), ETH(1))
    assertBn(await token.balanceOf(user1), tokens(1))
    assertBn(await token.totalSupply(), tokens(1))

    // +2 ETH
    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2) }) // another form of a deposit call
    await checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await validatorRegistration.totalCalls(), 0)
    assertBn(await app.getTotalPooledEther(), ETH(3))
    assertBn(await app.getBufferedEther(), ETH(3))
    assertBn(await token.balanceOf(user2), tokens(2))
    assertBn(await token.totalSupply(), tokens(3))

    // +30 ETH
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(30) })
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(33))
    assertBn(await app.getBufferedEther(), ETH(1))
    assertBn(await token.balanceOf(user1), tokens(1))
    assertBn(await token.balanceOf(user2), tokens(2))
    assertBn(await token.balanceOf(user3), tokens(30))
    assertBn(await token.totalSupply(), tokens(33))

    assertBn(await validatorRegistration.totalCalls(), 1)
    const c0 = await validatorRegistration.calls.call(0)
    assert.equal(c0.pubkey, pad('0x010203', 48))
    assert.equal(c0.withdrawal_credentials, pad('0x0202', 32))
    assert.equal(c0.signature, pad('0x01', 96))
    assertBn(c0.value, ETH(32))

    // +100 ETH
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(100) })
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 4, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(133))
    assertBn(await app.getBufferedEther(), ETH(5))
    assertBn(await token.balanceOf(user1), tokens(101))
    assertBn(await token.balanceOf(user2), tokens(2))
    assertBn(await token.balanceOf(user3), tokens(30))
    assertBn(await token.totalSupply(), tokens(133))

    assertBn(await validatorRegistration.totalCalls(), 4)
    const calls = {}
    for (const i of [1, 2, 3]) {
      calls[i] = await validatorRegistration.calls.call(i)
      assert.equal(calls[i].withdrawal_credentials, pad('0x0202', 32))
      assert.equal(calls[i].signature, pad('0x01', 96))
      assertBn(calls[i].value, ETH(32))
    }
    assert.equal(calls[1].pubkey, pad('0x010204', 48))
    assert.equal(calls[2].pubkey, pad('0x010205', 48))
    assert.equal(calls[3].pubkey, pad('0x010206', 48))
  })

  it('submits with zero and non-zero referrals work', async () => {
    const REFERRAL = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF'
    let receipt
    receipt = await app.submit(REFERRAL, { from: user2, value: ETH(2) })
    assertEvent(receipt, 'Submitted', { expectedArgs: { sender: user2, amount: ETH(2), referral: REFERRAL } })
    receipt = await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(5) })
    assertEvent(receipt, 'Submitted', { expectedArgs: { sender: user2, amount: ETH(5), referral: ZERO_ADDRESS } })
  })

  it('key removal is taken into account during deposit', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, UNLIMITED, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, UNLIMITED, { from: voting })

    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(33) })
    await app.depositBufferedEther()
    assertBn(await validatorRegistration.totalCalls(), 1)
    await assertRevert(operators.removeSigningKey(0, 0, { from: voting }), 'KEY_WAS_USED')

    await operators.removeSigningKey(0, 1, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(100) })
    await app.depositBufferedEther()
    await assertRevert(operators.removeSigningKey(0, 1, { from: voting }), 'KEY_WAS_USED')
    await assertRevert(operators.removeSigningKey(0, 2, { from: voting }), 'KEY_WAS_USED')
    assertBn(await validatorRegistration.totalCalls(), 3)
    assertBn(await app.getTotalPooledEther(), ETH(133))
    assertBn(await app.getBufferedEther(), ETH(37))
  })

  it("out of signing keys doesn't revert but buffers", async () => {
    await operators.addNodeOperator('1', ADDRESS_1, UNLIMITED, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, UNLIMITED, { from: voting })

    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(100) })
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await validatorRegistration.totalCalls(), 1)
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
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await validatorRegistration.totalCalls(), 3)
    assertBn(await app.getTotalPooledEther(), ETH(101))
    assertBn(await app.getBufferedEther(), ETH(5))
  })

  it('withrawal method reverts', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, UNLIMITED, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, UNLIMITED, { from: voting })

    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await operators.addSigningKeys(
      0,
      6,
      hexConcat(
        pad('0x010203', 48),
        pad('0x010204', 48),
        pad('0x010205', 48),
        pad('0x010206', 48),
        pad('0x010207', 48),
        pad('0x010208', 48)
      ),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96), pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(1) })
    await app.depositBufferedEther()
    assertBn(await app.getTotalPooledEther(), ETH(1))
    assertBn(await token.totalSupply(), tokens(1))
    assertBn(await app.getBufferedEther(), ETH(1))

    await checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: ETH(0) })

    await assertRevert(app.withdraw(tokens(1), pad('0x1000', 32), { from: nobody }), 'NOT_IMPLEMENTED_YET')
    await assertRevert(app.withdraw(tokens(1), pad('0x1000', 32), { from: user1 }), 'NOT_IMPLEMENTED_YET')
  })

  it('pushBeacon works', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, UNLIMITED, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, UNLIMITED, { from: voting })

    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(34) })
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })

    await assertRevert(app.pushBeacon(1, ETH(30), { from: appManager }), 'APP_AUTH_FAILED')

    await oracle.reportBeacon(100, 1, ETH(30))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(30) })

    await assertRevert(app.pushBeacon(1, ETH(29), { from: nobody }), 'APP_AUTH_FAILED')

    await oracle.reportBeacon(50, 1, ETH(100)) // stale data
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(100) })

    await oracle.reportBeacon(200, 1, ETH(33))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(33) })
  })

  it('oracle data affects deposits', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, UNLIMITED, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, UNLIMITED, { from: voting })

    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )
    await app.setFee(5000, { from: voting })
    await app.setFeeDistribution(3000, 2000, 5000, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(34) })
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await validatorRegistration.totalCalls(), 1)
    assertBn(await app.getTotalPooledEther(), ETH(34))
    assertBn(await app.getBufferedEther(), ETH(2))

    // down
    await oracle.reportBeacon(100, 1, ETH(15))

    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(15) })
    assertBn(await validatorRegistration.totalCalls(), 1)
    assertBn(await app.getTotalPooledEther(), ETH(17))
    assertBn(await app.getBufferedEther(), ETH(2))
    assertBn(await token.totalSupply(), tokens(17))

    // deposit, ratio is 0.5
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(2) })
    await app.depositBufferedEther()

    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(15) })
    assertBn(await validatorRegistration.totalCalls(), 1)
    assertBn(await app.getTotalPooledEther(), ETH(19))
    assertBn(await app.getBufferedEther(), ETH(4))
    assertBn(await token.balanceOf(user1), tokens(2))
    assertBn(await token.totalSupply(), tokens(19))

    // up
    await assertRevert(oracle.reportBeacon(200, 2, ETH(48)), 'REPORTED_MORE_DEPOSITED')
    await oracle.reportBeacon(200, 1, ETH(48))

    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(48) })
    assertBn(await validatorRegistration.totalCalls(), 1)
    assertBn(await app.getTotalPooledEther(), ETH(52))
    assertBn(await app.getBufferedEther(), ETH(4))
    assertBn(await token.totalSupply(), tokens(52))
    /*

    // 2nd deposit, ratio is 2
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(2) })
    await app.depositBufferedEther()

    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(72)})
    assertBn(await validatorRegistration.totalCalls(), 1)
    assertBn(await app.getTotalPooledEther(), ETH(78))
    assertBn(await app.getBufferedEther(), ETH(6))
    assertBn(await token.balanceOf(user1), tokens(8))
    assertBn(await token.balanceOf(user3), tokens(2))
    assertBn(await token.totalSupply(), tokens(78))
*/
  })

  it('can stop and resume', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, UNLIMITED, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, UNLIMITED, { from: voting })

    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(40) })
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getBufferedEther(), ETH(8))

    await assertRevert(app.stop({ from: user2 }), 'APP_AUTH_FAILED')
    await app.stop({ from: voting })

    await assertRevert(web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(4) }), 'CONTRACT_IS_STOPPED')
    await assertRevert(web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(4) }), 'CONTRACT_IS_STOPPED')
    await assertRevert(app.submit('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', { from: user1, value: ETH(4) }), 'CONTRACT_IS_STOPPED')

    await assertRevert(app.resume({ from: user2 }), 'APP_AUTH_FAILED')
    await app.resume({ from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(4) })
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getBufferedEther(), ETH(12))
  })

  it('rewards distribution works in a simple case', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, UNLIMITED, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, UNLIMITED, { from: voting })

    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    await app.setFee(5000, { from: voting })
    await app.setFeeDistribution(3000, 2000, 5000, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(34) })
    await app.depositBufferedEther()

    await oracle.reportBeacon(300, 1, ETH(36))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(36) })
    assertBn(await token.totalSupply(), tokens(38)) // remote + buffered
    await checkRewards({ treasury: 599, insurance: 399, operator: 1000 })
  })

  it('rewards distribution works', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, UNLIMITED, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, UNLIMITED, { from: voting })

    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    await app.setFee(5000, { from: voting })
    await app.setFeeDistribution(3000, 2000, 5000, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(34) })
    await app.depositBufferedEther()
    // some slashing occured
    await oracle.reportBeacon(100, 1, ETH(30))

    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(30) })
    // ToDo check buffer=2
    assertBn(await token.totalSupply(), tokens(32)) // 30 remote (slashed) + 2 buffered = 32
    await checkRewards({ treasury: 0, insurance: 0, operator: 0 })

    // rewarded 200 Ether (was 30, became 230)
    await oracle.reportBeacon(200, 1, ETH(130))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(130) })
    // Todo check reward effects
    // await checkRewards({ treasury: 0, insurance: 0, operator: 0 })

    await oracle.reportBeacon(300, 1, ETH(2230))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(2230) })
    assertBn(await token.totalSupply(), tokens(2232))
    // Todo check reward effects
    // await checkRewards({ treasury: tokens(33), insurance: tokens(22), operator: tokens(55) })
  })

  it('deposits accounted properly during rewards distribution', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, UNLIMITED, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, UNLIMITED, { from: voting })

    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })

    await app.setFee(5000, { from: voting })
    await app.setFeeDistribution(3000, 2000, 5000, { from: voting })

    // Only 32 ETH deposited
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(32) })
    await app.depositBufferedEther()
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(32) })
    await app.depositBufferedEther()
    assertBn(await token.totalSupply(), tokens(64))

    await oracle.reportBeacon(300, 1, ETH(36))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(36) })
    assertBn(await token.totalSupply(), tokens(68))
    await checkRewards({ treasury: 599, insurance: 399, operator: 1000 })
  })

  it('Node Operators filtering during deposit works when doing a huge deposit', async () => {
    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addNodeOperator('good', ADDRESS_1, UNLIMITED, { from: voting }) // 0
    await operators.addSigningKeys(0, 2, hexConcat(pad('0x0001', 48), pad('0x0002', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })

    await operators.addNodeOperator('limited', ADDRESS_2, 1, { from: voting }) // 1
    await operators.addSigningKeys(1, 2, hexConcat(pad('0x0101', 48), pad('0x0102', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })

    await operators.addNodeOperator('deactivated', ADDRESS_3, UNLIMITED, { from: voting }) // 2
    await operators.addSigningKeys(2, 2, hexConcat(pad('0x0201', 48), pad('0x0202', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })
    await operators.setNodeOperatorActive(2, false, { from: voting })

    await operators.addNodeOperator('short on keys', ADDRESS_4, UNLIMITED, { from: voting }) // 3

    await app.setFee(5000, { from: voting })
    await app.setFeeDistribution(3000, 2000, 5000, { from: voting })

    // Deposit huge chunk
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(32 * 3 + 50) })
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(146))
    assertBn(await app.getBufferedEther(), ETH(50))
    assertBn(await validatorRegistration.totalCalls(), 3)

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
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(178))
    assertBn(await app.getBufferedEther(), ETH(82))
    assertBn(await validatorRegistration.totalCalls(), 3)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // #1 goes below the limit
    await operators.reportStoppedValidators(1, 1, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 4, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(179))
    assertBn(await app.getBufferedEther(), ETH(51))
    assertBn(await validatorRegistration.totalCalls(), 4)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Adding a key will help
    await operators.addSigningKeys(0, 1, pad('0x0003', 48), pad('0x01', 96), { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 5, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(180))
    assertBn(await app.getBufferedEther(), ETH(20))
    assertBn(await validatorRegistration.totalCalls(), 5)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Reactivation of #2
    await operators.setNodeOperatorActive(2, true, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(12) })
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 6, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(192))
    assertBn(await app.getBufferedEther(), ETH(0))
    assertBn(await validatorRegistration.totalCalls(), 6)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)
  })

  it('Node Operators filtering during deposit works when doing small deposits', async () => {
    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addNodeOperator('good', ADDRESS_1, UNLIMITED, { from: voting }) // 0
    await operators.addSigningKeys(0, 2, hexConcat(pad('0x0001', 48), pad('0x0002', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })

    await operators.addNodeOperator('limited', ADDRESS_2, 1, { from: voting }) // 1
    await operators.addSigningKeys(1, 2, hexConcat(pad('0x0101', 48), pad('0x0102', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })

    await operators.addNodeOperator('deactivated', ADDRESS_3, UNLIMITED, { from: voting }) // 2
    await operators.addSigningKeys(2, 2, hexConcat(pad('0x0201', 48), pad('0x0202', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })
    await operators.setNodeOperatorActive(2, false, { from: voting })

    await operators.addNodeOperator('short on keys', ADDRESS_4, UNLIMITED, { from: voting }) // 3

    await app.setFee(5000, { from: voting })
    await app.setFeeDistribution(3000, 2000, 5000, { from: voting })

    // Small deposits
    for (let i = 0; i < 14; i++) await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(10) })
    await app.depositBufferedEther()
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(6) })
    await app.depositBufferedEther()

    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(146))
    assertBn(await app.getBufferedEther(), ETH(50))
    assertBn(await validatorRegistration.totalCalls(), 3)

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
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(178))
    assertBn(await app.getBufferedEther(), ETH(82))
    assertBn(await validatorRegistration.totalCalls(), 3)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // #1 goes below the limit
    await operators.reportStoppedValidators(1, 1, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 4, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(179))
    assertBn(await app.getBufferedEther(), ETH(51))
    assertBn(await validatorRegistration.totalCalls(), 4)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Adding a key will help
    await operators.addSigningKeys(0, 1, pad('0x0003', 48), pad('0x01', 96), { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 5, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(180))
    assertBn(await app.getBufferedEther(), ETH(20))
    assertBn(await validatorRegistration.totalCalls(), 5)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Reactivation of #2
    await operators.setNodeOperatorActive(2, true, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(12) })
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 6, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(192))
    assertBn(await app.getBufferedEther(), ETH(0))
    assertBn(await validatorRegistration.totalCalls(), 6)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)
  })

  it('Deposit finds the right operator', async () => {
    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addNodeOperator('good', ADDRESS_1, UNLIMITED, { from: voting }) // 0
    await operators.addSigningKeys(0, 2, hexConcat(pad('0x0001', 48), pad('0x0002', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })

    await operators.addNodeOperator('2nd good', ADDRESS_2, UNLIMITED, { from: voting }) // 1
    await operators.addSigningKeys(1, 2, hexConcat(pad('0x0101', 48), pad('0x0102', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })

    await operators.addNodeOperator('deactivated', ADDRESS_3, UNLIMITED, { from: voting }) // 2
    await operators.addSigningKeys(2, 2, hexConcat(pad('0x0201', 48), pad('0x0202', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })
    await operators.setNodeOperatorActive(2, false, { from: voting })

    await operators.addNodeOperator('short on keys', ADDRESS_4, UNLIMITED, { from: voting }) // 3

    await app.setFee(5000, { from: voting })
    await app.setFeeDistribution(3000, 2000, 5000, { from: voting })

    // #1 and #0 get the funds
    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(64) })
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 2, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(64))
    assertBn(await app.getBufferedEther(), ETH(0))
    assertBn(await validatorRegistration.totalCalls(), 2)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Reactivation of #2 - has the smallest stake
    await operators.setNodeOperatorActive(2, true, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(36) })
    await app.depositBufferedEther()
    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assertBn(await app.getTotalPooledEther(), ETH(100))
    assertBn(await app.getBufferedEther(), ETH(4))
    assertBn(await validatorRegistration.totalCalls(), 3)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)
  })
})
