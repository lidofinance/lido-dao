const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn, assertRevert } = require('@aragon/contract-helpers-test/src/asserts')

const TestNodeOperatorsRegistry = artifacts.require('TestNodeOperatorsRegistry.sol')
const PoolMock = artifacts.require('PoolMock.sol')
const ERC20Mock = artifacts.require('ERC20Mock.sol')

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

const ETH = (value) => web3.utils.toWei(value + '', 'ether')
const tokens = ETH

contract('NodeOperatorsRegistry', ([appManager, voting, user1, user2, user3, nobody]) => {
  let appBase, app

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await TestNodeOperatorsRegistry.new()
  })

  beforeEach('deploy dao and app', async () => {
    const { dao, acl } = await newDao(appManager)

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    const proxyAddress = await newApp(dao, 'node-operators-registry', appBase.address, appManager)
    app = await TestNodeOperatorsRegistry.at(proxyAddress)

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.SET_POOL(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.MANAGE_SIGNING_KEYS(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.ADD_NODE_OPERATOR_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_NODE_OPERATOR_ACTIVE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_NODE_OPERATOR_NAME_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_NODE_OPERATOR_ADDRESS_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_NODE_OPERATOR_LIMIT_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.REPORT_STOPPED_VALIDATORS_ROLE(), appManager, { from: appManager })

    // Initialize the app's proxy.
    await app.initialize()
  })

  it('addNodeOperator works', async () => {
    await assertRevert(app.addNodeOperator('1', ADDRESS_1, 10, { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.addNodeOperator('1', ADDRESS_1, 10, { from: nobody }), 'APP_AUTH_FAILED')

    await app.addNodeOperator('fo o', ADDRESS_1, 10, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, UNLIMITED, { from: voting })

    assertBn(await app.getNodeOperatorsCount({ from: nobody }), 2)
    assertBn(await app.getActiveNodeOperatorsCount({ from: nobody }), 2)

    await assertRevert(app.addNodeOperator('1', ADDRESS_3, 10, { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.addNodeOperator('1', ADDRESS_3, 10, { from: nobody }), 'APP_AUTH_FAILED')
  })

  it('getNodeOperator works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, 10, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, UNLIMITED, { from: voting })

    await app.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })

    let sp = await app.getNodeOperator(0, true)
    assert.equal(operator.active, true)
    assert.equal(operator.name, 'fo o')
    assert.equal(operator.rewardAddress, ADDRESS_1)
    assertBn(operator.stakingLimit, 10)
    assertBn(operator.stoppedValidators, 0)
    assertBn(operator.totalSigningKeys, 1)
    assertBn(operator.usedSigningKeys, 0)

    sp = await app.getNodeOperator(1, true)
    assert.equal(operator.active, true)
    assert.equal(operator.name, ' bar')
    assert.equal(operator.rewardAddress, ADDRESS_2)
    assertBn(operator.stakingLimit, UNLIMITED)
    assertBn(operator.stoppedValidators, 0)
    assertBn(operator.totalSigningKeys, 0)
    assertBn(operator.usedSigningKeys, 0)

    sp = await app.getNodeOperator(0, false)
    assert.equal(operator.name, '')
    assert.equal(operator.rewardAddress, ADDRESS_1)

    sp = await app.getNodeOperator(1, false)
    assert.equal(operator.name, '')
    assert.equal(operator.rewardAddress, ADDRESS_2)

    await assertRevert(app.getNodeOperator(10, false), 'NODE_OPERATOR_NOT_FOUND')
  })

  it('setNodeOperatorActive works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, 10, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, UNLIMITED, { from: voting })

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

    await app.setNodeOperatorActive(0, false, { from: voting })
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

    await app.setNodeOperatorActive(0, true, { from: voting })
    assert.equal((await app.getNodeOperator(0, false)).active, true)
    assertBn(await app.getActiveNodeOperatorsCount({ from: nobody }), 1)

    await assertRevert(app.setNodeOperatorActive(10, false, { from: voting }), 'NODE_OPERATOR_NOT_FOUND')
  })

  it('setNodeOperatorName works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, 10, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, UNLIMITED, { from: voting })

    await assertRevert(app.setNodeOperatorName(0, 'zzz', { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.setNodeOperatorName(0, 'zzz', { from: nobody }), 'APP_AUTH_FAILED')

    assert.equal((await app.getNodeOperator(0, true)).name, 'fo o')
    assert.equal((await app.getNodeOperator(1, true)).name, ' bar')

    await app.setNodeOperatorName(0, 'zzz', { from: voting })

    assert.equal((await app.getNodeOperator(0, true)).name, 'zzz')
    assert.equal((await app.getNodeOperator(1, true)).name, ' bar')

    await assertRevert(app.setNodeOperatorName(10, 'foo', { from: voting }), 'NODE_OPERATOR_NOT_FOUND')
  })

  it('setNodeOperatorRewardAddress works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, 10, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, UNLIMITED, { from: voting })

    await assertRevert(app.setNodeOperatorRewardAddress(0, ADDRESS_4, { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.setNodeOperatorRewardAddress(1, ADDRESS_4, { from: nobody }), 'APP_AUTH_FAILED')

    assert.equal((await app.getNodeOperator(0, false)).rewardAddress, ADDRESS_1)
    assert.equal((await app.getNodeOperator(1, false)).rewardAddress, ADDRESS_2)

    await app.setNodeOperatorRewardAddress(0, ADDRESS_4, { from: voting })

    assert.equal((await app.getNodeOperator(0, false)).rewardAddress, ADDRESS_4)
    assert.equal((await app.getNodeOperator(1, false)).rewardAddress, ADDRESS_2)

    await assertRevert(app.setNodeOperatorRewardAddress(10, ADDRESS_4, { from: voting }), 'NODE_OPERATOR_NOT_FOUND')
  })

  it('setNodeOperatorStakingLimit works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, 10, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, UNLIMITED, { from: voting })

    await assertRevert(app.setNodeOperatorStakingLimit(0, 40, { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.setNodeOperatorStakingLimit(1, 40, { from: nobody }), 'APP_AUTH_FAILED')

    assertBn((await app.getNodeOperator(0, false)).stakingLimit, 10)
    assertBn((await app.getNodeOperator(1, false)).stakingLimit, UNLIMITED)

    await app.setNodeOperatorStakingLimit(0, 40, { from: voting })

    assertBn((await app.getNodeOperator(0, false)).stakingLimit, 40)
    assertBn((await app.getNodeOperator(1, false)).stakingLimit, UNLIMITED)

    await assertRevert(app.setNodeOperatorStakingLimit(10, 40, { from: voting }), 'NODE_OPERATOR_NOT_FOUND')
  })

  it('reportStoppedValidators works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, 10, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, UNLIMITED, { from: voting })

    await app.addSigningKeys(0, 2, hexConcat(pad('0x010101', 48), pad('0x020202', 48)), hexConcat(pad('0x01', 96), pad('0x02', 96)), {
      from: voting
    })
    await app.addSigningKeys(1, 2, hexConcat(pad('0x050505', 48), pad('0x060606', 48)), hexConcat(pad('0x04', 96), pad('0x03', 96)), {
      from: voting
    })

    const pool = await PoolMock.new(app.address)
    await app.setPool(pool.address, { from: voting })
    await pool.updateUsedKeys([0, 1], [2, 1])

    await assertRevert(app.reportStoppedValidators(0, 1, { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.reportStoppedValidators(1, 1, { from: nobody }), 'APP_AUTH_FAILED')

    assertBn((await app.getNodeOperator(0, false)).stoppedValidators, 0)
    assertBn((await app.getNodeOperator(1, false)).stoppedValidators, 0)

    await app.reportStoppedValidators(0, 1, { from: voting })

    assertBn((await app.getNodeOperator(0, false)).stoppedValidators, 1)
    assertBn((await app.getNodeOperator(1, false)).stoppedValidators, 0)

    await app.reportStoppedValidators(1, 1, { from: voting })

    assertBn((await app.getNodeOperator(0, false)).stoppedValidators, 1)
    assertBn((await app.getNodeOperator(1, false)).stoppedValidators, 1)

    await app.reportStoppedValidators(0, 1, { from: voting })

    assertBn((await app.getNodeOperator(0, false)).stoppedValidators, 2)
    assertBn((await app.getNodeOperator(1, false)).stoppedValidators, 1)

    await assertRevert(app.reportStoppedValidators(0, 1, { from: voting }), 'STOPPED_MORE_THAN_LAUNCHED')
    await assertRevert(app.reportStoppedValidators(1, 12, { from: voting }), 'STOPPED_MORE_THAN_LAUNCHED')

    await assertRevert(app.reportStoppedValidators(10, 1, { from: voting }), 'NODE_OPERATOR_NOT_FOUND')
  })

  it('updateUsedKeys works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, 10, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, UNLIMITED, { from: voting })

    await app.addSigningKeys(0, 2, hexConcat(pad('0x010101', 48), pad('0x020202', 48)), hexConcat(pad('0x01', 96), pad('0x02', 96)), {
      from: voting
    })
    await app.addSigningKeys(1, 2, hexConcat(pad('0x050505', 48), pad('0x060606', 48)), hexConcat(pad('0x04', 96), pad('0x03', 96)), {
      from: voting
    })

    const pool = await PoolMock.new(app.address)
    await app.setPool(pool.address, { from: voting })

    await pool.updateUsedKeys([1], [1])
    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await app.getUnusedSigningKeyCount(1, { from: nobody }), 1)

    await pool.updateUsedKeys([1], [1])
    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await app.getUnusedSigningKeyCount(1, { from: nobody }), 1)

    await pool.updateUsedKeys([0, 1, 0], [1, 2, 1])
    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 1)
    assertBn(await app.getUnusedSigningKeyCount(1, { from: nobody }), 0)

    await assertRevert(pool.updateUsedKeys([10], [1]), 'NODE_OPERATOR_NOT_FOUND')
    await assertRevert(pool.updateUsedKeys([1], [3]), 'INCONSISTENCY')
    await assertRevert(pool.updateUsedKeys([1], [2, 2, 2]), 'BAD_LENGTH')
    await assertRevert(pool.updateUsedKeys([1], [0]), 'USED_KEYS_DECREASED')
  })

  it('trimUnusedKeys works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, 10, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, UNLIMITED, { from: voting })

    await app.addSigningKeys(0, 2, hexConcat(pad('0x010101', 48), pad('0x020202', 48)), hexConcat(pad('0x01', 96), pad('0x02', 96)), {
      from: voting
    })
    await app.addSigningKeys(1, 2, hexConcat(pad('0x050505', 48), pad('0x060606', 48)), hexConcat(pad('0x04', 96), pad('0x03', 96)), {
      from: voting
    })

    const pool = await PoolMock.new(app.address)
    await app.setPool(pool.address, { from: voting })

    await pool.updateUsedKeys([1], [1])
    await pool.trimUnusedKeys()

    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await app.getUnusedSigningKeyCount(1, { from: nobody }), 0)

    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await app.getTotalSigningKeyCount(1, { from: nobody }), 1)
  })

  it('addSigningKeys works', async () => {
    await app.addNodeOperator('1', ADDRESS_1, UNLIMITED, { from: voting })
    await app.addNodeOperator('2', ADDRESS_2, UNLIMITED, { from: voting })

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

    // to the second SP
    await app.addSigningKeys(1, 1, pad('0x070707', 48), pad('0x01', 96), { from: voting })
    await assertRevert(app.addSigningKeys(2, 1, pad('0x080808', 48), pad('0x01', 96), { from: voting }), 'NODE_OPERATOR_NOT_FOUND')

    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await app.getTotalSigningKeyCount(1, { from: nobody }), 1)
  })

  it('rewardAddress can add & remove signing keys', async () => {
    await app.addNodeOperator('1', user1, UNLIMITED, { from: voting })
    await app.addNodeOperator('2', user2, UNLIMITED, { from: voting })

    // add to the first SP
    await assertRevert(app.addSigningKeysSP(0, 1, pad('0x01', 48), pad('0x01', 96), { from: nobody }), 'APP_AUTH_FAILED')
    await app.addSigningKeysSP(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: user1 })

    // add to the second SP
    await assertRevert(app.addSigningKeysSP(1, 1, pad('0x070707', 48), pad('0x01', 96), { from: nobody }), 'APP_AUTH_FAILED')
    await assertRevert(app.addSigningKeysSP(1, 1, pad('0x070707', 48), pad('0x01', 96), { from: user1 }), 'APP_AUTH_FAILED')

    await app.addSigningKeysSP(1, 1, pad('0x070707', 48), pad('0x01', 96), { from: user2 })

    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 1)
    assertBn(await app.getTotalSigningKeyCount(1, { from: nobody }), 1)

    // removal
    await assertRevert(app.removeSigningKeySP(0, 0, { from: nobody }), 'APP_AUTH_FAILED')
    await app.removeSigningKeySP(0, 0, { from: user1 })

    await assertRevert(app.removeSigningKeySP(1, 0, { from: nobody }), 'APP_AUTH_FAILED')
    await assertRevert(app.removeSigningKeySP(1, 0, { from: user1 }), 'APP_AUTH_FAILED')
    await app.removeSigningKeySP(1, 0, { from: user2 })

    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await app.getTotalSigningKeyCount(1, { from: nobody }), 0)
  })

  it('can view keys', async () => {
    await app.addNodeOperator('1', ADDRESS_1, UNLIMITED, { from: voting })
    await app.addNodeOperator('2', ADDRESS_2, UNLIMITED, { from: voting })

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

    // to the second SP
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
    await app.addNodeOperator('1', ADDRESS_1, UNLIMITED, { from: voting })
    await app.addNodeOperator('2', ADDRESS_2, UNLIMITED, { from: voting })

    await app.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })

    await assertRevert(app.removeSigningKey(0, 0, { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.removeSigningKey(0, 0, { from: nobody }), 'APP_AUTH_FAILED')

    await app.removeSigningKey(0, 0, { from: voting })
    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    await assertRevert(app.removeSigningKey(0, 0, { from: voting }), 'KEY_NOT_FOUND')

    // to the second SP
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

    // back to the second SP
    assert.equal((await app.getSigningKey(1, 0, { from: nobody })).key, pad('0x070707', 48))
    await app.removeSigningKey(1, 0, { from: voting })
    await assertRevert(app.getSigningKey(1, 0, { from: nobody }), 'KEY_NOT_FOUND')
  })

  it('distributeRewards works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, 10, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, UNLIMITED, { from: voting })
    await app.addNodeOperator('3', ADDRESS_3, UNLIMITED, { from: voting })

    await app.addSigningKeys(0, 2, hexConcat(pad('0x010101', 48), pad('0x020202', 48)), hexConcat(pad('0x01', 96), pad('0x02', 96)), {
      from: voting
    })
    await app.addSigningKeys(1, 2, hexConcat(pad('0x050505', 48), pad('0x060606', 48)), hexConcat(pad('0x04', 96), pad('0x03', 96)), {
      from: voting
    })
    await app.addSigningKeys(2, 2, hexConcat(pad('0x070707', 48), pad('0x080808', 48)), hexConcat(pad('0x05', 96), pad('0x06', 96)), {
      from: voting
    })

    const pool = await PoolMock.new(app.address)
    await app.setPool(pool.address, { from: voting })

    await pool.updateUsedKeys([0, 1, 2], [2, 2, 2])

    await app.reportStoppedValidators(0, 1, { from: voting })
    await app.setNodeOperatorActive(2, false, { from: voting })

    const token = await ERC20Mock.new()
    await token.mint(app.address, tokens(900))
    await pool.distributeRewards(token.address, tokens(900))

    assertBn(await token.balanceOf(ADDRESS_1, { from: nobody }), tokens(300))
    assertBn(await token.balanceOf(ADDRESS_2, { from: nobody }), tokens(600))
    assertBn(await token.balanceOf(ADDRESS_3, { from: nobody }), 0)
    assertBn(await token.balanceOf(app.address, { from: nobody }), 0)
  })
})
