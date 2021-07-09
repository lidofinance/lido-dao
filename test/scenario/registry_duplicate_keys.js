const { assert } = require('chai')
const { BN } = require('bn.js')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { getEventArgument } = require('@aragon/contract-helpers-test')

const { pad, hexConcat, toBN, ETH, tokens } = require('../helpers/utils')
const { deployDaoAndPool } = require('./helpers/deploy')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

contract('NodeOperatorsRegistry: a NOP tries to add duplicate validator keys', (addresses) => {
  const [
    // the root account which deployed the DAO
    appManager,
    // the address which we use to simulate the voting DAO application
    voting,
    // node operators
    operator_1,
    // unrelated address
    nobody
  ] = addresses

  let pool
  let nodeOperatorRegistry

  it('DAO, node operators registry, token, and pool are deployed and initialized', async () => {
    const deployed = await deployDaoAndPool(appManager, voting)

    // contracts/Lido.sol
    pool = deployed.pool

    // contracts/nos/NodeOperatorsRegistry.sol
    nodeOperatorRegistry = deployed.nodeOperatorRegistry
  })

  let operatorId

  it('voting adds a node operator', async () => {
    const validatorsLimit = 0
    const txn = await nodeOperatorRegistry.addNodeOperator('test', operator_1, validatorsLimit, { from: voting })

    assertBn(await nodeOperatorRegistry.getNodeOperatorsCount(), 1, 'total node operators')

    // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
    operatorId = getEventArgument(txn, 'NodeOperatorAdded', 'id', { decodeForAbi: NodeOperatorsRegistry._json.abi })
    assertBn(operatorId, 0, 'operator id')
  })

  it('node operator adds two keys', async () => {
    const numKeys = 2

    const keys = [pad('0x010101', 48), pad('0x020202', 48)]

    const sigs = [pad('0x01', 96), pad('0x02', 96)]

    await nodeOperatorRegistry.addSigningKeysOperatorBH(operatorId, numKeys, hexConcat(...keys), hexConcat(...sigs), { from: operator_1 })

    const totalKeys = await nodeOperatorRegistry.getTotalSigningKeyCount(operatorId, { from: nobody })
    assertBn(totalKeys, 2, 'total signing keys')

    const unusedKeys = await nodeOperatorRegistry.getUnusedSigningKeyCount(operatorId, { from: nobody })
    assertBn(unusedKeys, 2, 'unused signing keys')

    const key0 = await nodeOperatorRegistry.getSigningKey(operatorId, 0)
    const key1 = await nodeOperatorRegistry.getSigningKey(operatorId, 1)

    assert.equal(key0.key, keys[0], 'key 0')
    assert.equal(key1.key, keys[1], 'key 1')
  })

  it('DAO validates and approves the two added keys', async () => {
    await nodeOperatorRegistry.setNodeOperatorStakingLimit(operatorId, 2, { from: voting })
    const operator = await nodeOperatorRegistry.getNodeOperator(operatorId, false)
    assert(+operator.stakingLimit === 2, 'staking limit')
  })

  it('node operator adds one more key', async () => {
    const numKeys = 1

    const key = pad('0xbadbad', 48)
    const sig = pad('0xbad', 96)

    await nodeOperatorRegistry.addSigningKeysOperatorBH(operatorId, numKeys, key, sig, { from: operator_1 })

    const totalKeys = await nodeOperatorRegistry.getTotalSigningKeyCount(operatorId, { from: nobody })
    assertBn(totalKeys, 3, 'total signing keys')

    const unusedKeys = await nodeOperatorRegistry.getUnusedSigningKeyCount(operatorId, { from: nobody })
    assertBn(unusedKeys, 3, 'unused signing keys')

    const operator = await nodeOperatorRegistry.getNodeOperator(operatorId, false)
    assertBn(operator.stakingLimit, 2, 'staking limit')
  })

  it('node operator removes the first approved key', async () => {
    await nodeOperatorRegistry.removeSigningKeyOperatorBH(operatorId, 0, { from: operator_1 })

    const totalKeys = await nodeOperatorRegistry.getTotalSigningKeyCount(operatorId, { from: nobody })
    assertBn(totalKeys, 2, 'total signing keys')

    const unusedKeys = await nodeOperatorRegistry.getUnusedSigningKeyCount(operatorId, { from: nobody })
    assertBn(unusedKeys, 2, 'unused signing keys')

    const key0 = await nodeOperatorRegistry.getSigningKey(operatorId, 0)
    const key1 = await nodeOperatorRegistry.getSigningKey(operatorId, 1)

    const expectedKeys = [pad('0x020202', 48), pad('0xbadbad', 48)]

    assert.equal(key0.key, pad('0x020202', 48), 'key 0')
    assert.equal(key1.key, pad('0xbadbad', 48), 'key 1')
  })

  it('the staking limit should decrease since the key at index 1 is not approved', async () => {
    const operator = await nodeOperatorRegistry.getNodeOperator(operatorId, false)
    assertBn(operator.stakingLimit, 1, 'staking limit')
  })
})
