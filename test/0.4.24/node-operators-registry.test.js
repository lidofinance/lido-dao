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
const INodeOperatorsRegistry = artifacts.require('INodeOperatorsRegistry.sol')

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
    await acl.createPermission(voting, app.address, await app.ACTIVATE_NODE_OPERATOR_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.DEACTIVATE_NODE_OPERATOR_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_NODE_OPERATOR_NAME_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_NODE_OPERATOR_ADDRESS_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_NODE_OPERATOR_LIMIT_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.UPDATE_EXITED_VALIDATORS_KEYS_COUNT_ROLE(), appManager, {
      from: appManager
    })

    await acl.createPermission(pool.address, app.address, await app.REQUEST_VALIDATORS_KEYS_FOR_DEPOSITS_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(pool.address, app.address, await app.INVALIDATE_READY_TO_DEPOSIT_KEYS_ROLE(), appManager, {
      from: appManager
    })

    // Initialize the app's proxy.
    const tx = await app.initialize(steth.address, CURATED_TYPE)

    // Implementation initializer reverts because initialization block was set to max(uint256)
    // in the Autopetrified base contract
    await assertRevert(appBase.initialize(steth.address, CURATED_TYPE), 'INIT_ALREADY_INITIALIZED')

    const moduleType = await app.getType()
    assertEvent(tx, 'ContractVersionSet', { expectedArgs: { version: 2 } })
    assertEvent(tx, 'StethContractSet', { expectedArgs: { stethAddress: steth.address } })
    assertEvent(tx, 'StakingModuleTypeSet', { expectedArgs: { moduleType } })

    await snapshot.add()
  })

  afterEach(async () => {
    await snapshot.revert()
    await snapshot.add()
  })

  describe('finalizeUpgrade_v2()', () => {
    before(async () => {
      // reset version there to test upgrade finalization
      await app.testing_setBaseVersion(0)
      await snapshot.add()
    })

    after(async () => {
      // return to initial snapshot after all tests finished
      await snapshot.revert(-2)
      await snapshot.add()
    })

    it('fails with PETRIFIED error when called on implementation', async () => {
      await assertRevert(appBase.finalizeUpgrade_v2(pool.address, CURATED_TYPE), 'PETRIFIED')
    })

    it('sets correct contract version', async () => {
      await app.finalizeUpgrade_v2(pool.address, CURATED_TYPE)
      assertBn(await app.getVersion(), 2)
    })

    it('reverts with error STETH_ADDRESS_ZERO when stETH address is zero address', async () => {
      await assertRevert(app.finalizeUpgrade_v2(ZERO_ADDRESS, CURATED_TYPE), 'STETH_ADDRESS_ZERO')
    })

    it('reverts with error WRONG_BASE_VERSION when called on already initialized contract', async () => {
      await app.finalizeUpgrade_v2(pool.address, CURATED_TYPE)
      assertBn(await app.getVersion(), 2)
      assertRevert(app.finalizeUpgrade_v2(pool.address, CURATED_TYPE), 'WRONG_BASE_VERSION')
    })

    it('sets total signing keys stats correctly', async () => {
      const nodeOperatorConfigs = [
        {
          name: 'test',
          rewardAddress: ADDRESS_1,
          totalSigningKeysCount: 13,
          vettedSigningKeysCount: 11,
          depositedSigningKeysCount: 7,
          exitedSigningKeysCount: 5
        },
        {
          name: 'test',
          rewardAddress: ADDRESS_1,
          totalSigningKeysCount: 4,
          vettedSigningKeysCount: 3,
          depositedSigningKeysCount: 2,
          exitedSigningKeysCount: 1
        }
      ]
      for (const config of nodeOperatorConfigs) {
        await app.testing_addNodeOperator(
          config.name,
          config.rewardAddress,
          config.totalSigningKeysCount,
          config.vettedSigningKeysCount,
          config.depositedSigningKeysCount,
          config.exitedSigningKeysCount
        )
      }

      await app.testing_resetTotalSigningKeysStats()

      for (let i = 0; i < nodeOperatorConfigs.length; ++i) {
        const nodeOperator = await app.getNodeOperator(i, false)
        assert.equal(nodeOperator.totalSigningKeys.toNumber(), nodeOperatorConfigs[i].totalSigningKeysCount)
        assert.equal(nodeOperator.stakingLimit.toNumber(), nodeOperatorConfigs[i].vettedSigningKeysCount)
        assert.equal(nodeOperator.usedSigningKeys.toNumber(), nodeOperatorConfigs[i].depositedSigningKeysCount)
        assert.equal(nodeOperator.stoppedValidators.toNumber(), nodeOperatorConfigs[i].exitedSigningKeysCount)
      }

      await app.finalizeUpgrade_v2(pool.address, CURATED_TYPE)

      const totalSigningKeysStatsAfter = await app.testing_getTotalSigningKeysStats()

      const totalSigningKeysCount = nodeOperatorConfigs.reduce((sum, c) => sum + c.totalSigningKeysCount, 0)
      const vettedSigningKeysCount = nodeOperatorConfigs.reduce((sum, c) => sum + c.vettedSigningKeysCount, 0)
      const depositedSigningKeysCount = nodeOperatorConfigs.reduce((sum, c) => sum + c.depositedSigningKeysCount, 0)
      const exitedSigningKeysCount = nodeOperatorConfigs.reduce((sum, c) => sum + c.exitedSigningKeysCount, 0)

      assert.equal(totalSigningKeysStatsAfter.totalSigningKeysCount.toNumber(), totalSigningKeysCount)
      assert.equal(totalSigningKeysStatsAfter.vettedSigningKeysCount.toNumber(), vettedSigningKeysCount)
      assert.equal(totalSigningKeysStatsAfter.depositedSigningKeysCount.toNumber(), depositedSigningKeysCount)
      assert.equal(totalSigningKeysStatsAfter.exitedSigningKeysCount.toNumber(), exitedSigningKeysCount)
    })

    it("trims vettedSigningKeys if it's greater than totalSigningKeys", async () => {
      const config = {
        name: 'test',
        rewardAddress: ADDRESS_1,
        totalSigningKeysCount: 13,
        vettedSigningKeysCount: 17,
        depositedSigningKeysCount: 7,
        exitedSigningKeysCount: 5
      }
      await app.testing_addNodeOperator(
        config.name,
        config.rewardAddress,
        config.totalSigningKeysCount,
        config.vettedSigningKeysCount,
        config.depositedSigningKeysCount,
        config.exitedSigningKeysCount
      )

      let nodeOperator = await app.getNodeOperator(0, false)
      assert.equal(nodeOperator.stakingLimit.toNumber(), config.vettedSigningKeysCount)
      assert.equal(nodeOperator.totalSigningKeys.toNumber(), config.totalSigningKeysCount)

      await app.finalizeUpgrade_v2(pool.address, CURATED_TYPE)

      nodeOperator = await app.getNodeOperator(0, false)
      assert.equal(nodeOperator.stakingLimit.toNumber(), config.totalSigningKeysCount)
      assert.equal(nodeOperator.totalSigningKeys.toNumber(), config.totalSigningKeysCount)
    })

    it("trims vettedSigningKeys if it's greater than depositedSigningKeysCount", async () => {
      const config = {
        name: 'test',
        rewardAddress: ADDRESS_1,
        totalSigningKeysCount: 13,
        vettedSigningKeysCount: 4,
        depositedSigningKeysCount: 7,
        exitedSigningKeysCount: 5
      }

      await app.testing_addNodeOperator(
        config.name,
        config.rewardAddress,
        config.totalSigningKeysCount,
        config.vettedSigningKeysCount,
        config.depositedSigningKeysCount,
        config.exitedSigningKeysCount
      )

      let nodeOperator = await app.getNodeOperator(0, false)
      assert.equal(nodeOperator.stakingLimit.toNumber(), config.vettedSigningKeysCount)
      assert.equal(nodeOperator.totalSigningKeys.toNumber(), config.totalSigningKeysCount)

      await app.finalizeUpgrade_v2(pool.address, CURATED_TYPE)

      nodeOperator = await app.getNodeOperator(0, false)

      assert.equal(nodeOperator.stakingLimit.toNumber(), config.depositedSigningKeysCount)
      assert.equal(nodeOperator.totalSigningKeys.toNumber(), config.totalSigningKeysCount)
    })

    it('emits ContractVersionSet event with correct params', async () => {
      const receipt = await app.finalizeUpgrade_v2(pool.address, CURATED_TYPE)
      assertEvent(receipt, 'ContractVersionSet', { expectedArgs: { version: 2 } })
    })

    it('emits StethContractSet event with correct params', async () => {
      const receipt = await app.finalizeUpgrade_v2(pool.address, CURATED_TYPE)
      assertEvent(receipt, 'StethContractSet', { expectedArgs: { stethAddress: pool.address } })
    })

    it('emits StakingModuleTypeSet event with correct params', async () => {
      const receipt = await app.finalizeUpgrade_v2(pool.address, CURATED_TYPE)
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

    it('emits NodeOperatorAdded events with correct params', async () => {
      const hasPermission = await acl.hasPermission(voting, app.address, await app.ADD_NODE_OPERATOR_ROLE())
      assert.isTrue(hasPermission)

      assertBn(await app.getNodeOperatorsCount(), 0)

      const name = `Node Operator 1`

      const tx = await app.addNodeOperator(name, ADDRESS_1, { from: voting })

      assertEvent(tx.receipt, 'NodeOperatorAdded', {
        expectedArgs: { id: 0, name, rewardAddress: ADDRESS_1, stakingLimit: 0 },
        decodeForAbi: INodeOperatorsRegistry._json.abi
      })
    })
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

  context('activateNodeOperator()', () => {
    before(async () => {
      await nodeOperators.addNodeOperator(
        app,
        {
          name: 'fo o',
          rewardAddress: ADDRESS_1,
          totalSigningKeysCount: 10,
          depositedSigningKeysCount: 5,
          exitedSigningKeysCount: 1,
          vettedSigningKeysCount: 6
        },
        { from: voting }
      )
      await nodeOperators.addNodeOperator(
        app,
        {
          name: ' bar',
          rewardAddress: ADDRESS_2,
          totalSigningKeysCount: 15,
          depositedSigningKeysCount: 7,
          exitedSigningKeysCount: 0,
          vettedSigningKeysCount: 10
        },
        { from: voting }
      )
      await nodeOperators.addNodeOperator(
        app,
        {
          name: 'deactivated',
          isActive: false,
          rewardAddress: ADDRESS_3,
          totalSigningKeysCount: 10,
          depositedSigningKeysCount: 0,
          exitedSigningKeysCount: 0,
          vettedSigningKeysCount: 5
        },
        { from: voting }
      )

      const { exitedValidatorsCount, activeValidatorsKeysCount, readyToDepositValidatorsKeysCount } = await app.getValidatorsKeysStats()
      assertBn(exitedValidatorsCount, 1)
      assertBn(activeValidatorsKeysCount, 11)
      assertBn(readyToDepositValidatorsKeysCount, 4)
      // make new snapshot to return to this state after each test
      await snapshot.add()
    })

    after(async () => {
      // return to initial snapshot after all tests finished
      await snapshot.revert(-2)
      await snapshot.add()
    })

    it('reverts with APP_AUTH_FAILED error when called by address without ACTIVATE_NODE_OPERATOR_ROLE permission', async () => {
      const hasPermission = await acl.hasPermission(nobody, app.address, await app.ACTIVATE_NODE_OPERATOR_ROLE())
      assert.isFalse(hasPermission)
      const nodeOperatorId = 2
      await assertRevert(app.activateNodeOperator(nodeOperatorId, { from: nobody }), 'APP_AUTH_FAILED')
    })

    it('reverts when called with non-existent operator id', async () => {
      const hasPermission = await acl.hasPermission(voting, app.address, await app.ACTIVATE_NODE_OPERATOR_ROLE())
      assert.isTrue(hasPermission)
      const nodeOperatorId = Number.MAX_SAFE_INTEGER
      await assertRevert(app.activateNodeOperator(nodeOperatorId, { from: voting }), 'NODE_OPERATOR_NOT_FOUND')
    })

    it('reverts with NODE_OPERATOR_ALREADY_ACTIVATED when called on active node operator', async () => {
      const activeNodeOperatorId = 0

      const activeNodeOperator = await app.getNodeOperator(activeNodeOperatorId, false)
      assert.isTrue(activeNodeOperator.active)

      await assertRevert(app.activateNodeOperator(activeNodeOperatorId, { from: voting }), 'NODE_OPERATOR_ALREADY_ACTIVATED')
    })

    it('increases keysOpIndex', async () => {
      const nodeOperatorId = 2
      const [nodeOperator, keyOpIndexBefore] = await Promise.all([app.getNodeOperator(nodeOperatorId, false), app.getKeysOpIndex()])

      assert.isFalse(nodeOperator.active)

      await app.activateNodeOperator(nodeOperatorId, { from: voting })
      assertBn(await app.getKeysOpIndex(), keyOpIndexBefore.toNumber() + 1)
    })

    it('sets active state of node operator to true when it is deactivated', async () => {
      const notActiveNodeOperatorId = 2
      const notActiveNodeOperator = await app.getNodeOperator(notActiveNodeOperatorId, false)

      assert.isFalse(notActiveNodeOperator.active)

      await app.activateNodeOperator(notActiveNodeOperatorId, { from: voting })

      const nodeOperator = await app.getNodeOperator(notActiveNodeOperatorId, false)
      assert.isTrue(nodeOperator.active)
    })

    it('increments active node operators counter', async () => {
      const notActiveNodeOperatorId = 2
      const notActiveNodeOperator = await app.getNodeOperator(notActiveNodeOperatorId, false)

      const activeNodeOperatorsCountBefore = await app.getActiveNodeOperatorsCount()
      assert.isFalse(notActiveNodeOperator.active)
      await app.activateNodeOperator(notActiveNodeOperatorId, { from: voting })

      const activeNodeOperatorsCountAfter = await app.getActiveNodeOperatorsCount()
      assert.equal(activeNodeOperatorsCountAfter.toNumber(), activeNodeOperatorsCountBefore.toNumber() + 1)
    })

    it('emits NodeOperatorActivated event', async () => {
      const nodeOperatorId = await nodeOperators.findNodeOperatorId(app, (operator) => !operator.active)
      assert.notEqual(nodeOperatorId, -1, `Invariant: not active node operator not found`)
      const tx = await app.activateNodeOperator(nodeOperatorId, { from: voting })
      assertEvent(tx, 'NodeOperatorActivated', {
        expectedArgs: { nodeOperatorId: nodeOperatorId },
        decodeForAbi: NodeOperatorsRegistry._json.abi
      })
    })

    it("doesn't change node operators count", async () => {
      const nodeOperatorsBefore = await nodeOperators.getAllNodeOperators(app)
      const nodeOperatorId = nodeOperatorsBefore.findIndex((operator) => !operator.active)
      assert.notEqual(nodeOperatorId, -1, `Invariant: not active node operator not found`)

      await app.activateNodeOperator(nodeOperatorId, { from: voting })

      const nodeOperatorsAfter = await nodeOperators.getAllNodeOperators(app)

      assert.equal(nodeOperatorsBefore.length, nodeOperatorsAfter.length)
    })

    it("doesn't change other node operators active state", async () => {
      const nodeOperatorsBefore = await nodeOperators.getAllNodeOperators(app)
      const nodeOperatorId = nodeOperatorsBefore.findIndex((operator) => !operator.active)
      assert.notEqual(nodeOperatorId, -1, `Invariant: not active node operator not found`)

      await app.activateNodeOperator(nodeOperatorId, { from: voting })

      const nodeOperatorsAfter = await nodeOperators.getAllNodeOperators(app)

      for (let i = 0; i < nodeOperatorsAfter.length; ++i) {
        if (nodeOperatorId === i) {
          assert.equal(nodeOperatorsBefore[i].active, !nodeOperatorsAfter[i].active)
        } else {
          assert.equal(nodeOperatorsBefore[i].active, nodeOperatorsAfter[i].active)
        }
      }
    })
  })

  describe('deactivateNodeOperator()', async () => {
    before(async () => {
      await nodeOperators.addNodeOperator(
        app,
        {
          name: 'fo o',
          rewardAddress: ADDRESS_1,
          totalSigningKeysCount: 10,
          depositedSigningKeysCount: 5,
          exitedSigningKeysCount: 1,
          vettedSigningKeysCount: 6
        },
        { from: voting }
      )
      await nodeOperators.addNodeOperator(
        app,
        {
          name: ' bar',
          rewardAddress: ADDRESS_2,
          totalSigningKeysCount: 15,
          depositedSigningKeysCount: 7,
          exitedSigningKeysCount: 0,
          vettedSigningKeysCount: 10
        },
        { from: voting }
      )
      await nodeOperators.addNodeOperator(
        app,
        {
          name: 'deactivated',
          isActive: false,
          rewardAddress: ADDRESS_3,
          totalSigningKeysCount: 10,
          depositedSigningKeysCount: 0,
          exitedSigningKeysCount: 0,
          vettedSigningKeysCount: 5
        },
        { from: voting }
      )

      const { exitedValidatorsCount, activeValidatorsKeysCount, readyToDepositValidatorsKeysCount } = await app.getValidatorsKeysStats()
      assertBn(exitedValidatorsCount, 1)
      assertBn(activeValidatorsKeysCount, 11)
      assertBn(readyToDepositValidatorsKeysCount, 4)
      // make new snapshot to return to this state after each test
      await snapshot.add()
    })

    after(async () => {
      // return to initial snapshot after all tests finished
      await snapshot.revert(-2)
      await snapshot.add()
    })

    it('reverts with APP_AUTH_FAILED error when called by address without DEACTIVATE_NODE_OPERATOR_ROLE permission', async () => {
      const hasPermission = await acl.hasPermission(nobody, app.address, await app.DEACTIVATE_NODE_OPERATOR_ROLE())
      assert.isFalse(hasPermission)

      const nodeOperatorId = await nodeOperators.findNodeOperatorId(app, (operator) => !operator.active)
      assert.notEqual(nodeOperatorId, -1, `Invariant: not active node operator not found`)

      await assertRevert(app.deactivateNodeOperator(nodeOperatorId, { from: nobody }), 'APP_AUTH_FAILED')
    })

    it('reverts when called with non-existent operator id', async () => {
      const hasPermission = await acl.hasPermission(voting, app.address, await app.ACTIVATE_NODE_OPERATOR_ROLE())
      assert.isTrue(hasPermission)

      const nodeOperatorId = Number.MAX_SAFE_INTEGER

      await assertRevert(app.deactivateNodeOperator(nodeOperatorId, { from: voting }), 'NODE_OPERATOR_NOT_FOUND')
    })

    it('reverts with NODE_OPERATOR_ALREADY_DEACTIVATED when called on not active node operator', async () => {
      const activeNodeOperatorId = await nodeOperators.findNodeOperatorId(app, (operator) => !operator.active)
      assert.notEqual(activeNodeOperatorId, -1, `Invariant: not active node operator not found`)

      const activeNodeOperator = await app.getNodeOperator(activeNodeOperatorId, false)
      assert.isFalse(activeNodeOperator.active)

      await assertRevert(app.deactivateNodeOperator(activeNodeOperatorId, { from: voting }), 'NODE_OPERATOR_ALREADY_DEACTIVATED')
    })

    it('increases keysOpIndex', async () => {
      const activeNodeOperatorId = await nodeOperators.findNodeOperatorId(app, (operator) => operator.active)
      assert.notEqual(activeNodeOperatorId, -1, `Invariant: active node operator not found`)

      const keyOpIndexBefore = await app.getKeysOpIndex()

      await app.deactivateNodeOperator(activeNodeOperatorId, { from: voting })
      assertBn(await app.getKeysOpIndex(), keyOpIndexBefore.toNumber() + 1)
    })

    it('sets active state of node operator to false when it is active', async () => {
      const activeNodeOperatorId = await nodeOperators.findNodeOperatorId(app, (operator) => operator.active)
      assert.notEqual(activeNodeOperatorId, -1, `Invariant: active node operator not found`)

      await app.deactivateNodeOperator(activeNodeOperatorId, { from: voting })

      const nodeOperator = await app.getNodeOperator(activeNodeOperatorId, false)
      assert.isFalse(nodeOperator.active)
    })

    it('decrements active node operators counter', async () => {
      const activeNodeOperatorId = await nodeOperators.findNodeOperatorId(app, (operator) => operator.active)
      assert.notEqual(activeNodeOperatorId, -1, `Invariant: active node operator not found`)

      const activeNodeOperatorsCountBefore = await app.getActiveNodeOperatorsCount()

      await app.deactivateNodeOperator(activeNodeOperatorId, { from: voting })

      const activeNodeOperatorsCountAfter = await app.getActiveNodeOperatorsCount()
      assert.equal(activeNodeOperatorsCountAfter.toNumber(), activeNodeOperatorsCountBefore.toNumber() - 1)
    })

    it('resets vettedSigningKeysCount to depositedSigningKeysCount when vettedSigningKeysCount > depositedSigningKeysCount', async () => {
      const activeNodeOperatorId = await nodeOperators.findNodeOperatorId(app, (operator) => operator.active)
      assert.notEqual(activeNodeOperatorId, -1, `Invariant: active node operator not found`)

      const [
        nodeOperator,
        { readyToDepositValidatorsKeysCount: readyToDepositValidatorsKeysCountBefore },
        { readyToDepositValidatorsKeysCount: totalReadyToDepositValidatorsKeysCountBefore }
      ] = await Promise.all([
        app.getNodeOperator(activeNodeOperatorId, false),
        app.getValidatorsKeysStats(activeNodeOperatorId),
        app.getValidatorsKeysStats()
      ])

      assert.isTrue(nodeOperator.active, 'Invariant Failed: not active')
      assert.isTrue(readyToDepositValidatorsKeysCountBefore.toNumber() > 0, 'Invariant Failed: vettedSigningKeysCount === 0')
      await app.deactivateNodeOperator(activeNodeOperatorId, { from: voting })

      const { readyToDepositValidatorsKeysCount: readyToDepositValidatorsKeysCountAfter } = await app.getValidatorsKeysStats(
        activeNodeOperatorId
      )
      assertBn(readyToDepositValidatorsKeysCountAfter.toNumber(), 0)

      const { readyToDepositValidatorsKeysCount: totalReadyToDepositValidatorsKeysCountAfter } = await app.getValidatorsKeysStats()
      assertBn(
        totalReadyToDepositValidatorsKeysCountAfter.toNumber() - totalReadyToDepositValidatorsKeysCountBefore.toNumber(),
        readyToDepositValidatorsKeysCountAfter.toNumber() - readyToDepositValidatorsKeysCountBefore.toNumber()
      )
    })

    it("doesn't modify deposited keys count", async () => {
      const activeNodeOperatorId = await nodeOperators.findNodeOperatorId(app, (operator) => operator.active)
      assert.notEqual(activeNodeOperatorId, -1, `Invariant: active node operator not found`)

      const [
        nodeOperator,
        { activeValidatorsKeysCount: totalActiveValidatorsKeysCountBefore },
        { activeValidatorsKeysCount: activeValidatorsKeysCountBefore }
      ] = await Promise.all([
        app.getNodeOperator(activeNodeOperatorId, false),
        app.getValidatorsKeysStats(),
        app.getValidatorsKeysStats(activeNodeOperatorId)
      ])

      assert.isTrue(nodeOperator.active, 'Invariant Failed: not active')
      await app.deactivateNodeOperator(activeNodeOperatorId, { from: voting })

      const [
        { activeValidatorsKeysCount: totalActiveValidatorsKeysCountAfter },
        { activeValidatorsKeysCount: activeValidatorsKeysCountAfter }
      ] = await Promise.all([app.getValidatorsKeysStats(), app.getValidatorsKeysStats(activeNodeOperatorId)])

      assertBn(activeValidatorsKeysCountBefore, activeValidatorsKeysCountAfter)
      assertBn(totalActiveValidatorsKeysCountBefore, totalActiveValidatorsKeysCountAfter)
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
      const hasPermission = await acl.hasPermission(nobody, app.address, await app.SET_NODE_OPERATOR_LIMIT_ROLE())
      assert.isFalse(hasPermission)
      await assertRevert(app.setNodeOperatorStakingLimit(0, 40, { from: nobody }), 'APP_AUTH_FAILED')
    })

    it('reverts when called on non existed validator', async () => {
      const hasPermission = await acl.hasPermission(voting, app.address, await app.SET_NODE_OPERATOR_LIMIT_ROLE())
      assert.isTrue(hasPermission)
      await assertRevert(app.setNodeOperatorStakingLimit(10, 40, { from: voting }), 'NODE_OPERATOR_NOT_FOUND')
    })

    it('reverts when node operator deactivated', async () => {
      const nodeOperatorId = 1
      const hasPermission = await acl.hasPermission(voting, app.address, await app.SET_NODE_OPERATOR_LIMIT_ROLE())
      assert.isTrue(hasPermission)
      await app.deactivateNodeOperator(nodeOperatorId, { from: voting })
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

    it('reduces total vetted validator keys count correctly if new value less than previous', async () => {
      const nodeOperatorId = 0
      const { vettedSigningKeysCount: vettedSigningKeysCountBefore } = await app.testing_getTotalSigningKeysStats()

      await app.setNodeOperatorStakingLimit(nodeOperatorId, 30, { from: voting })

      const { vettedSigningKeysCount: vettedSigningKeysCountAfter } = await app.testing_getTotalSigningKeysStats()

      assert.equal(vettedSigningKeysCountBefore.toNumber() - vettedSigningKeysCountAfter.toNumber(), 20)
    })

    it('increases total vetted validator keys count correctly if new value greater than previous', async () => {
      const nodeOperatorId = 0
      const { vettedSigningKeysCount: vettedSigningKeysCountBefore } = await app.testing_getTotalSigningKeysStats()

      await app.setNodeOperatorStakingLimit(nodeOperatorId, 100, { from: voting })

      const { vettedSigningKeysCount: vettedSigningKeysCountAfter } = await app.testing_getTotalSigningKeysStats()

      assert.equal(vettedSigningKeysCountAfter.toNumber() - vettedSigningKeysCountBefore.toNumber(), 50)
    })

    it('increases keysOpIndex on vettedSigningKeysCount change', async () => {
      await nodeOperators.addNodeOperator(app, { name: '1', rewardAddress: ADDRESS_1, totalSigningKeysCount: 100 }, { from: voting })

      const initialKeysOpBefore = await app.getKeysOpIndex().then((v) => v.toNumber())
      const tx = await app.setNodeOperatorStakingLimit(0, 40, { from: voting })

      assertEvent(tx, 'KeysOpIndexSet', { expectedArgs: { keysOpIndex: initialKeysOpBefore + 1 } })

      assertBn(await app.getKeysOpIndex(), initialKeysOpBefore + 1)
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
    assertEvent(result, 'KeysOpIndexSet', { decodeForAbi: NodeOperatorsRegistry._json.abi })

    keysOpIndex = await app.getKeysOpIndex()
    result = await pool.assignNextSigningKeys(2)
    keysAssignedEvt = getEventAt(result, 'KeysAssigned').args

    assert.sameMembers(hexSplit(keysAssignedEvt.pubkeys, PUBKEY_LENGTH_BYTES), [op0.keys[1], op1.keys[0]], 'assignment 2: pubkeys')
    assert.sameMembers(hexSplit(keysAssignedEvt.signatures, SIGNATURE_LENGTH_BYTES), [op0.sigs[1], op1.sigs[0]], 'assignment 2: signatures')
    assertBn(await app.getKeysOpIndex(), keysOpIndex.add(toBN(1)), 'keysOpIndex must increase if any keys were assigned')
    assertEvent(result, 'KeysOpIndexSet', { decodeForAbi: NodeOperatorsRegistry._json.abi })

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
    assertEvent(result, 'KeysOpIndexSet', { decodeForAbi: NodeOperatorsRegistry._json.abi })

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

  context('keysOpIndex increases correctly', () => {
    let initialKeysOpIndex

    before('set initial keys op index', async () => {
      initialKeysOpIndex = await app.getKeysOpIndex().then((v) => v.toNumber())
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
      const tx = await app.addSigningKeysOperatorBH(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: user1 })
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
  })
  context('distribute rewards', () => {
    it('must distribute rewards to operators', async () => {
      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, ETH(10))

      await app.testing_addNodeOperator('0', user1, 3, 3, 3, 0)
      await app.testing_addNodeOperator('1', user2, 7, 7, 7, 0)
      await app.testing_addNodeOperator('1', user3, 0, 0, 0, 0)

      await app.increaseTotalSigningKeysCount(10)
      await app.increaseVettedSigningKeysCount(10)
      await app.increaseDepositedSigningKeysCount(10)

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
