const { assert } = require('chai')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { createFakePublicKeysBatch, createFakeSignaturesBatch } = require('./signing-keys')

/***
 * Adds new Node Operator to the registry and configures it
 * @param {object} registry Node operators registry instance
 * @param {object} config Configuration of the added node operator
 * @param {string} config.name Name of the new node operator
 * @param {string} config.rewardAddress Reward address of the new node operator
 * @param {number} config.totalSigningKeys Count of the validators in the new node operator
 * @param {number} config.usedSigningKeys Count of used signing keys in the new node operator
 * @param {number} config.stoppedValidators Count of stopped signing keys in the new node operator
 * @param {number} config.stakingLimit Staking limit of the new node operator
 * @param {number} config.isActive The active state of new node operator
 * @param {object} txOptions Transaction options, like "from", "gasPrice" and e.t.c
 * @returns {number} newOperatorId Id of newly added Node Operator
 */
async function addNodeOperator(registry, config, txOptions) {
  const newOperatorId = await registry.getNodeOperatorsCount()
  const { activeKeysCount: activeKeysCountBefore, availableKeysCount: availableKeysCountBefore } = await registry.getKeysUsageData()

  await registry.addNodeOperator(config.name, config.rewardAddress, txOptions)

  const totalSigningKeys = config.totalSigningKeys || 0
  const stoppedValidators = config.stoppedValidators || 0
  const usedSigningKeys = config.usedSigningKeys || 0
  const stakingLimit = config.stakingLimit || 0
  const isActive = config.isActive === undefined ? true : config.isActive

  if (totalSigningKeys < stoppedValidators + usedSigningKeys) {
    throw new Error('Invalid keys config: totalSigningKeys < stoppedValidators + usedSigningKeys')
  }

  if (totalSigningKeys > 0) {
    const pubkeys = createFakePublicKeysBatch(totalSigningKeys)
    const signatures = createFakeSignaturesBatch(totalSigningKeys)
    await registry.addSigningKeys(newOperatorId, totalSigningKeys, pubkeys, signatures, txOptions)
  }

  if (usedSigningKeys > 0) {
    await registry.incUsedSigningKeys(newOperatorId, usedSigningKeys, txOptions)
  }

  if (stoppedValidators > 0) {
    await registry.reportStoppedValidators(newOperatorId, stoppedValidators, txOptions)
  }

  if (stakingLimit > 0) {
    await registry.setNodeOperatorStakingLimit(newOperatorId, stakingLimit, txOptions)
  }

  if (!isActive) {
    await registry.setNodeOperatorActive(newOperatorId, false, txOptions)
  }

  const newOperator = await registry.getNodeOperator(newOperatorId, true)
  const { activeKeysCount: activeKeysCountAfter, availableKeysCount: availableKeysCountAfter } = await registry.getKeysUsageData()

  assert.equal(newOperator.name, config.name, 'Invalid name')
  assert.equal(newOperator.rewardAddress, config.rewardAddress, 'Invalid reward address')
  assert.equal(newOperator.active, isActive, 'Invalid active status')
  assertBn(newOperator.stakingLimit, stakingLimit, 'Invalid staking limit')

  const expectedTotalSigningKeys = isActive ? totalSigningKeys : usedSigningKeys
  assertBn(newOperator.totalSigningKeys, expectedTotalSigningKeys, 'Invalid total signing keys')
  assertBn(newOperator.usedSigningKeys, usedSigningKeys, 'Invalid used signing keys')
  assertBn(newOperator.stoppedValidators, stoppedValidators, 'Invalid stopped signing keys')

  const expectedActiveKeysCount = activeKeysCountBefore.toNumber() + usedSigningKeys - stoppedValidators
  assertBn(expectedActiveKeysCount, activeKeysCountAfter)

  const expectedAvailableKeys = isActive ? Math.max(0, Math.min(totalSigningKeys, stakingLimit) - usedSigningKeys) : 0

  assertBn(availableKeysCountBefore.toNumber() + expectedAvailableKeys, availableKeysCountAfter)

  return newOperatorId.toNumber()
}

async function getAllNodeOperators(registry) {
  const nodeOperatorsCount = await registry.getNodeOperatorsCount()
  const getNodeOperatorTxs = []
  for (let i = 0; i < nodeOperatorsCount.toNumber(); ++i) {
    getNodeOperatorTxs.push(registry.getNodeOperator(i, true))
  }
  return Promise.all(getNodeOperatorTxs)
}

async function findNodeOperatorId(registry, predicate) {
  const allNodeOperators = await getAllNodeOperators(registry)
  return allNodeOperators.findIndex(predicate)
}

module.exports = {
  addNodeOperator,
  findNodeOperatorId,
  getAllNodeOperators
}
