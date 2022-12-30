const hre = require('hardhat')
const { assert } = require('chai')
const { hexSplit, toBN } = require('../helpers/utils')
const { newDao, newApp } = require('./helpers/dao')
const { EvmSnapshot } = require('../helpers/blockchain')
const { ZERO_ADDRESS, getEventAt } = require('@aragon/contract-helpers-test')
const { assertBn, assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const keccak256 = require('js-sha3').keccak_256
const nodeOperators = require('../helpers/node-operators')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistryMock')
const PoolMock = artifacts.require('PoolMock.sol')

const PUBKEY_LENGTH_BYTES = 48
const SIGNATURE_LENGTH_BYTES = 96

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'
const ADDRESS_3 = '0x0000000000000000000000000000000000000003'
const ADDRESS_4 = '0x0000000000000000000000000000000000000004'

const UNLIMITED = 1000000000

// bytes32 0x63757261746564
const CURATED_TYPE = web3.utils.fromAscii('curated')

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
const StETH = artifacts.require('StETHMock')

contract('NodeOperatorsRegistry', ([appManager, voting, user1, user2, user3, nobody, ste]) => {
  let appBase, app, pool, steth, acl
  const snapshot = new EvmSnapshot(hre.ethers.provider)

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await NodeOperatorsRegistry.new()
    steth = await StETH.new()

    const newDAO = await newDao(appManager)
    acl = newDAO.acl

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    const proxyAddress = await newApp(newDAO.dao, 'node-operators-registry', appBase.address, appManager)
    app = await NodeOperatorsRegistry.at(proxyAddress)

    pool = await PoolMock.new(app.address)

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.MANAGE_SIGNING_KEYS(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.ADD_NODE_OPERATOR_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_NODE_OPERATOR_ACTIVE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_NODE_OPERATOR_NAME_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_NODE_OPERATOR_ADDRESS_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_NODE_OPERATOR_LIMIT_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.REPORT_STOPPED_VALIDATORS_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.UPDATE_EXITED_VALIDATORS_KEYS_COUNT_ROLE(), appManager, {
      from: appManager
    })

    await acl.createPermission(pool.address, app.address, await app.REQUEST_VALIDATORS_KEYS_ROLE(), appManager, { from: appManager })
    await acl.createPermission(pool.address, app.address, await app.TRIM_UNUSED_KEYS_ROLE(), appManager, { from: appManager })

    // Initialize the app's proxy.
    await app.initialize(steth.address, CURATED_TYPE)
    await snapshot.add()
  })

  afterEach(async () => {
    await snapshot.revert()
    await snapshot.add()
  })

  describe('finalizeUpgrade_v2()', () => {
    let registryImpl

    before(async () => {
      registryImpl = await NodeOperatorsRegistry.new()
      assertBn(await registryImpl.getVersion(), 0)
      await snapshot.add()
    })

    after(async () => {
      // return to initial snapshot after all tests finished
      await snapshot.revert(-2)
      await snapshot.add()
    })

    it('sets correct contract version', async () => {
      await registryImpl.finalizeUpgrade_v2(pool.address, CURATED_TYPE)
      assertBn(await registryImpl.getVersion(), 2)
    })

    it('reverts with error STETH_ADDRESS_ZERO when stETH address is zero address', async () => {
      await assertRevert(registryImpl.finalizeUpgrade_v2(ZERO_ADDRESS, CURATED_TYPE), 'STETH_ADDRESS_ZERO')
    })

    it('reverts with error WRONG_BASE_VERSION when called on already initialized contract', async () => {
      await registryImpl.finalizeUpgrade_v2(pool.address, CURATED_TYPE)
      assertBn(await registryImpl.getVersion(), 2)
      assertRevert(registryImpl.finalizeUpgrade_v2(pool.address, CURATED_TYPE), 'WRONG_BASE_VERSION')
    })

    it('emits ContractVersionSet event with correct params', async () => {
      const receipt = await registryImpl.finalizeUpgrade_v2(pool.address, CURATED_TYPE)
      assertEvent(receipt, 'ContractVersionSet', { expectedArgs: { version: 2 } })
    })

    it('emits StethContractSet event with correct params', async () => {
      const receipt = await registryImpl.finalizeUpgrade_v2(pool.address, CURATED_TYPE)
      assertEvent(receipt, 'StethContractSet', { expectedArgs: { stethAddress: pool.address } })
    })

    it('emits StakingModuleTypeSet event with correct params', async () => {
      const receipt = await registryImpl.finalizeUpgrade_v2(pool.address, CURATED_TYPE)
      const moduleType = await app.getType()
      assertEvent(receipt, 'StakingModuleTypeSet', { expectedArgs: { moduleType } })
    })
  })

  describe('addNodeOperator()', () => {
    it('reverts when called by sender without ADD_NODE_OPERATOR_ROLE', async () => {
      const hasPermission = await acl.hasPermission(nobody, app.address, await app.ADD_NODE_OPERATOR_ROLE())
      assert.isFalse(hasPermission)

      await assertRevert(app.addNodeOperator('1', ADDRESS_1, { from: nobody }), 'APP_AUTH_FAILED')
    })

    it('reverts with error "NAME_IS_EMPTY" when called with empty name', async () => {
      const hasPermission = await acl.hasPermission(voting, app.address, await app.ADD_NODE_OPERATOR_ROLE())
      assert.isTrue(hasPermission)

      await assertRevert(app.addNodeOperator('', ADDRESS_1, { from: voting }), 'NAME_IS_EMPTY')
    })

    it('reverts with error "NAME_TOO_LONG" when called with name length > MAX_NODE_OPERATOR_NAME_LENGTH', async () => {
      const hasPermission = await acl.hasPermission(voting, app.address, await app.ADD_NODE_OPERATOR_ROLE())
      assert.isTrue(hasPermission)

      const maxNameLength = await app.MAX_NODE_OPERATOR_NAME_LENGTH()
      const tooLongName = '&'.repeat(maxNameLength + 1)

      await assertRevert(app.addNodeOperator(tooLongName, ADDRESS_1, { from: voting }), 'NAME_TOO_LONG')
    })

    it('reverts with error "ZERO_ADDRESS" when called with zero reward address', async () => {
      const hasPermission = await acl.hasPermission(voting, app.address, await app.ADD_NODE_OPERATOR_ROLE())
      assert.isTrue(hasPermission)

      const name = 'Node Operator #1'

      await assertRevert(app.addNodeOperator(name, ZERO_ADDRESS, { from: voting }), 'ZERO_ADDRESS')
    })

    it('reverts with error "MAX_NODE_OPERATORS_COUNT_EXCEEDED" when total count of node operators = MAX_NODE_OPERATORS_COUNT', async () => {
      const hasPermission = await acl.hasPermission(voting, app.address, await app.ADD_NODE_OPERATOR_ROLE())
      assert.isTrue(hasPermission)

      const maxNodeOperatorsCount = await app.MAX_NODE_OPERATORS_COUNT()

      for (let i = 0; i < maxNodeOperatorsCount; ++i) {
        await app.addNodeOperator(`Node Operator #${i}`, ADDRESS_1, { from: voting })
      }
      assertBn(await app.getNodeOperatorsCount(), maxNodeOperatorsCount)

      await assertRevert(app.addNodeOperator(`exceeded`, ADDRESS_2, { from: voting }), 'MAX_NODE_OPERATORS_COUNT_EXCEEDED')
    })

    it('creates node operator with correct state', async () => {
      const hasPermission = await acl.hasPermission(voting, app.address, await app.ADD_NODE_OPERATOR_ROLE())
      assert.isTrue(hasPermission)

      const name = `Node Operator #1`
      await app.addNodeOperator(name, ADDRESS_1, { from: voting })

      const expectedNodeOperatorId = 0

      const nodeOperator = await app.getNodeOperator(expectedNodeOperatorId, true)

      assert.isTrue(nodeOperator.active)
      assert.equal(nodeOperator.name, name)
      assert.equal(nodeOperator.rewardAddress, ADDRESS_1)
      assert.equal(nodeOperator.stakingLimit, 0)
      assert.equal(nodeOperator.stoppedValidators, 0)
      assert.equal(nodeOperator.totalSigningKeys, 0)
      assert.equal(nodeOperator.usedSigningKeys, 0)
    })

    it('returns correct node operator id', async () => {
      const hasPermission = await acl.hasPermission(voting, app.address, await app.ADD_NODE_OPERATOR_ROLE())
      assert.isTrue(hasPermission)

      assertBn(await app.getNodeOperatorsCount(), 0)

      const name = `Node Operator #1`
      let expectedId = await app.methods['addNodeOperator(string,address)'].call(name, ADDRESS_1, { from: voting })

      assertBn(expectedId, 0)

      // create node operator to check that next id is correct
      await app.addNodeOperator(name, ADDRESS_1, { from: voting })

      expectedId = await app.methods['addNodeOperator(string,address)'].call(name, ADDRESS_1, { from: voting })
      assertBn(expectedId, 1)
    })

    it('active & total operators count update correctly', async () => {
      const hasPermission = await acl.hasPermission(voting, app.address, await app.ADD_NODE_OPERATOR_ROLE())
      assert.isTrue(hasPermission)

      assertBn(await app.getNodeOperatorsCount(), 0)
      assertBn(await app.getActiveNodeOperatorsCount(), 0)

      await app.addNodeOperator(`Node Operator 1`, ADDRESS_1, { from: voting })

      assertBn(await app.getNodeOperatorsCount(), 1)
      assertBn(await app.getActiveNodeOperatorsCount(), 1)
    })

    it('emits NodeOperatorAdded event with correct params', async () => {
      const hasPermission = await acl.hasPermission(voting, app.address, await app.ADD_NODE_OPERATOR_ROLE())
      assert.isTrue(hasPermission)

      assertBn(await app.getNodeOperatorsCount(), 0)

      const name = `Node Operator 1`

      const tx = await app.addNodeOperator(name, ADDRESS_1, { from: voting })

      assertEvent(tx.receipt, 'NodeOperatorAdded', {
        expectedArgs: { id: 0, name, rewardAddress: ADDRESS_1, stakingLimit: 0 },
        decodeForAbi: NodeOperatorsRegistry._json.abi
      })
    })
  })

  describe('activateNodeOperator()', () => {
    it('reverts when called with non existed node operator id', async () => {})
    it('reverts when called by sender without ACTIVATE_NODE_OPERATOR_ROLE', async () => {})
    it('reverts when called on active node operator', async () => {})
    it('increases validatorsKeysNonce', async () => {})
    it('activates node operator when it is deactivated', async () => {})
    it('increments active node operators count', async () => {})
    it('emits NodeOperatorActivated event with correct params', async () => {})
  })

  it('addNodeOperator works', async () => {
    await assertRevert(app.addNodeOperator('1', ADDRESS_1, { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.addNodeOperator('1', ADDRESS_1, { from: nobody }), 'APP_AUTH_FAILED')

    await assertRevert(app.addNodeOperator('1', ZERO_ADDRESS, { from: voting }), 'ZERO_ADDRESS')

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

  context('setNodeOperatorActive()', () => {
    before(async () => {
      await nodeOperators.addNodeOperator(
        app,
        { name: 'fo o', rewardAddress: ADDRESS_1, totalSigningKeys: 10, usedSigningKeys: 5, stoppedValidators: 1, stakingLimit: 6 },
        { from: voting }
      )
      await nodeOperators.addNodeOperator(
        app,
        { name: ' bar', rewardAddress: ADDRESS_2, totalSigningKeys: 15, usedSigningKeys: 7, stoppedValidators: 0, stakingLimit: 10 },
        { from: voting }
      )
      await nodeOperators.addNodeOperator(
        app,
        {
          name: 'deactivated',
          isActive: false,
          rewardAddress: ADDRESS_3,
          totalSigningKeys: 10,
          usedSigningKeys: 0,
          stoppedValidators: 0,
          stakingLimit: 5
        },
        { from: voting }
      )

      assertBn(await app.getActiveKeysCount(), 11)
      assertBn(await app.getAvailableKeysCount(), 4)
      // make new snapshot to return to this state after each test
      await snapshot.add()
    })

    after(async () => {
      // return to initial snapshot after all tests finished
      await snapshot.revert(-2)
      await snapshot.add()
    })

    it('reverts with APP_AUTH_FAILED error when called by address without SET_NODE_OPERATOR_ACTIVE_ROLE permission', async () => {
      const [hasPermission, nodeOperatorsCount] = await Promise.all([
        await acl.hasPermission(nobody, app.address, await app.SET_NODE_OPERATOR_ACTIVE_ROLE()),
        app.getNodeOperatorsCount()
      ])
      assert.isFalse(hasPermission)
      const nodeOperatorId = nodeOperatorsCount - 1
      await assertRevert(app.setNodeOperatorActive(nodeOperatorId, true, { from: nobody }), 'APP_AUTH_FAILED')
      await assertRevert(app.setNodeOperatorActive(nodeOperatorId, false, { from: nobody }), 'APP_AUTH_FAILED')
    })

    it('reverts when called with non-existent operator id', async () => {
      const [hasPermission, nodeOperatorsCount] = await Promise.all([
        await acl.hasPermission(voting, app.address, await app.SET_NODE_OPERATOR_ACTIVE_ROLE()),
        app.getNodeOperatorsCount()
      ])
      assert.isTrue(hasPermission)
      const nodeOperatorId = nodeOperatorsCount
      await assertRevert(app.setNodeOperatorActive(nodeOperatorId, true, { from: voting }), 'NODE_OPERATOR_NOT_FOUND')
      await assertRevert(app.setNodeOperatorActive(nodeOperatorId, false, { from: voting }), 'NODE_OPERATOR_NOT_FOUND')
    })

    it('reverts with NODE_OPERATOR_ACTIVITY_ALREADY_SET when node operator active state the same', async () => {
      const activeNodeOperatorId = 0
      const notActiveNodeOperatorId = 2

      const activeNodeOperator = await app.getNodeOperator(activeNodeOperatorId, false)
      assert.isTrue(activeNodeOperator.active)

      await assertRevert(app.setNodeOperatorActive(activeNodeOperatorId, true, { from: voting }), 'NODE_OPERATOR_ACTIVITY_ALREADY_SET')

      const notActiveNodeOperator = await app.getNodeOperator(notActiveNodeOperatorId, false)
      assert.isFalse(notActiveNodeOperator.active)
      await assertRevert(app.setNodeOperatorActive(notActiveNodeOperatorId, false, { from: voting }), 'NODE_OPERATOR_ACTIVITY_ALREADY_SET')
    })

    it('increases keysOpIndex', async () => {
      const nodeOperatorId = 0
      const [nodeOperator, keyOpIndexBefore] = await Promise.all([app.getNodeOperator(nodeOperatorId, false), app.getKeysOpIndex()])

      assert.isTrue(nodeOperator.active)

      await app.setNodeOperatorActive(nodeOperatorId, false, { from: voting })
      assertBn(await app.getKeysOpIndex(), keyOpIndexBefore.toNumber() + 1)

      await app.setNodeOperatorActive(nodeOperatorId, true, { from: voting })
      assertBn(await app.getKeysOpIndex(), keyOpIndexBefore.toNumber() + 2)
    })

    it('active == true :: sets active state of node operator to true when it is deactivated', async () => {
      const notActiveNodeOperatorId = 2
      const notActiveNodeOperator = await app.getNodeOperator(notActiveNodeOperatorId, false)

      assert.isFalse(notActiveNodeOperator.active)

      await app.setNodeOperatorActive(notActiveNodeOperatorId, true, { from: voting })

      const nodeOperator = await app.getNodeOperator(notActiveNodeOperatorId, false)
      assert.isTrue(nodeOperator.active)
    })

    it('active == true :: increments active node operators counter', async () => {
      const notActiveNodeOperatorId = 2
      const notActiveNodeOperator = await app.getNodeOperator(notActiveNodeOperatorId, false)

      const activeNodeOperatorsCountBefore = await app.getActiveNodeOperatorsCount()
      assert.isFalse(notActiveNodeOperator.active)
      await app.setNodeOperatorActive(notActiveNodeOperatorId, true, { from: voting })

      const activeNodeOperatorsCountAfter = await app.getActiveNodeOperatorsCount()
      assert.equal(activeNodeOperatorsCountAfter.toNumber(), activeNodeOperatorsCountBefore.toNumber() + 1)
    })

    it('active == false :: sets active state of node operator to false when it is active', async () => {
      const activeNodeOperatorId = 0
      const notActiveNodeOperator = await app.getNodeOperator(activeNodeOperatorId, false)

      assert.isTrue(notActiveNodeOperator.active)

      await app.setNodeOperatorActive(activeNodeOperatorId, false, { from: voting })

      const nodeOperator = await app.getNodeOperator(activeNodeOperatorId, false)
      assert.isFalse(nodeOperator.active)
    })

    it('active == false :: decrements active node operators counter', async () => {
      const activeNodeOperatorId = 0
      const notActiveNodeOperator = await app.getNodeOperator(activeNodeOperatorId, false)

      const activeNodeOperatorsCountBefore = await app.getActiveNodeOperatorsCount()
      assert.isTrue(notActiveNodeOperator.active)
      await app.setNodeOperatorActive(activeNodeOperatorId, false, { from: voting })

      const activeNodeOperatorsCountAfter = await app.getActiveNodeOperatorsCount()
      assert.equal(activeNodeOperatorsCountAfter.toNumber(), activeNodeOperatorsCountBefore.toNumber() - 1)
    })

    it('active == false :: trims unused keys', async () => {
      const nodeOperatorId = 1

      const [nodeOperator, nodeOperatorAvailableKeysCountBefore] = await Promise.all([
        app.getNodeOperator(nodeOperatorId, false),
        app.getNodeOperatorAvailableKeysCount(nodeOperatorId)
      ])

      assert.isTrue(nodeOperator.active, 'Invariant Failed: not active')
      const tx = await app.setNodeOperatorActive(nodeOperatorId, false, { from: voting })

      assertEvent(tx, 'NodeOperatorTotalKeysTrimmed', { id: nodeOperatorId, totalKeysTrimmed: nodeOperatorAvailableKeysCountBefore })
    })

    it('active == false :: updates availableKeysCount correctly', async () => {
      const nodeOperatorId = 1

      const [nodeOperator, availableKeysBefore, nodeOperatorAvailableKeysCountBefore] = await Promise.all([
        app.getNodeOperator(nodeOperatorId, false),
        app.getAvailableKeysCount(),
        app.getNodeOperatorAvailableKeysCount(nodeOperatorId)
      ])

      assert.isTrue(nodeOperator.active, 'Invariant Failed: not active')
      await app.setNodeOperatorActive(nodeOperatorId, false, { from: voting })

      const [availableKeysAfter, nodeOperatorAvailableKeysCountAfter] = await Promise.all([
        app.getAvailableKeysCount(),
        app.getNodeOperatorAvailableKeysCount(nodeOperatorId)
      ])

      assertBn(nodeOperatorAvailableKeysCountAfter, 0) // available keys of node operator becomes 0
      assertBn(availableKeysBefore.sub(nodeOperatorAvailableKeysCountBefore), availableKeysAfter) // all available keys of operator are excluded
    })

    it("active == false :: doesn't modify active keys count", async () => {
      const nodeOperatorId = 1

      const [nodeOperator, activeKeysBefore, nodeOperatorActiveKeysCountBefore] = await Promise.all([
        app.getNodeOperator(nodeOperatorId, false),
        app.getActiveKeysCount(),
        app.getNodeOperatorActiveKeysCount(nodeOperatorId)
      ])

      assert.isTrue(nodeOperator.active, 'Invariant Failed: not active')
      await app.setNodeOperatorActive(nodeOperatorId, false, { from: voting })

      const [activeKeysAfter, nodeOperatorActiveKeysCountAfter] = await Promise.all([
        app.getActiveKeysCount(),
        app.getNodeOperatorActiveKeysCount(nodeOperatorId)
      ])

      assertBn(activeKeysBefore, activeKeysAfter)
      assertBn(nodeOperatorActiveKeysCountBefore, nodeOperatorActiveKeysCountAfter)
    })

    it('emits NodeOperatorActiveSet event when active state was changed', async () => {
      for (const activeState of [true, false]) {
        const nodeOperatorId = await nodeOperators.findNodeOperatorId(app, (operator) => operator.active === activeState)
        assert.notEqual(nodeOperatorId, -1, `Invariant: node operator with active state == ${activeState} not found`)
        const tx = await app.setNodeOperatorActive(nodeOperatorId, !activeState, { from: voting })
        assertEvent(tx, 'NodeOperatorActiveSet', { id: nodeOperatorId, active: !activeState })
      }
    })

    it("doesn't change node operators count", async () => {
      for (const activeState of [true, false]) {
        const nodeOperatorsBefore = await nodeOperators.getAllNodeOperators(app)
        const nodeOperatorId = nodeOperatorsBefore.findIndex((operator) => operator.active === activeState)
        assert.notEqual(nodeOperatorId, -1, `Invariant: node operator with active state == ${activeState} not found`)

        await app.setNodeOperatorActive(nodeOperatorId, !activeState, { from: voting })

        const nodeOperatorsAfter = await nodeOperators.getAllNodeOperators(app)

        assert.equal(nodeOperatorsBefore.length, nodeOperatorsAfter.length)
      }
    })

    it("doesn't change other node operators active state", async () => {
      for (const activeState of [true, false]) {
        const nodeOperatorsBefore = await nodeOperators.getAllNodeOperators(app)
        const nodeOperatorId = nodeOperatorsBefore.findIndex((operator) => operator.active === activeState)
        assert.notEqual(nodeOperatorId, -1, `Invariant: node operator with active state == ${activeState} not found`)

        await app.setNodeOperatorActive(nodeOperatorId, !activeState, { from: voting })

        const nodeOperatorsAfter = await nodeOperators.getAllNodeOperators(app)

        for (let i = 0; i < nodeOperatorsAfter.length; ++i) {
          if (nodeOperatorId === i) {
            assert.equal(nodeOperatorsBefore[i].active, !nodeOperatorsAfter[i].active)
          } else {
            assert.equal(nodeOperatorsBefore[i].active, nodeOperatorsAfter[i].active)
          }
        }
      }
    })
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

  describe('setNodeOperatorStakingLimit()', async () => {
    beforeEach(async () => {
      await nodeOperators.addNodeOperator(
        app,
        {
          name: 'fo o',
          rewardAddress: ADDRESS_1,
          totalSigningKeysCount: 100,
          vettedSigningKeysCount: 50,
          depositedSigningKeysCount: 20
        },
        { from: voting }
      )
      await nodeOperators.addNodeOperator(
        app,
        {
          name: ' bar',
          rewardAddress: ADDRESS_1,
          totalSigningKeysCount: 50,
          vettedSigningKeysCount: 45,
          depositedSigningKeysCount: 30
        },
        { from: voting }
      )
    })

    it('reverts when called by sender SET_NODE_OPERATOR_LIMIT_ROLE', async () => {
      const hasPermission = await acl.hasPermission(nobody, app.address, await app.SET_NODE_OPERATOR_ACTIVE_ROLE())
      assert.isFalse(hasPermission)
      await assertRevert(app.setNodeOperatorStakingLimit(0, 40, { from: nobody }), 'APP_AUTH_FAILED')
    })

    it('reverts when called on non existed validator', async () => {
      const hasPermission = await acl.hasPermission(voting, app.address, await app.SET_NODE_OPERATOR_ACTIVE_ROLE())
      assert.isTrue(hasPermission)
      await assertRevert(app.setNodeOperatorStakingLimit(10, 40, { from: voting }), 'NODE_OPERATOR_NOT_FOUND')
    })

    it('reverts when node operator deactivated', async () => {
      const nodeOperatorId = 1
      const hasPermission = await acl.hasPermission(voting, app.address, await app.SET_NODE_OPERATOR_ACTIVE_ROLE())
      assert.isTrue(hasPermission)
      await app.deactivateNodeOperator(nodeOperatorId)
      assert.isFalse(await app.getNodeOperatorIsActive(nodeOperatorId))
      await assertRevert(app.setNodeOperatorStakingLimit(nodeOperatorId, 40, { from: voting }), 'NODE_OPERATOR_DEACTIVATED')
    })

    it('newStakingLimit < depositedSigningKeys :: sets staking limit to deposited signing keys count', async () => {
      const nodeOperatorId = 0
      await app.setNodeOperatorStakingLimit(nodeOperatorId, 10, { from: voting })
      const nodeOperator = await app.getNodeOperator(nodeOperatorId, false)
      assertBn(nodeOperator.stakingLimit, 20)
    })

    it('newStakingLimit > totalSigningKeysCount :: sets staking limit to total signing keys count', async () => {
      const nodeOperatorId = 1
      await app.setNodeOperatorStakingLimit(nodeOperatorId, 1000, { from: voting })
      const nodeOperator = await app.getNodeOperator(nodeOperatorId, false)
      assertBn(nodeOperator.stakingLimit, 50)
    })

    it('depositedSigningKeys < newStakingLimit < totalSigningKeysCount :: sets staking limit to passed value', async () => {
      const nodeOperatorId = 0
      await app.setNodeOperatorStakingLimit(nodeOperatorId, 75, { from: voting })
      const nodeOperator = await app.getNodeOperator(nodeOperatorId, false)
      assertBn(nodeOperator.stakingLimit, 75)
    })
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

    await app.setNodeOperatorStakingLimit(0, 10, { from: voting })
    await app.setNodeOperatorStakingLimit(1, 10, { from: voting })

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

    await app.setNodeOperatorStakingLimit(0, 10, { from: voting })
    await app.setNodeOperatorStakingLimit(1, 10, { from: voting })

    let result = await pool.assignNextSigningKeys(2)

    let keysAssignedEvt = getEventAt(result, 'KeysAssigned').args

    assert.sameMembers(hexSplit(keysAssignedEvt.pubkeys, PUBKEY_LENGTH_BYTES), [op0.keys[0], op1.keys[0]], 'assignment 1: pubkeys')
    assert.sameMembers(hexSplit(keysAssignedEvt.signatures, SIGNATURE_LENGTH_BYTES), [op0.sigs[0], op1.sigs[0]], 'assignment 1: signatures')

    await app.deactivateNodeOperator(0, { from: voting })
    await assertRevert(app.deactivateNodeOperator(0, { from: voting }), 'NODE_OPERATOR_ALREADY_DEACTIVATED')
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

    await app.setNodeOperatorStakingLimit(0, 4, { from: voting })
    await app.setNodeOperatorStakingLimit(1, 1, { from: voting })

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

  it('updateExitedValidatorsKeysCount works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, { from: voting })

    await app.addSigningKeys(0, 2, hexConcat(pad('0x010101', 48), pad('0x020202', 48)), hexConcat(pad('0x01', 96), pad('0x02', 96)), {
      from: voting
    })
    await app.addSigningKeys(1, 2, hexConcat(pad('0x050505', 48), pad('0x060606', 48)), hexConcat(pad('0x04', 96), pad('0x03', 96)), {
      from: voting
    })

    await app.setNodeOperatorStakingLimit(0, 10, { from: voting })
    await app.setNodeOperatorStakingLimit(1, 10, { from: voting })

    await pool.assignNextSigningKeys(3)
    assertBn((await app.getNodeOperator(0, false)).usedSigningKeys, 2, 'op 0 used keys')
    assertBn((await app.getNodeOperator(1, false)).usedSigningKeys, 1, 'op 1 used keys')

    await assertRevert(app.updateExitedValidatorsKeysCount(0, 1, { from: user1 }), 'APP_AUTH_FAILED')
    await assertRevert(app.updateExitedValidatorsKeysCount(1, 1, { from: nobody }), 'APP_AUTH_FAILED')

    assertBn((await app.getNodeOperator(0, false)).stoppedValidators, 0, 'before stop: op 0 stopped validators')
    assertBn((await app.getNodeOperator(1, false)).stoppedValidators, 0, 'before stop: op 1 stopped validators')

    await app.updateExitedValidatorsKeysCount(1, 1, { from: voting })

    assertBn((await app.getNodeOperator(0, false)).stoppedValidators, 0, 'after stop 1: op 0 stopped validators')
    assertBn((await app.getNodeOperator(1, false)).stoppedValidators, 1, 'after stop 1: op 1 stopped validators')

    await app.updateExitedValidatorsKeysCount(0, 1, { from: voting })

    assertBn((await app.getNodeOperator(0, false)).stoppedValidators, 1, 'after stop 2: op 0 stopped validators')
    assertBn((await app.getNodeOperator(1, false)).stoppedValidators, 1, 'after stop 2: op 1 stopped validators')

    await app.updateExitedValidatorsKeysCount(0, 2, { from: voting })

    assertBn((await app.getNodeOperator(0, false)).stoppedValidators, 2, 'after stop 3: op 0 stopped validators')
    assertBn((await app.getNodeOperator(1, false)).stoppedValidators, 1, 'after stop 3: op 1 stopped validators')

    await assertRevert(app.updateExitedValidatorsKeysCount(0, 3, { from: voting }), 'INVALID_EXITED_VALIDATORS_COUNT')
    await assertRevert(app.updateExitedValidatorsKeysCount(0, 0, { from: voting }), 'EXITED_VALIDATORS_COUNT_DECREASED')
    await assertRevert(app.updateExitedValidatorsKeysCount(1, 12, { from: voting }), 'INVALID_EXITED_VALIDATORS_COUNT')

    await assertRevert(app.updateExitedValidatorsKeysCount(10, 1, { from: voting }), 'NODE_OPERATOR_NOT_FOUND')
  })

  it('reportStoppedValidators decreases stake', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, { from: voting })

    await app.addSigningKeys(0, 2, hexConcat(pad('0x010101', 48), pad('0x020202', 48)), hexConcat(pad('0x01', 96), pad('0x02', 96)), {
      from: voting
    })
    await app.addSigningKeys(1, 2, hexConcat(pad('0x050505', 48), pad('0x060606', 48)), hexConcat(pad('0x04', 96), pad('0x03', 96)), {
      from: voting
    })

    await app.setNodeOperatorStakingLimit(0, 10, { from: voting })
    await app.setNodeOperatorStakingLimit(1, 10, { from: voting })

    await pool.assignNextSigningKeys(1)
    assertBn((await app.getNodeOperator(0, false)).usedSigningKeys, 1, 'before the report: op 0 used keys')
    assertBn((await app.getNodeOperator(1, false)).usedSigningKeys, 0, 'before the report: op 1 used keys')

    await app.updateExitedValidatorsKeysCount(0, 1, { from: voting })
    assertBn((await app.getNodeOperator(0, false)).stoppedValidators, 1, 'op 0 stopped validators')

    await pool.assignNextSigningKeys(1)
    assertBn((await app.getNodeOperator(0, false)).usedSigningKeys, 2, 'after the report: op 0 used keys')
    assertBn((await app.getNodeOperator(1, false)).usedSigningKeys, 0, 'after the report: op 1 used keys')
  })

  it('trimUnusedKeys works', async () => {
    await app.addNodeOperator('fo o', ADDRESS_1, { from: voting })
    await app.addNodeOperator(' bar', ADDRESS_2, { from: voting })

    await app.addSigningKeys(0, 2, hexConcat(pad('0x010101', 48), pad('0x020202', 48)), hexConcat(pad('0x01', 96), pad('0x02', 96)), {
      from: voting
    })
    await app.addSigningKeys(1, 2, hexConcat(pad('0x050505', 48), pad('0x060606', 48)), hexConcat(pad('0x04', 96), pad('0x03', 96)), {
      from: voting
    })

    await app.setNodeOperatorStakingLimit(0, 10, { from: voting })
    await app.setNodeOperatorStakingLimit(1, 10, { from: voting })

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
    await assertRevert(app.addKeysByNodeOperator(0, 1, pad('0x01', 48), pad('0x01', 96), { from: nobody }), 'APP_AUTH_FAILED')
    await app.addKeysByNodeOperator(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: user1 })

    // add to the second operator
    await assertRevert(app.addKeysByNodeOperator(1, 1, pad('0x070707', 48), pad('0x01', 96), { from: nobody }), 'APP_AUTH_FAILED')
    await assertRevert(app.addKeysByNodeOperator(1, 1, pad('0x070707', 48), pad('0x01', 96), { from: user1 }), 'APP_AUTH_FAILED')

    await app.addKeysByNodeOperator(1, 1, pad('0x070707', 48), pad('0x01', 96), { from: user2 })
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

  context('keysOpIndex increases correctly', () => {
    let initialKeysOpIndex

    before('set initial keys op index', async () => {
      initialKeysOpIndex = await app.getKeysOpIndex().then((v) => v.toNumber())
    })

    it('must increases on setNodeOperatorStakingLimit', async () => {
      await app.addNodeOperator('1', user1, { from: voting })
      assertBn(await app.getKeysOpIndex(), initialKeysOpIndex)
      const tx = await app.setNodeOperatorStakingLimit(0, 40, { from: voting })
      assertEvent(tx, 'KeysOpIndexSet', {
        expectedArgs: { keysOpIndex: initialKeysOpIndex + 1 },
        decodeForAbi: NodeOperatorsRegistry._json.abi
      })
      assertBn(await app.getKeysOpIndex(), initialKeysOpIndex + 1)
    })
    it('must increases on addSigningKeys', async () => {
      await app.addNodeOperator('1', user1, { from: voting })
      assertBn(await app.getKeysOpIndex(), initialKeysOpIndex)
      const tx = await app.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
      assertEvent(tx, 'KeysOpIndexSet', { expectedArgs: { keysOpIndex: initialKeysOpIndex + 1 } })
      assertBn(await app.getKeysOpIndex(), initialKeysOpIndex + 1)
    })
    it('must increases on addSigningKeysOperatorBH', async () => {
      await app.addNodeOperator('1', user1, { from: voting })
      assertBn(await app.getKeysOpIndex(), initialKeysOpIndex)
      const tx = await app.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: user1 })
      assertEvent(tx, 'KeysOpIndexSet', { expectedArgs: { keysOpIndex: initialKeysOpIndex + 1 } })
      assertBn(await app.getKeysOpIndex(), initialKeysOpIndex + 1)
    })
    it('must increases on removeSigningKey', async () => {
      await app.addNodeOperator('1', user1, { from: voting })
      assertBn(await app.getKeysOpIndex(), initialKeysOpIndex)
      await app.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
      assertBn(await app.getKeysOpIndex(), initialKeysOpIndex + 1)
      const tx = await app.removeSigningKey(0, 0, { from: voting })
      assertEvent(tx, 'KeysOpIndexSet', { expectedArgs: { keysOpIndex: initialKeysOpIndex + 2 } })
      assertBn(await app.getKeysOpIndex(), initialKeysOpIndex + 2)
    })
    it('must increases on removeSigningKeyOperatorBH', async () => {
      await app.addNodeOperator('1', user1, { from: voting })
      assertBn(await app.getKeysOpIndex(), initialKeysOpIndex)
      await app.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
      assertBn(await app.getKeysOpIndex(), initialKeysOpIndex + 1)
      const tx = await app.removeSigningKeyOperatorBH(0, 0, { from: user1 })
      assertEvent(tx, 'KeysOpIndexSet', { expectedArgs: { keysOpIndex: initialKeysOpIndex + 2 } })
      assertBn(await app.getKeysOpIndex(), initialKeysOpIndex + 2)
    })
    it('must increases on setNodeOperatorActive', async () => {
      await app.addNodeOperator('1', user1, { from: voting })
      assertBn(await app.getKeysOpIndex(), initialKeysOpIndex)
      const tx = await app.setNodeOperatorActive(0, false, { from: voting })
      assertEvent(tx, 'KeysOpIndexSet', { expectedArgs: { keysOpIndex: initialKeysOpIndex + 1 } })
      assertBn(await app.getKeysOpIndex(), initialKeysOpIndex + 1)
    })
  })
  context('finalized upgrade', () => {
    it('calculate current keys', async () => {
      await app.addNodeOperator('0', user1, { from: voting })
      await app.addNodeOperator('1', user2, { from: voting })
      await app.addNodeOperator('2', user3, { from: voting })

      await app.setOperatorUsedKeys(0, 3)
      await app.setOperatorStoppedKeys(0, 2)
      await app.setOperatorTotalKeys(0, 5)
      await app.setNodeOperatorStakingLimit(0, 5, { from: voting })

      await app.setOperatorUsedKeys(1, 7)
      await app.setOperatorStoppedKeys(1, 1)
      await app.setOperatorTotalKeys(1, 8)
      await app.setNodeOperatorStakingLimit(1, 5, { from: voting })

      await app.setOperatorUsedKeys(2, 10)
      await app.setOperatorStoppedKeys(2, 10)
      await app.setOperatorTotalKeys(2, 20)
      await app.setNodeOperatorStakingLimit(2, 13, { from: voting })

      await app.finalizeUpgrade_v2(steth.address, CURATED_TYPE)

      assertBn(await app.getActiveKeysCount(), 7)
      assertBn(await app.getAvailableKeysCount(), 5)

      const { activeKeysCount, availableKeysCount } = await app.getKeysUsageData()
      assertBn(activeKeysCount, 7)
      assertBn(availableKeysCount, 5)
    })
  })
  context('distribute rewards', () => {
    it('must distribute rewards to operators', async () => {
      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, ETH(10))

      await app.addNodeOperator('0', user1, { from: voting })
      await app.addNodeOperator('1', user2, { from: voting })
      await app.addNodeOperator('2', user3, { from: voting })

      await app.setOperatorUsedKeys(0, 3)
      await app.setOperatorUsedKeys(1, 7)
      await app.setOperatorUsedKeys(2, 0)
      await app.setActiveKeysCount(10)

      await app.distributeRewards({ from: user3 })

      assertBn(await steth.sharesOf(user1), ETH(3))
      assertBn(await steth.sharesOf(user2), ETH(7))
      assertBn(await steth.sharesOf(user3), 0)
    })
  })
  context('getSignedKeys', () => {
    it('reverts with NODE_OPERATOR_NOT_FOUND', async () => {
      await assertRevert(app.getSigningKeys(0, 0, 10), 'NODE_OPERATOR_NOT_FOUND')
    })

    it('reverts with OUT_OF_RANGE', async () => {
      await app.addNodeOperator('0', user1, { from: voting })

      await assertRevert(app.getSigningKeys(0, 0, 10), 'OUT_OF_RANGE')
    })

    it('returns specified signed keys', async () => {
      await app.addNodeOperator('0', user1, { from: voting })

      const keys = [pad('0xaa0101', 48), pad('0xaa0202', 48), pad('0xaa0303', 48)]
      const sigs = [pad('0xa1', 96), pad('0xa2', 96), pad('0xa3', 96)]

      await app.addSigningKeys(0, 3, hexConcat(...keys), hexConcat(...sigs), { from: voting })

      const { pubkeys, signatures, used } = await app.getSigningKeys(0, 1, 2)

      assert.equal(pubkeys, keys[1] + keys[2].slice(2))
      assert.equal(signatures, sigs[1] + sigs[2].slice(2))
      assert.sameMembers(used, [false, false])
    })
  })
})
