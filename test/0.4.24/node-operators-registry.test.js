const { assert } = require('chai')
const { KEYS_BATCH_SIZE, pad, padKey, padSig, tokens } = require('../helpers/utils')
const { packKeyArray, packSigArray, createKeyBatches, createSigBatches } = require('./helpers/publicKeyArrays')
const { buildKeyData } = require('./helpers/keyData')

const { newDao, newApp } = require('./helpers/dao')
const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const { assertBn, assertRevert } = require('@aragon/contract-helpers-test/src/asserts')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry.sol')
const PoolMock = artifacts.require('PoolMock.sol')
const ERC20Mock = artifacts.require('ERC20Mock.sol')

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'
const ADDRESS_3 = '0x0000000000000000000000000000000000000003'
const ADDRESS_4 = '0x0000000000000000000000000000000000000004'

const UNLIMITED = 1000000000

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
    await assertRevert(app.addNodeOperator('1', ADDRESS_1, 10, { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.addNodeOperator('1', ADDRESS_1, 10, { from: nobody }), 'APP_AUTH_FAILED')

    await assertRevert(app.addNodeOperator('1', ZERO_ADDRESS, 10, { from: voting }), 'EMPTY_ADDRESS')

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

    const op0 = {
      keys: createKeyBatches(1),
      sigs: createSigBatches(1)
    }

    await app.addSigningKeys(0, KEYS_BATCH_SIZE, packKeyArray(op0.keys), packSigArray(op0.sigs), {
      from: voting
    })

    let operator = await app.getNodeOperator(0, true)
    assert.equal(operator.active, true)
    assert.equal(operator.name, 'fo o')
    assert.equal(operator.rewardAddress, ADDRESS_1)
    assertBn(operator.stakingLimit, 10)
    assertBn(operator.stoppedValidators, 0)
    assertBn(operator.totalSigningKeys, KEYS_BATCH_SIZE)
    assertBn(operator.usedSigningKeys, 0)

    operator = await app.getNodeOperator(1, true)
    assert.equal(operator.active, true)
    assert.equal(operator.name, ' bar')
    assert.equal(operator.rewardAddress, ADDRESS_2)
    assertBn(operator.stakingLimit, UNLIMITED)
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
    await app.addNodeOperator('fo o', ADDRESS_1, 10, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, UNLIMITED, { from: voting })

    const op0 = {
      keys: createKeyBatches(1),
      sigs: createSigBatches(1)
    }

    await app.addSigningKeys(0, KEYS_BATCH_SIZE, packKeyArray(op0.keys), packSigArray(op0.sigs), { from: voting })

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

  it('verifyNextSigningKeys works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, 80, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, 80, { from: voting })

    const op0 = {
      keys: createKeyBatches(3),
      sigs: createSigBatches(3)
    }
    const op1 = {
      keys: createKeyBatches(3, 3 * KEYS_BATCH_SIZE),
      sigs: createSigBatches(3, 3 * KEYS_BATCH_SIZE)
    }
    const op2 = {
      keys: createKeyBatches(3, 6 * KEYS_BATCH_SIZE),
      sigs: createSigBatches(3, 6 * KEYS_BATCH_SIZE)
    }

    const operatorArray = [op0, op1, op2]

    await app.addSigningKeys(0, 3 * KEYS_BATCH_SIZE, packKeyArray(op0.keys), packSigArray(op0.sigs), { from: voting })
    await app.addSigningKeys(1, 3 * KEYS_BATCH_SIZE, packKeyArray(op1.keys), packSigArray(op1.sigs), { from: voting })

    await pool.verifyNextSigningKeys([buildKeyData(operatorArray, 0, 0)])

    await pool.verifyNextSigningKeys([buildKeyData(operatorArray, 1, 0), buildKeyData(operatorArray, 0, 1)])

    await pool.verifyNextSigningKeys([
      buildKeyData(operatorArray, 1, 1),
      buildKeyData(operatorArray, 0, 2),
      buildKeyData(operatorArray, 1, 2)
    ])
  })

  it('assignNextSigningKeys skips stopped operators', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, 10 * KEYS_BATCH_SIZE, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, 10 * KEYS_BATCH_SIZE, { from: voting })

    const op0 = {
      keys: createKeyBatches(3),
      sigs: createSigBatches(3)
    }
    const op1 = {
      keys: createKeyBatches(3, 3 * KEYS_BATCH_SIZE),
      sigs: createSigBatches(3, 3 * KEYS_BATCH_SIZE)
    }

    const operatorArray = [op0, op1]

    await app.addSigningKeys(0, 3 * KEYS_BATCH_SIZE, packKeyArray(op0.keys), packSigArray(op0.sigs), { from: voting })
    await app.addSigningKeys(1, 3 * KEYS_BATCH_SIZE, packKeyArray(op1.keys), packSigArray(op1.sigs), { from: voting })

    await pool.verifyNextSigningKeys([buildKeyData(operatorArray, 0, 0), buildKeyData(operatorArray, 1, 0)])
    await app.setNodeOperatorActive(0, false, { from: voting })

    await pool.verifyNextSigningKeys([buildKeyData(operatorArray, 1, 1), buildKeyData(operatorArray, 1, 2)])
  })

  it('assignNextSigningKeys respects staking limit', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, 4 * KEYS_BATCH_SIZE, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, 1 * KEYS_BATCH_SIZE, { from: voting })

    const op0 = {
      keys: createKeyBatches(4),
      sigs: createSigBatches(4)
    }
    const op1 = {
      keys: createKeyBatches(3, 4 * KEYS_BATCH_SIZE),
      sigs: createSigBatches(3, 4 * KEYS_BATCH_SIZE)
    }

    const operatorArray = [op0, op1]

    await app.addSigningKeys(0, 4 * KEYS_BATCH_SIZE, packKeyArray(op0.keys), packSigArray(op0.sigs), { from: voting })
    await app.addSigningKeys(1, 3 * KEYS_BATCH_SIZE, packKeyArray(op1.keys), packSigArray(op1.sigs), { from: voting })

    await pool.verifyNextSigningKeys([
      buildKeyData(operatorArray, 0, 0),
      buildKeyData(operatorArray, 1, 0),
      buildKeyData(operatorArray, 0, 1)
    ])

    assertBn((await app.getNodeOperator(0, false)).usedSigningKeys, 2 * KEYS_BATCH_SIZE, 'assignment 1: op 0 used keys')
    assertBn((await app.getNodeOperator(1, false)).usedSigningKeys, 1 * KEYS_BATCH_SIZE, 'assignment 1: op 1 used keys')

    await pool.verifyNextSigningKeys([buildKeyData(operatorArray, 0, 2), buildKeyData(operatorArray, 0, 3)])

    assertBn((await app.getNodeOperator(0, false)).usedSigningKeys, 4 * KEYS_BATCH_SIZE, 'assignment 2: op 0 used keys')
    assertBn((await app.getNodeOperator(1, false)).usedSigningKeys, 1 * KEYS_BATCH_SIZE, 'assignment 2: op 1 used keys')
  })

  it('reportStoppedValidators works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, 20, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, UNLIMITED, { from: voting })

    const op0 = {
      keys: createKeyBatches(2),
      sigs: createSigBatches(2)
    }
    const op1 = {
      keys: createKeyBatches(3, 2 * KEYS_BATCH_SIZE),
      sigs: createSigBatches(3, 2 * KEYS_BATCH_SIZE)
    }

    const operatorArray = [op0, op1]

    await app.addSigningKeys(0, 2 * KEYS_BATCH_SIZE, packKeyArray(op0.keys), packSigArray(op0.sigs), {
      from: voting
    })
    await app.addSigningKeys(1, 3 * KEYS_BATCH_SIZE, packKeyArray(op1.keys), packSigArray(op1.sigs), {
      from: voting
    })

    await pool.verifyNextSigningKeys([
      buildKeyData(operatorArray, 0, 0),
      buildKeyData(operatorArray, 1, 0),
      buildKeyData(operatorArray, 0, 1)
    ])
    assertBn((await app.getNodeOperator(0, false)).usedSigningKeys, 2 * KEYS_BATCH_SIZE, 'op 0 used keys')
    assertBn((await app.getNodeOperator(1, false)).usedSigningKeys, 1 * KEYS_BATCH_SIZE, 'op 1 used key')

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

    await app.reportStoppedValidators(0, 2 * KEYS_BATCH_SIZE - 1, { from: voting })

    assertBn((await app.getNodeOperator(0, false)).stoppedValidators, 2 * KEYS_BATCH_SIZE, 'after stop 3: op 0 stopped validators')
    assertBn((await app.getNodeOperator(1, false)).stoppedValidators, 1, 'after stop 3: op 1 stopped validators')

    await assertRevert(app.reportStoppedValidators(0, 1, { from: voting }), 'STOPPED_MORE_THAN_LAUNCHED')
    await assertRevert(app.reportStoppedValidators(1, 22, { from: voting }), 'STOPPED_MORE_THAN_LAUNCHED')

    await assertRevert(app.reportStoppedValidators(10, 1, { from: voting }), 'NODE_OPERATOR_NOT_FOUND')
  })

  it('reportStoppedValidators decreases stake', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, 22, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, UNLIMITED, { from: voting })

    const op0 = {
      keys: createKeyBatches(2),
      sigs: createSigBatches(2)
    }
    const op1 = {
      keys: createKeyBatches(2, 2 * KEYS_BATCH_SIZE),
      sigs: createSigBatches(2, 2 * KEYS_BATCH_SIZE)
    }

    const operatorArray = [op0, op1]

    await app.addSigningKeys(0, 2 * KEYS_BATCH_SIZE, packKeyArray(op0.keys), packSigArray(op0.sigs), {
      from: voting
    })
    await app.addSigningKeys(1, 2 * KEYS_BATCH_SIZE, packKeyArray(op1.keys), packSigArray(op1.sigs), {
      from: voting
    })

    await pool.verifyNextSigningKeys([buildKeyData(operatorArray, 0, 0)])

    assertBn((await app.getNodeOperator(0, false)).usedSigningKeys, KEYS_BATCH_SIZE, 'before the report: op 0 used keys')
    assertBn((await app.getNodeOperator(1, false)).usedSigningKeys, 0, 'before the report: op 1 used keys')

    // Operator must lose a whole batch of validators before becoming eligbile again
    await app.reportStoppedValidators(0, KEYS_BATCH_SIZE, { from: voting })
    assertBn((await app.getNodeOperator(0, false)).stoppedValidators, KEYS_BATCH_SIZE, 'op 0 stopped validators')

    await pool.verifyNextSigningKeys([buildKeyData(operatorArray, 0, 1)])

    assertBn((await app.getNodeOperator(0, false)).usedSigningKeys, 2 * KEYS_BATCH_SIZE, 'after the report: op 0 used keys')
    assertBn((await app.getNodeOperator(1, false)).usedSigningKeys, 0, 'after the report: op 1 used keys')
  })

  it('trimUnusedKeys works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, 20, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, UNLIMITED, { from: voting })

    const op0 = {
      keys: createKeyBatches(2),
      sigs: createSigBatches(2)
    }
    const op1 = {
      keys: createKeyBatches(2, 2 * KEYS_BATCH_SIZE),
      sigs: createSigBatches(2, 2 * KEYS_BATCH_SIZE)
    }

    const operatorArray = [op0, op1]

    await app.addSigningKeys(0, 2 * KEYS_BATCH_SIZE, packKeyArray(op0.keys), packSigArray(op0.sigs), {
      from: voting
    })
    await app.addSigningKeys(1, 2 * KEYS_BATCH_SIZE, packKeyArray(op1.keys), packSigArray(op1.sigs), {
      from: voting
    })

    await pool.verifyNextSigningKeys([buildKeyData(operatorArray, 0, 0)])
    assertBn((await app.getNodeOperator(0, false)).usedSigningKeys, KEYS_BATCH_SIZE, 'op 0 used keys')

    await pool.trimUnusedKeys()

    assertBn(await app.getUnusedSigningKeyCount(0, { from: nobody }), 0, 'op 0 unused keys')
    assertBn(await app.getUnusedSigningKeyCount(1, { from: nobody }), 0, 'op 1 unused keys')

    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), KEYS_BATCH_SIZE, 'op 0 total keys')
    assertBn(await app.getTotalSigningKeyCount(1, { from: nobody }), 0, 'op 1 total keys')
  })

  it('addSigningKeys works', async () => {
    await app.addNodeOperator('1', ADDRESS_1, UNLIMITED, { from: voting })
    await app.addNodeOperator('2', ADDRESS_2, UNLIMITED, { from: voting })

    const op0 = {
      keys: createKeyBatches(2),
      sigs: createSigBatches(2)
    }

    // first
    await assertRevert(
      app.addSigningKeys(0, 2 * KEYS_BATCH_SIZE, packKeyArray(op0.keys), packSigArray(op0.sigs), { from: user1 }),
      'APP_AUTH_FAILED'
    )
    await assertRevert(
      app.addSigningKeys(0, 2 * KEYS_BATCH_SIZE, packKeyArray(op0.keys), packSigArray(op0.sigs), { from: nobody }),
      'APP_AUTH_FAILED'
    )

    await assertRevert(app.addSigningKeys(0, 0, '0x', '0x', { from: voting }), 'NO_KEYS')
    // await assertRevert(app.addSigningKeys(0, 1, padKey('0x00'), padSig('0x01'), { from: voting }), 'EMPTY_KEY')
    await assertRevert(app.addSigningKeys(0, 1, pad('0x01', 32), padSig('0x01'), { from: voting }), 'INVALID_LENGTH')
    await assertRevert(app.addSigningKeys(0, 1, padKey('0x01'), pad('0x01', 90), { from: voting }), 'INVALID_LENGTH')

    await app.addSigningKeys(0, 2 * KEYS_BATCH_SIZE, packKeyArray(op0.keys), packSigArray(op0.sigs), { from: voting })

    const op0Next = {
      keys: createKeyBatches(2, 2 * KEYS_BATCH_SIZE),
      sigs: createSigBatches(2, 2 * KEYS_BATCH_SIZE)
    }

    // second
    await assertRevert(
      app.addSigningKeys(0, 2 * KEYS_BATCH_SIZE, packKeyArray(op0Next.keys), packSigArray(op0Next.sigs), { from: user1 }),
      'APP_AUTH_FAILED'
    )
    await assertRevert(
      app.addSigningKeys(0, 2 * KEYS_BATCH_SIZE, packKeyArray(op0Next.keys), packSigArray(op0Next.sigs), { from: nobody }),
      'APP_AUTH_FAILED'
    )

    await assertRevert(
      app.addSigningKeys(0, 2 * KEYS_BATCH_SIZE, packKeyArray(op0Next.keys).slice(0, -2), packSigArray(op0Next.sigs), { from: voting }),
      'INVALID_LENGTH'
    )
    await assertRevert(
      app.addSigningKeys(0, 2 * KEYS_BATCH_SIZE, packKeyArray(op0Next.keys), packSigArray(op0Next.sigs).slice(0, -2), { from: voting }),
      'INVALID_LENGTH'
    )

    await app.addSigningKeys(0, 2 * KEYS_BATCH_SIZE, packKeyArray(op0Next.keys), packSigArray(op0Next.sigs), {
      from: voting
    })

    const op1 = {
      keys: createKeyBatches(2),
      sigs: createSigBatches(2)
    }

    // to the second operator
    await app.addSigningKeys(1, 2 * KEYS_BATCH_SIZE, packKeyArray(op1.keys), packSigArray(op1.sigs), { from: voting })
    await assertRevert(
      app.addSigningKeys(2, 2 * KEYS_BATCH_SIZE, packKeyArray(op1.keys), packSigArray(op1.sigs), { from: voting }),
      'NODE_OPERATOR_NOT_FOUND'
    )

    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 2 * KEYS_BATCH_SIZE)
    assertBn(await app.getTotalSigningKeyCount(1, { from: nobody }), 2 * KEYS_BATCH_SIZE)
  })

  it('rewardAddress can add & remove merkle roots', async () => {
    await app.addNodeOperator('1', user1, UNLIMITED, { from: voting })
    await app.addNodeOperator('2', user2, UNLIMITED, { from: voting })

    const op0 = {
      keys: createKeyBatches(2),
      sigs: createSigBatches(2)
    }
    const op1 = {
      keys: createKeyBatches(2, 2 * KEYS_BATCH_SIZE),
      sigs: createSigBatches(2, 2 * KEYS_BATCH_SIZE)
    }

    // add to the first operator
    await assertRevert(
      app.addSigningKeysOperatorBH(0, 2 * KEYS_BATCH_SIZE, packKeyArray(op0.keys), packSigArray(op0.sigs), { from: nobody }),
      'APP_AUTH_FAILED'
    )
    await app.addSigningKeysOperatorBH(0, 2 * KEYS_BATCH_SIZE, packKeyArray(op0.keys), packSigArray(op0.sigs), { from: user1 })

    // add to the second operator
    await assertRevert(
      app.addSigningKeysOperatorBH(1, 2 * KEYS_BATCH_SIZE, packKeyArray(op1.keys), packSigArray(op1.sigs), { from: nobody }),
      'APP_AUTH_FAILED'
    )
    await assertRevert(
      app.addSigningKeysOperatorBH(1, 2 * KEYS_BATCH_SIZE, packKeyArray(op1.keys), packSigArray(op1.sigs), { from: user1 }),
      'APP_AUTH_FAILED'
    )

    await app.addSigningKeysOperatorBH(1, 2 * KEYS_BATCH_SIZE, packKeyArray(op1.keys), packSigArray(op1.sigs), { from: user2 })

    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 2 * KEYS_BATCH_SIZE)
    assertBn(await app.getTotalSigningKeyCount(1, { from: nobody }), 2 * KEYS_BATCH_SIZE)

    // removal
    await assertRevert(app.clearMerkleRootOperatorBH(0, { from: nobody }), 'APP_AUTH_FAILED')
    await app.clearMerkleRootOperatorBH(0, { from: user1 })

    await assertRevert(app.clearMerkleRootOperatorBH(1, { from: nobody }), 'APP_AUTH_FAILED')
    await assertRevert(app.clearMerkleRootOperatorBH(1, { from: user1 }), 'APP_AUTH_FAILED')
    await app.clearMerkleRootOperatorBH(1, { from: user2 })

    assertBn(await app.getTotalSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await app.getTotalSigningKeyCount(1, { from: nobody }), 0)
  })

  it('getRewardsDistribution works', async () => {
    const { empty_recipients, empty_shares } = await app.getRewardsDistribution(tokens(900))

    assert.equal(empty_recipients, undefined, 'recipients')
    assert.equal(empty_shares, undefined, 'shares')

    await app.addNodeOperator('fo o', ADDRESS_1, 16, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, UNLIMITED, { from: voting })
    await app.addNodeOperator('3', ADDRESS_3, UNLIMITED, { from: voting })

    const op0 = {
      keys: createKeyBatches(2),
      sigs: createSigBatches(2)
    }
    const op1 = {
      keys: createKeyBatches(2, 2 * KEYS_BATCH_SIZE),
      sigs: createSigBatches(2, 2 * KEYS_BATCH_SIZE)
    }
    const op2 = {
      keys: createKeyBatches(2, 4 * KEYS_BATCH_SIZE),
      sigs: createSigBatches(2, 4 * KEYS_BATCH_SIZE)
    }

    const operatorArray = [op0, op1, op2]

    await app.addSigningKeys(0, 2 * KEYS_BATCH_SIZE, packKeyArray(op0.keys), packSigArray(op0.sigs), {
      from: voting
    })
    await app.addSigningKeys(1, 2 * KEYS_BATCH_SIZE, packKeyArray(op1.keys), packSigArray(op1.sigs), {
      from: voting
    })
    await app.addSigningKeys(2, 2 * KEYS_BATCH_SIZE, packKeyArray(op2.keys), packSigArray(op2.sigs), {
      from: voting
    })

    await pool.verifyNextSigningKeys([
      buildKeyData(operatorArray, 0, 0),
      buildKeyData(operatorArray, 1, 0),
      buildKeyData(operatorArray, 2, 0),
      buildKeyData(operatorArray, 0, 1),
      buildKeyData(operatorArray, 1, 1),
      buildKeyData(operatorArray, 2, 1)
    ])
    assertBn((await app.getNodeOperator(0, false)).usedSigningKeys, 2 * KEYS_BATCH_SIZE, 'op 0 used keys')
    assertBn((await app.getNodeOperator(1, false)).usedSigningKeys, 2 * KEYS_BATCH_SIZE, 'op 1 used keys')
    assertBn((await app.getNodeOperator(2, false)).usedSigningKeys, 2 * KEYS_BATCH_SIZE, 'op 2 used keys')

    await app.reportStoppedValidators(0, KEYS_BATCH_SIZE, { from: voting })
    await app.setNodeOperatorActive(2, false, { from: voting })

    const { recipients, shares } = await app.getRewardsDistribution(tokens(900))

    assert.sameOrderedMembers(recipients, [ADDRESS_1, ADDRESS_2], 'recipients')
    assert.sameOrderedMembers(
      shares.map((x) => String(x)),
      [tokens(300), tokens(600)],
      'shares'
    )
  })
})
