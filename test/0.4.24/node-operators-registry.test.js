const { assert } = require('chai')
const { hexSplit, toBN } = require('../helpers/utils')
const { newDao, newApp } = require('./helpers/dao')
const { ZERO_ADDRESS, getEventAt, getEventArgument } = require('@aragon/contract-helpers-test')
const { assertBn, assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const keccak256 = require('js-sha3').keccak_256

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry.sol')
const PoolMock = artifacts.require('PoolMock.sol')

const PUBKEY_LENGTH_BYTES = 48
const SIGNATURE_LENGTH_BYTES = 96

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

const assertNoEvent = (receipt, eventName, msg) => {
  const event = getEventAt(receipt, eventName)
  assert.equal(event, undefined, msg)
}

const ETH = (value) => web3.utils.toWei(value + '', 'ether')
const tokens = ETH

contract('NodeOperatorsRegistry', ([appManager, voting, user1, user2, user3, nobody]) => {
  let appBase, app, pool

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await NodeOperatorsRegistry.new()
  })

  beforeEach('deploy dao and app', async () => {
    const { dao, acl } = await newDao(appManager)

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    const proxyAddress = await newApp(dao, 'node-operators-registry', appBase.address, appManager)
    app = await NodeOperatorsRegistry.at(proxyAddress)

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.MANAGE_SIGNING_KEYS(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.ADD_NODE_OPERATOR_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_NODE_OPERATOR_ACTIVE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_NODE_OPERATOR_NAME_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_NODE_OPERATOR_ADDRESS_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_NODE_OPERATOR_LIMIT_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.REPORT_STOPPED_VALIDATORS_ROLE(), appManager, { from: appManager })

    pool = await PoolMock.new(app.address)

    // Initialize the app's proxy.
    await app.initialize(pool.address)
  })

  it('addNodeOperator works', async () => {
    await assertRevert(app.addNodeOperator('1', ADDRESS_1, { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.addNodeOperator('1', ADDRESS_1, { from: nobody }), 'APP_AUTH_FAILED')

    await assertRevert(app.addNodeOperator('1', ZERO_ADDRESS, { from: voting }), 'EMPTY_ADDRESS')

    await app.addNodeOperator('fo o', ADDRESS_1, { from: voting })
    assertBn(await app.getNodeOperatorsCount({ from: nobody }), 1)
    assertBn(await app.getActiveNodeOperatorsCount({ from: nobody }), 1)

    await app.addNodeOperator(' bar', ADDRESS_2, { from: voting })
    assertBn(await app.getNodeOperatorsCount({ from: nobody }), 2)
    assertBn(await app.getActiveNodeOperatorsCount({ from: nobody }), 2)

    await assertRevert(app.addNodeOperator('1', ADDRESS_3, { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.addNodeOperator('1', ADDRESS_3, { from: nobody }), 'APP_AUTH_FAILED')
  })

  it('addNodeOperator limit works', async () => {
    const maxOperatorsCount = await app.MAX_NODE_OPERATORS_COUNT()
    const currentOperatorsCount = await app.getNodeOperatorsCount()

    for (let opIndex = currentOperatorsCount; opIndex < maxOperatorsCount; opIndex++) {
      const name = keccak256('op' + opIndex)
      const addr = '0x' + name.substr(0, 40)

      await app.addNodeOperator(name, addr, { from: voting })
    }

    await assertRevert(app.addNodeOperator('L', ADDRESS_4, { from: voting }), 'MAX_NODE_OPERATORS_COUNT_EXCEEDED')
  })

  it('getNodeOperator works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, { from: voting })

    await app.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })

    let operator = await app.getNodeOperator(0, true)
    assert.equal(operator.active, true)
    assert.equal(operator.name, 'fo o')
    assert.equal(operator.rewardAddress, ADDRESS_1)
    assertBn(operator.stakingLimit, 0)
    assertBn(operator.stoppedValidators, 0)
    assertBn(operator.totalSigningKeys, 1)
    assertBn(operator.usedSigningKeys, 0)

    operator = await app.getNodeOperator(1, true)
    assert.equal(operator.active, true)
    assert.equal(operator.name, ' bar')
    assert.equal(operator.rewardAddress, ADDRESS_2)
    assertBn(operator.stakingLimit, 0)
    assertBn(operator.stoppedValidators, 0)
    assertBn(operator.totalSigningKeys, 0)
    assertBn(operator.usedSigningKeys, 0)

    operator = await app.getNodeOperator(0, false)
    assert.equal(operator.name, '')
    assert.equal(operator.rewardAddress, ADDRESS_1)

    operator = await app.getNodeOperator(1, false)
    assert.equal(operator.name, '')
    assert.equal(operator.rewardAddress, ADDRESS_2)

    await assertRevert(app.getNodeOperator(10, false), 'NODE_OPERATOR_NOT_FOUND')
  })

  it('setNodeOperatorActive works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, { from: voting })

    await app.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })

    assert.equal((await app.getNodeOperator(0, false)).active, true)
    assert.equal((await app.getNodeOperator(1, false)).active, true)
    assertBn(await app.getNodeOperatorsCount({ from: nobody }), 2)
    assertBn(await app.getActiveNodeOperatorsCount({ from: nobody }), 2)

    await assertRevert(app.setNodeOperatorActive(0, false, { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.setNodeOperatorActive(0, true, { from: nobody }), 'APP_AUTH_FAILED')

    // switch off #0
    await app.setNodeOperatorActive(0, false, { from: voting })
    assert.equal((await app.getNodeOperator(0, false)).active, false)
    assert.equal((await app.getNodeOperator(1, false)).active, true)
    assertBn(await app.getNodeOperatorsCount({ from: nobody }), 2)
    assertBn(await app.getActiveNodeOperatorsCount({ from: nobody }), 1)

    await assertRevert(app.setNodeOperatorActive(0, false, { from: voting }), 'NODE_OPERATOR_ACTIVITY_ALREADY_SET')
    assert.equal((await app.getNodeOperator(0, false)).active, false)
    assertBn(await app.getActiveNodeOperatorsCount({ from: nobody }), 1)

    // switch off #1
    await app.setNodeOperatorActive(1, false, { from: voting })
    assert.equal((await app.getNodeOperator(0, false)).active, false)
    assert.equal((await app.getNodeOperator(1, false)).active, false)
    assertBn(await app.getNodeOperatorsCount({ from: nobody }), 2)
    assertBn(await app.getActiveNodeOperatorsCount({ from: nobody }), 0)

    // switch #0 back on
    await app.setNodeOperatorActive(0, true, { from: voting })
    assert.equal((await app.getNodeOperator(0, false)).active, true)
    assert.equal((await app.getNodeOperator(1, false)).active, false)
    assertBn(await app.getNodeOperatorsCount({ from: nobody }), 2)
    assertBn(await app.getActiveNodeOperatorsCount({ from: nobody }), 1)

    await assertRevert(app.setNodeOperatorActive(0, true, { from: voting }), 'NODE_OPERATOR_ACTIVITY_ALREADY_SET')
    assert.equal((await app.getNodeOperator(0, false)).active, true)
    assertBn(await app.getActiveNodeOperatorsCount({ from: nobody }), 1)

    await assertRevert(app.setNodeOperatorActive(10, false, { from: voting }), 'NODE_OPERATOR_NOT_FOUND')
  })

  it('setNodeOperatorName works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, { from: voting })

    await assertRevert(app.setNodeOperatorName(0, 'zzz', { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.setNodeOperatorName(0, 'zzz', { from: nobody }), 'APP_AUTH_FAILED')

    assert.equal((await app.getNodeOperator(0, true)).name, 'fo o')
    assert.equal((await app.getNodeOperator(1, true)).name, ' bar')

    await app.setNodeOperatorName(0, 'zzz', { from: voting })
    await assertRevert(app.setNodeOperatorName(0, 'zzz', { from: voting }), 'NODE_OPERATOR_NAME_IS_THE_SAME')

    assert.equal((await app.getNodeOperator(0, true)).name, 'zzz')
    assert.equal((await app.getNodeOperator(1, true)).name, ' bar')

    await assertRevert(app.setNodeOperatorName(10, 'foo', { from: voting }), 'NODE_OPERATOR_NOT_FOUND')
  })

  it('setNodeOperatorRewardAddress works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, { from: voting })

    await assertRevert(app.setNodeOperatorRewardAddress(0, ADDRESS_4, { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.setNodeOperatorRewardAddress(1, ADDRESS_4, { from: nobody }), 'APP_AUTH_FAILED')

    assert.equal((await app.getNodeOperator(0, false)).rewardAddress, ADDRESS_1)
    assert.equal((await app.getNodeOperator(1, false)).rewardAddress, ADDRESS_2)

    await app.setNodeOperatorRewardAddress(0, ADDRESS_4, { from: voting })
    await assertRevert(app.setNodeOperatorRewardAddress(0, ADDRESS_4, { from: voting }), 'NODE_OPERATOR_ADDRESS_IS_THE_SAME')

    assert.equal((await app.getNodeOperator(0, false)).rewardAddress, ADDRESS_4)
    assert.equal((await app.getNodeOperator(1, false)).rewardAddress, ADDRESS_2)

    await assertRevert(app.setNodeOperatorRewardAddress(10, ADDRESS_4, { from: voting }), 'NODE_OPERATOR_NOT_FOUND')
  })

  it('setNodeOperatorStakingLimit works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, { from: voting })

    await assertRevert(app.setNodeOperatorStakingLimit(0, 40, { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.setNodeOperatorStakingLimit(1, 40, { from: nobody }), 'APP_AUTH_FAILED')

    assertBn((await app.getNodeOperator(0, false)).stakingLimit, 0)
    assertBn((await app.getNodeOperator(1, false)).stakingLimit, 0)

    await app.setNodeOperatorStakingLimit(0, 40, { from: voting })
    await assertRevert(app.setNodeOperatorStakingLimit(0, 40, { from: voting }), 'NODE_OPERATOR_STAKING_LIMIT_IS_THE_SAME')

    assertBn((await app.getNodeOperator(0, false)).stakingLimit, 40)
    assertBn((await app.getNodeOperator(1, false)).stakingLimit, 0)

    await assertRevert(app.setNodeOperatorStakingLimit(10, 40, { from: voting }), 'NODE_OPERATOR_NOT_FOUND')
  })

  it('assignNextSigningKeys works', async () => {
    let keysOpIndex = await app.getKeysOpIndex()
    let result = await pool.assignNextSigningKeys(10)
    let keysAssignedEvt = getEventAt(result, 'KeysAssigned').args

    assert.equal(keysAssignedEvt.pubkeys, null, 'empty cache, no singing keys added: pubkeys')
    assert.equal(keysAssignedEvt.signatures, null, 'empty cache, no singing keys added: signatures')
    assertBn(await app.getKeysOpIndex(), keysOpIndex, 'keysOpIndex must not increase if no keys were assigned')
    assertNoEvent(result, 'KeysOpIndexSet')

    await app.addNodeOperator('fo o', ADDRESS_1, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, { from: voting })

    await app.setNodeOperatorStakingLimit(0, 10, { from: voting })
    await app.setNodeOperatorStakingLimit(1, 10, { from: voting })

    keysOpIndex = await app.getKeysOpIndex()
    result = await pool.assignNextSigningKeys(10)
    keysAssignedEvt = getEventAt(result, 'KeysAssigned').args

    assert.equal(keysAssignedEvt.pubkeys, null, 'no singing keys added: pubkeys')
    assert.equal(keysAssignedEvt.signatures, null, 'no singing keys added: signatures')
    assertBn(await app.getKeysOpIndex(), keysOpIndex, 'keysOpIndex must not increase if no keys were assigned')
    assertNoEvent(result, 'KeysOpIndexSet')

    const op0 = {
      keys: [pad('0xaa0101', 48), pad('0xaa0202', 48), pad('0xaa0303', 48)],
      sigs: [pad('0xa1', 96), pad('0xa2', 96), pad('0xa3', 96)]
    }

    const op1 = {
      keys: [pad('0xbb0505', 48), pad('0xbb0606', 48), pad('0xbb0707', 48)],
      sigs: [pad('0xb5', 96), pad('0xb6', 96), pad('0xb7', 96)]
    }

    await app.addSigningKeys(0, 3, hexConcat(...op0.keys), hexConcat(...op0.sigs), { from: voting })
    await app.addSigningKeys(1, 3, hexConcat(...op1.keys), hexConcat(...op1.sigs), { from: voting })

    keysOpIndex = await app.getKeysOpIndex()
    result = await pool.assignNextSigningKeys(1)
    keysAssignedEvt = getEventAt(result, 'KeysAssigned').args

    assert.equal(keysAssignedEvt.pubkeys, op0.keys[0], 'assignment 1: pubkeys')
    assert.equal(keysAssignedEvt.signatures, op0.sigs[0], 'assignment 1: signatures')
    assertBn(await app.getKeysOpIndex(), keysOpIndex.add(toBN(1)), 'keysOpIndex must increase if any keys were assigned')
    assertEvent(result, 'KeysOpIndexSet')

    keysOpIndex = await app.getKeysOpIndex()
    result = await pool.assignNextSigningKeys(2)
    keysAssignedEvt = getEventAt(result, 'KeysAssigned').args

    assert.sameMembers(hexSplit(keysAssignedEvt.pubkeys, PUBKEY_LENGTH_BYTES), [op0.keys[1], op1.keys[0]], 'assignment 2: pubkeys')
    assert.sameMembers(hexSplit(keysAssignedEvt.signatures, SIGNATURE_LENGTH_BYTES), [op0.sigs[1], op1.sigs[0]], 'assignment 2: signatures')
    assertBn(await app.getKeysOpIndex(), keysOpIndex.add(toBN(1)), 'keysOpIndex must increase if any keys were assigned')
    assertEvent(result, 'KeysOpIndexSet')

    keysOpIndex = await app.getKeysOpIndex()
    result = await pool.assignNextSigningKeys(10)
    keysAssignedEvt = getEventAt(result, 'KeysAssigned').args

    assert.sameMembers(
      hexSplit(keysAssignedEvt.pubkeys, PUBKEY_LENGTH_BYTES),
      [op0.keys[2], op1.keys[1], op1.keys[2]],
      'assignment 2: pubkeys'
    )
    assert.sameMembers(
      hexSplit(keysAssignedEvt.signatures, SIGNATURE_LENGTH_BYTES),
      [op0.sigs[2], op1.sigs[1], op1.sigs[2]],
      'assignment 2: signatures'
    )
    assertBn(await app.getKeysOpIndex(), keysOpIndex.add(toBN(1)), 'keysOpIndex must increase if any keys were assigned')
    assertEvent(result, 'KeysOpIndexSet')

    keysOpIndex = await app.getKeysOpIndex()
    result = await pool.assignNextSigningKeys(10)
    keysAssignedEvt = getEventAt(result, 'KeysAssigned').args

    assert.equal(keysAssignedEvt.pubkeys, null, 'no singing keys left: pubkeys')
    assert.equal(keysAssignedEvt.signatures, null, 'no singing keys left: signatures')
    assertBn(await app.getKeysOpIndex(), keysOpIndex, 'keysOpIndex must not increase if no keys were assigned')
    assertNoEvent(result, 'KeysOpIndexSet')
  })

  it('assignNextSigningKeys skips stopped operators', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, { from: voting })

    await app.setNodeOperatorStakingLimit(0, 10, { from: voting })
    await app.setNodeOperatorStakingLimit(1, 10, { from: voting })

    const op0 = {
      keys: [pad('0xaa0101', 48), pad('0xaa0202', 48), pad('0xaa0303', 48)],
      sigs: [pad('0xa1', 96), pad('0xa2', 96), pad('0xa3', 96)]
    }

    const op1 = {
      keys: [pad('0xbb0505', 48), pad('0xbb0606', 48), pad('0xbb0707', 48)],
      sigs: [pad('0xb5', 96), pad('0xb6', 96), pad('0xb7', 96)]
    }

    await app.addSigningKeys(0, 3, hexConcat(...op0.keys), hexConcat(...op0.sigs), { from: voting })
    await app.addSigningKeys(1, 3, hexConcat(...op1.keys), hexConcat(...op1.sigs), { from: voting })

    let result = await pool.assignNextSigningKeys(2)

    let keysAssignedEvt = getEventAt(result, 'KeysAssigned').args

    assert.sameMembers(hexSplit(keysAssignedEvt.pubkeys, PUBKEY_LENGTH_BYTES), [op0.keys[0], op1.keys[0]], 'assignment 1: pubkeys')
    assert.sameMembers(hexSplit(keysAssignedEvt.signatures, SIGNATURE_LENGTH_BYTES), [op0.sigs[0], op1.sigs[0]], 'assignment 1: signatures')

    await app.setNodeOperatorActive(0, false, { from: voting })
    await assertRevert(app.setNodeOperatorActive(0, false, { from: voting }), 'NODE_OPERATOR_ACTIVITY_ALREADY_SET')
    result = await pool.assignNextSigningKeys(2)

    keysAssignedEvt = getEventAt(result, 'KeysAssigned').args

    assert.sameMembers(hexSplit(keysAssignedEvt.pubkeys, PUBKEY_LENGTH_BYTES), [op1.keys[1], op1.keys[2]], 'assignment 2: pubkeys')
    assert.sameMembers(hexSplit(keysAssignedEvt.signatures, SIGNATURE_LENGTH_BYTES), [op1.sigs[1], op1.sigs[2]], 'assignment 2: signatures')

    result = await pool.assignNextSigningKeys(2)

    keysAssignedEvt = getEventAt(result, 'KeysAssigned').args

    assert.equal(keysAssignedEvt.pubkeys, null, 'assignment 3: pubkeys')
    assert.equal(keysAssignedEvt.signatures, null, 'assignment 3: signatures')
  })

  it('assignNextSigningKeys respects staking limit', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, { from: voting })

    await app.setNodeOperatorStakingLimit(0, 4, { from: voting })
    await app.setNodeOperatorStakingLimit(1, 1, { from: voting })

    const op0 = {
      keys: [pad('0xaa0101', 48), pad('0xaa0202', 48), pad('0xaa0303', 48), pad('0xaa0404', 48)],
      sigs: [pad('0xa1', 96), pad('0xa2', 96), pad('0xa3', 96), pad('0xa4', 96)]
    }

    const op1 = {
      keys: [pad('0xbb0505', 48), pad('0xbb0606', 48), pad('0xbb0707', 48)],
      sigs: [pad('0xb5', 96), pad('0xb6', 96), pad('0xb7', 96)]
    }

    await app.addSigningKeys(0, 4, hexConcat(...op0.keys), hexConcat(...op0.sigs), { from: voting })
    await app.addSigningKeys(1, 3, hexConcat(...op1.keys), hexConcat(...op1.sigs), { from: voting })

    let result = await pool.assignNextSigningKeys(3)
    let keysAssignedEvt = getEventAt(result, 'KeysAssigned').args

    assert.sameMembers(
      hexSplit(keysAssignedEvt.pubkeys, PUBKEY_LENGTH_BYTES),
      [op0.keys[0], op0.keys[1], op1.keys[0]],
      'assignment 1: pubkeys'
    )

    assert.sameMembers(
      hexSplit(keysAssignedEvt.signatures, SIGNATURE_LENGTH_BYTES),
      [op0.sigs[0], op0.sigs[1], op1.sigs[0]],
      'assignment 1: signatures'
    )

    assertBn((await app.getNodeOperator(0, false)).usedSigningKeys, 2, 'assignment 1: op 0 used keys')
    assertBn((await app.getNodeOperator(1, false)).usedSigningKeys, 1, 'assignment 1: op 1 used keys')

    result = await pool.assignNextSigningKeys(3)

    keysAssignedEvt = getEventAt(result, 'KeysAssigned').args

    assert.sameMembers(hexSplit(keysAssignedEvt.pubkeys, PUBKEY_LENGTH_BYTES), [op0.keys[2], op0.keys[3]], 'assignment 2: pubkeys')
    assert.sameMembers(hexSplit(keysAssignedEvt.signatures, SIGNATURE_LENGTH_BYTES), [op0.sigs[2], op0.sigs[3]], 'assignment 2: signatures')

    assertBn((await app.getNodeOperator(0, false)).usedSigningKeys, 4, 'assignment 2: op 0 used keys')
    assertBn((await app.getNodeOperator(1, false)).usedSigningKeys, 1, 'assignment 2: op 1 used keys')
  })

  it('reportStoppedValidators works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, { from: voting })

    await app.setNodeOperatorStakingLimit(0, 10, { from: voting })
    await app.setNodeOperatorStakingLimit(1, 10, { from: voting })

    await app.addSigningKeys(0, 2, hexConcat(pad('0x010101', 48), pad('0x020202', 48)), hexConcat(pad('0x01', 96), pad('0x02', 96)), {
      from: voting
    })
    await app.addSigningKeys(1, 2, hexConcat(pad('0x050505', 48), pad('0x060606', 48)), hexConcat(pad('0x04', 96), pad('0x03', 96)), {
      from: voting
    })

    await pool.assignNextSigningKeys(3)
    assertBn((await app.getNodeOperator(0, false)).usedSigningKeys, 2, 'op 0 used keys')
    assertBn((await app.getNodeOperator(1, false)).usedSigningKeys, 1, 'op 1 used keys')

    await assertRevert(app.reportStoppedValidators(0, 1, { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.reportStoppedValidators(1, 1, { from: nobody }), 'APP_AUTH_FAILED')

    await assertRevert(app.reportStoppedValidators(1, 0, { from: voting }), 'EMPTY_VALUE')

    assertBn((await app.getNodeOperator(0, false)).stoppedValidators, 0, 'before stop: op 0 stopped validators')
    assertBn((await app.getNodeOperator(1, false)).stoppedValidators, 0, 'before stop: op 1 stopped validators')

    await app.reportStoppedValidators(1, 1, { from: voting })

    assertBn((await app.getNodeOperator(0, false)).stoppedValidators, 0, 'after stop 1: op 0 stopped validators')
    assertBn((await app.getNodeOperator(1, false)).stoppedValidators, 1, 'after stop 1: op 1 stopped validators')

    await app.reportStoppedValidators(0, 1, { from: voting })

    assertBn((await app.getNodeOperator(0, false)).stoppedValidators, 1, 'after stop 2: op 0 stopped validators')
    assertBn((await app.getNodeOperator(1, false)).stoppedValidators, 1, 'after stop 2: op 1 stopped validators')

    await app.reportStoppedValidators(0, 1, { from: voting })

    assertBn((await app.getNodeOperator(0, false)).stoppedValidators, 2, 'after stop 3: op 0 stopped validators')
    assertBn((await app.getNodeOperator(1, false)).stoppedValidators, 1, 'after stop 3: op 1 stopped validators')

    await assertRevert(app.reportStoppedValidators(0, 1, { from: voting }), 'STOPPED_MORE_THAN_LAUNCHED')
    await assertRevert(app.reportStoppedValidators(1, 12, { from: voting }), 'STOPPED_MORE_THAN_LAUNCHED')

    await assertRevert(app.reportStoppedValidators(10, 1, { from: voting }), 'NODE_OPERATOR_NOT_FOUND')
  })

  it('reportStoppedValidators decreases stake', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, { from: voting })

    await app.setNodeOperatorStakingLimit(0, 10, { from: voting })
    await app.setNodeOperatorStakingLimit(1, 10, { from: voting })

    await app.addSigningKeys(0, 2, hexConcat(pad('0x010101', 48), pad('0x020202', 48)), hexConcat(pad('0x01', 96), pad('0x02', 96)), {
      from: voting
    })
    await app.addSigningKeys(1, 2, hexConcat(pad('0x050505', 48), pad('0x060606', 48)), hexConcat(pad('0x04', 96), pad('0x03', 96)), {
      from: voting
    })

    await pool.assignNextSigningKeys(1)
    assertBn((await app.getNodeOperator(0, false)).usedSigningKeys, 1, 'before the report: op 0 used keys')
    assertBn((await app.getNodeOperator(1, false)).usedSigningKeys, 0, 'before the report: op 1 used keys')

    await app.reportStoppedValidators(0, 1, { from: voting })
    assertBn((await app.getNodeOperator(0, false)).stoppedValidators, 1, 'op 0 stopped validators')

    await pool.assignNextSigningKeys(1)
    assertBn((await app.getNodeOperator(0, false)).usedSigningKeys, 2, 'after the report: op 0 used keys')
    assertBn((await app.getNodeOperator(1, false)).usedSigningKeys, 0, 'after the report: op 1 used keys')
  })

  it('trimUnusedKeys works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, { from: voting })

    await app.setNodeOperatorStakingLimit(0, 10, { from: voting })
    await app.setNodeOperatorStakingLimit(1, 10, { from: voting })

    await app.addSigningKeys(0, 2, hexConcat(pad('0x010101', 48), pad('0x020202', 48)), hexConcat(pad('0x01', 96), pad('0x02', 96)), {
      from: voting
    })
    await app.addSigningKeys(1, 2, hexConcat(pad('0x050505', 48), pad('0x060606', 48)), hexConcat(pad('0x04', 96), pad('0x03', 96)), {
      from: voting
    })

    await pool.assignNextSigningKeys(1)
    assertBn((await app.getNodeOperator(0, false)).usedSigningKeys, 1, 'op 0 used keys')

    await pool.trimUnusedKeys()

    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 0, 'op 0 unused keys')
    assertBn(await app.getUnusedSigningKeyCount(1, { from: nobody }), 0, 'op 1 unused keys')

    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 1, 'op 0 total keys')
    assertBn(await app.getTotalSigningKeyCount(1, { from: nobody }), 0, 'op 1 total keys')
  })

  it('addSigningKeys works', async () => {
    await app.addNodeOperator('1', ADDRESS_1, { from: voting })
    await app.addNodeOperator('2', ADDRESS_2, { from: voting })

    // first
    await assertRevert(app.addSigningKeys(0, 1, pad('0x01', 48), pad('0x01', 96), { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.addSigningKeys(0, 1, pad('0x01', 48), pad('0x01', 96), { from: nobody }), 'APP_AUTH_FAILED')

    await assertRevert(app.addSigningKeys(0, 0, '0x', '0x', { from: voting }), 'NO_KEYS')
    await assertRevert(app.addSigningKeys(0, 1, pad('0x00', 48), pad('0x01', 96), { from: voting }), 'EMPTY_KEY')
    await assertRevert(app.addSigningKeys(0, 1, pad('0x01', 32), pad('0x01', 96), { from: voting }), 'INVALID_LENGTH')
    await assertRevert(app.addSigningKeys(0, 1, pad('0x01', 48), pad('0x01', 90), { from: voting }), 'INVALID_LENGTH')

    await app.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })

    // second
    await assertRevert(app.addSigningKeys(0, 1, pad('0x01', 48), pad('0x01', 96), { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.addSigningKeys(0, 1, pad('0x01', 48), pad('0x01', 96), { from: nobody }), 'APP_AUTH_FAILED')

    await assertRevert(app.addSigningKeys(0, 1, pad('0x01', 32), pad('0x01', 96), { from: voting }), 'INVALID_LENGTH')
    await assertRevert(app.addSigningKeys(0, 1, pad('0x01', 48), pad('0x01', 90), { from: voting }), 'INVALID_LENGTH')

    await app.addSigningKeys(0, 2, hexConcat(pad('0x050505', 48), pad('0x060606', 48)), hexConcat(pad('0x02', 96), pad('0x03', 96)), {
      from: voting
    })

    // to the second operator
    await app.addSigningKeys(1, 1, pad('0x070707', 48), pad('0x01', 96), { from: voting })
    await assertRevert(app.addSigningKeys(2, 1, pad('0x080808', 48), pad('0x01', 96), { from: voting }), 'NODE_OPERATOR_NOT_FOUND')

    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await app.getTotalSigningKeyCount(1, { from: nobody }), 1)
  })

  it('rewardAddress can add & remove signing keys', async () => {
    await app.addNodeOperator('1', user1, { from: voting })
    await app.addNodeOperator('2', user2, { from: voting })

    // add to the first operator
    await assertRevert(app.addSigningKeysOperatorBH(0, 1, pad('0x01', 48), pad('0x01', 96), { from: nobody }), 'APP_AUTH_FAILED')
    await app.addSigningKeysOperatorBH(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: user1 })

    // add to the second operator
    await assertRevert(app.addSigningKeysOperatorBH(1, 1, pad('0x070707', 48), pad('0x01', 96), { from: nobody }), 'APP_AUTH_FAILED')
    await assertRevert(app.addSigningKeysOperatorBH(1, 1, pad('0x070707', 48), pad('0x01', 96), { from: user1 }), 'APP_AUTH_FAILED')

    await app.addSigningKeysOperatorBH(1, 1, pad('0x070707', 48), pad('0x01', 96), { from: user2 })
    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 1)
    assertBn(await app.getTotalSigningKeyCount(1, { from: nobody }), 1)

    // removal
    await assertRevert(app.removeSigningKeyOperatorBH(0, 0, { from: nobody }), 'APP_AUTH_FAILED')

    await app.removeSigningKeyOperatorBH(0, 0, { from: user1 })

    await assertRevert(app.removeSigningKeyOperatorBH(1, 0, { from: nobody }), 'APP_AUTH_FAILED')
    await assertRevert(app.removeSigningKeyOperatorBH(1, 0, { from: user1 }), 'APP_AUTH_FAILED')

    await app.removeSigningKeyOperatorBH(1, 0, { from: user2 })

    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await app.getTotalSigningKeyCount(1, { from: nobody }), 0)
  })

  it('can view keys', async () => {
    await app.addNodeOperator('1', ADDRESS_1, { from: voting })
    await app.addNodeOperator('2', ADDRESS_2, { from: voting })

    // first
    await app.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })

    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 1)
    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 1)
    {
      const { key, depositSignature: sig, used } = await app.getSigningKey(0, 0, { from: nobody })
      assert.equal(key, pad('0x010203', 48))
      assert.equal(sig, pad('0x01', 96))
      assert.equal(used, false)
    }

    // second
    await app.addSigningKeys(0, 2, hexConcat(pad('0x050505', 48), pad('0x060606', 48)), hexConcat(pad('0x02', 96), pad('0x03', 96)), {
      from: voting
    })

    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 3)
    assert.equal((await app.getSigningKey(0, 0, { from: nobody })).key, pad('0x010203', 48))

    {
      const { key, depositSignature: sig, used } = await app.getSigningKey(0, 1, { from: nobody })
      assert.equal(key, pad('0x050505', 48))
      assert.equal(sig, pad('0x02', 96))
      assert.equal(used, false)
    }
    {
      const { key, depositSignature: sig, used } = await app.getSigningKey(0, 2, { from: nobody })
      assert.equal(key, pad('0x060606', 48))
      assert.equal(sig, pad('0x03', 96))
      assert.equal(used, false)
    }

    await assertRevert(app.getSigningKey(0, 3, { from: nobody }), 'KEY_NOT_FOUND')
    await assertRevert(app.getSigningKey(0, 1000, { from: nobody }), 'KEY_NOT_FOUND')

    // to the second operator
    await app.addSigningKeys(1, 1, pad('0x070707', 48), pad('0x01', 96), { from: voting })
    assertBn(await app.getTotalSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await app.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    {
      const { key, depositSignature: sig, used } = await app.getSigningKey(1, 0, { from: nobody })
      assert.equal(key, pad('0x070707', 48))
      assert.equal(sig, pad('0x01', 96))
      assert.equal(used, false)
    }

    // the first is untouched
    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 3)
    assert.equal((await app.getSigningKey(0, 0, { from: nobody })).key, pad('0x010203', 48))
    assert.equal((await app.getSigningKey(0, 1, { from: nobody })).key, pad('0x050505', 48))

    await assertRevert(app.getTotalSigningKeyCount(2, { from: nobody }), 'NODE_OPERATOR_NOT_FOUND')
    await assertRevert(app.getUnusedSigningKeyCount(2, { from: nobody }), 'NODE_OPERATOR_NOT_FOUND')
  })

  it('removeSigningKey works', async () => {
    await app.addNodeOperator('1', ADDRESS_1, { from: voting })
    await app.addNodeOperator('2', ADDRESS_2, { from: voting })

    await app.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })

    await assertRevert(app.removeSigningKey(0, 0, { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.removeSigningKey(0, 0, { from: nobody }), 'APP_AUTH_FAILED')

    await app.removeSigningKey(0, 0, { from: voting })
    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    await assertRevert(app.removeSigningKey(0, 0, { from: voting }), 'KEY_NOT_FOUND')

    // to the second operator
    await app.addSigningKeys(1, 1, pad('0x070707', 48), pad('0x01', 96), { from: voting })

    // again to the first
    await app.addSigningKeys(0, 1, pad('0x010204', 48), pad('0x01', 96), { from: voting })

    await app.addSigningKeys(0, 1, pad('0x010205', 48), pad('0x01', 96), { from: voting })

    await app.addSigningKeys(0, 1, pad('0x010206', 48), pad('0x01', 96), { from: voting })
    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 3)

    await app.removeSigningKey(0, 0, { from: voting })
    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 2)
    assert.equal((await app.getSigningKey(0, 0, { from: nobody })).key, pad('0x010206', 48))
    assert.equal((await app.getSigningKey(0, 1, { from: nobody })).key, pad('0x010205', 48))

    await app.removeSigningKey(0, 1, { from: voting })
    await assertRevert(app.removeSigningKey(0, 1, { from: voting }), 'KEY_NOT_FOUND')
    await assertRevert(app.removeSigningKey(0, 2, { from: voting }), 'KEY_NOT_FOUND')

    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 1)
    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 1)
    assert.equal((await app.getSigningKey(0, 0, { from: nobody })).key, pad('0x010206', 48))

    // back to the second operator
    assert.equal((await app.getSigningKey(1, 0, { from: nobody })).key, pad('0x070707', 48))
    await app.removeSigningKey(1, 0, { from: voting })

    await assertRevert(app.getSigningKey(1, 0, { from: nobody }), 'KEY_NOT_FOUND')

    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 1)
    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 1)

    await app.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010101', 48), pad('0x020202', 48), pad('0x030303', 48)),
      hexConcat(pad('0x01', 96), pad('0x02', 96), pad('0x03', 96)),
      { from: voting }
    )
    await app.setNodeOperatorStakingLimit(0, 3, { from: voting })
    await app.removeSigningKey(0, 3, { from: voting })
    const { stakingLimit: stakingLimitAfter } = await app.getNodeOperator(0, false)
    assertBn(stakingLimitAfter, 3, 'Staking limit not changed on non-approved key removal')

    await app.removeSigningKey(0, 1, { from: voting })
    const { stakingLimit: stakingLimitAfter2 } = await app.getNodeOperator(0, false)
    assertBn(stakingLimitAfter2, 1, 'Staking limit set on removed index on removal')
  })

  it('removeSigningKeys works', async () => {
    await app.addNodeOperator('1', user1, { from: voting })
    await app.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })

    const op0 = {
      keys: [
        pad('0xaa0101', 48),
        pad('0xaa0202', 48),
        pad('0xaa0303', 48),
        pad('0xaa0404', 48),
        pad('0xbb0505', 48),
        pad('0xbb0606', 48),
        pad('0xbb0707', 48),
        pad('0xbb0808', 48)
      ],
      sigs: [
        pad('0xa1', 96),
        pad('0xa2', 96),
        pad('0xa3', 96),
        pad('0xa4', 96),
        pad('0xb5', 96),
        pad('0xb6', 96),
        pad('0xb7', 96),
        pad('0xb8', 96)
      ]
    }

    await app.addSigningKeys(0, 8, hexConcat(...op0.keys), hexConcat(...op0.sigs), { from: voting })

    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 8)
    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 8)

    await assertRevert(app.removeSigningKeys(0, 0, 1, { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.removeSigningKeys(0, 0, 1, { from: nobody }), 'APP_AUTH_FAILED')

    await app.removeSigningKeys(0, 0, 1, { from: voting })

    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 7)
    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 7)
    assert.equal((await app.getSigningKey(0, 0, { from: nobody })).key, op0.keys[7])
    await assertRevert(app.removeSigningKeys(0, 7, 1, { from: voting }), 'KEY_NOT_FOUND')
    await assertRevert(app.removeSigningKeys(0, 0, 8, { from: voting }), 'KEY_NOT_FOUND')

    await app.removeSigningKeys(0, 1, 2, { from: voting })
    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 5)
    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 5)

    assert.equal((await app.getSigningKey(0, 0, { from: nobody })).key, op0.keys[7])
    assert.equal((await app.getSigningKey(0, 1, { from: nobody })).key, op0.keys[5])
    assert.equal((await app.getSigningKey(0, 2, { from: nobody })).key, op0.keys[6])

    await assertRevert(app.removeSigningKeysOperatorBH(0, 3, 1, { from: voting }), 'APP_AUTH_FAILED')
    await assertRevert(app.removeSigningKeysOperatorBH(0, 3, 1, { from: nobody }), 'APP_AUTH_FAILED')

    await app.removeSigningKeysOperatorBH(0, 3, 1, { from: user1 })

    await assertRevert(app.removeSigningKeysOperatorBH(0, 4, 1, { from: voting }), 'APP_AUTH_FAILED')
    await assertRevert(app.removeSigningKeysOperatorBH(0, 4, 1, { from: user1 }), 'KEY_NOT_FOUND')
    await assertRevert(app.removeSigningKeysOperatorBH(0, 0, 5, { from: user1 }), 'KEY_NOT_FOUND')

    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 4)
    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 4)
    assert.equal((await app.getSigningKey(0, 3, { from: nobody })).key, op0.keys[4])

    await app.removeSigningKeysOperatorBH(0, 2, 2, { from: user1 })

    assert.equal((await app.getSigningKey(0, 0, { from: nobody })).key, op0.keys[7])
    assert.equal((await app.getSigningKey(0, 1, { from: nobody })).key, op0.keys[5])

    await app.removeSigningKeysOperatorBH(0, 0, 2, { from: user1 })
    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 0)
  })

  it('getRewardsDistribution works', async () => {
    const { empty_recipients, empty_shares } = await app.getRewardsDistribution(tokens(900))

    assert.equal(empty_recipients, undefined, 'recipients')
    assert.equal(empty_shares, undefined, 'shares')

    await app.addNodeOperator('fo o', ADDRESS_1, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, { from: voting })
    await app.addNodeOperator('3', ADDRESS_3, { from: voting })

    await app.setNodeOperatorStakingLimit(0, 10, { from: voting })
    await app.setNodeOperatorStakingLimit(1, 10, { from: voting })
    await app.setNodeOperatorStakingLimit(2, 10, { from: voting })

    await app.addSigningKeys(0, 2, hexConcat(pad('0x010101', 48), pad('0x020202', 48)), hexConcat(pad('0x01', 96), pad('0x02', 96)), {
      from: voting
    })
    await app.addSigningKeys(1, 2, hexConcat(pad('0x050505', 48), pad('0x060606', 48)), hexConcat(pad('0x04', 96), pad('0x03', 96)), {
      from: voting
    })

    await app.addSigningKeys(2, 2, hexConcat(pad('0x070707', 48), pad('0x080808', 48)), hexConcat(pad('0x05', 96), pad('0x06', 96)), {
      from: voting
    })

    await pool.assignNextSigningKeys(6)
    assertBn((await app.getNodeOperator(0, false)).usedSigningKeys, 2, 'op 0 used keys')
    assertBn((await app.getNodeOperator(1, false)).usedSigningKeys, 2, 'op 1 used keys')
    assertBn((await app.getNodeOperator(2, false)).usedSigningKeys, 2, 'op 2 used keys')

    await app.reportStoppedValidators(0, 1, { from: voting })
    await app.setNodeOperatorActive(2, false, { from: voting })

    const { recipients, shares } = await app.getRewardsDistribution(tokens(900))

    assert.sameOrderedMembers(recipients, [ADDRESS_1, ADDRESS_2], 'recipients')
    assert.sameOrderedMembers(
      shares.map((x) => String(x)),
      [tokens(300), tokens(600)],
      'shares'
    )
  })
  context('keysOpIndex increases correctly', () => {
    it('must increases on setNodeOperatorStakingLimit', async () => {
      await app.addNodeOperator('1', user1, { from: voting })
      assertBn(await app.getKeysOpIndex(), 0)
      const tx = await app.setNodeOperatorStakingLimit(0, 40, { from: voting })
      assertEvent(tx, 'KeysOpIndexSet', { expectedArgs: { keysOpIndex: 1 } })
      assertBn(await app.getKeysOpIndex(), 1)
    })
    it('must increases on addSigningKeys', async () => {
      await app.addNodeOperator('1', user1, { from: voting })
      assertBn(await app.getKeysOpIndex(), 0)
      const tx = await app.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
      assertEvent(tx, 'KeysOpIndexSet', { expectedArgs: { keysOpIndex: 1 } })
      assertBn(await app.getKeysOpIndex(), 1)
    })
    it('must increases on addSigningKeysOperatorBH', async () => {
      await app.addNodeOperator('1', user1, { from: voting })
      assertBn(await app.getKeysOpIndex(), 0)
      const tx = await app.addSigningKeysOperatorBH(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: user1 })
      assertEvent(tx, 'KeysOpIndexSet', { expectedArgs: { keysOpIndex: 1 } })
      assertBn(await app.getKeysOpIndex(), 1)
    })
    it('must increases on removeSigningKey', async () => {
      await app.addNodeOperator('1', user1, { from: voting })
      assertBn(await app.getKeysOpIndex(), 0)
      await app.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
      assertBn(await app.getKeysOpIndex(), 1)
      const tx = await app.removeSigningKey(0, 0, { from: voting })
      assertEvent(tx, 'KeysOpIndexSet', { expectedArgs: { keysOpIndex: 2 } })
      assertBn(await app.getKeysOpIndex(), 2)
    })
    it('must increases on removeSigningKeyOperatorBH', async () => {
      await app.addNodeOperator('1', user1, { from: voting })
      assertBn(await app.getKeysOpIndex(), 0)
      await app.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
      assertBn(await app.getKeysOpIndex(), 1)
      const tx = await app.removeSigningKeyOperatorBH(0, 0, { from: user1 })
      assertEvent(tx, 'KeysOpIndexSet', { expectedArgs: { keysOpIndex: 2 } })
      assertBn(await app.getKeysOpIndex(), 2)
    })
    it('must increases on setNodeOperatorActive', async () => {
      await app.addNodeOperator('1', user1, { from: voting })
      assertBn(await app.getKeysOpIndex(), 0)
      const tx = await app.setNodeOperatorActive(0, false, { from: voting })
      assertEvent(tx, 'KeysOpIndexSet', { expectedArgs: { keysOpIndex: 1 } })
      assertBn(await app.getKeysOpIndex(), 1)
    })
  })
})
