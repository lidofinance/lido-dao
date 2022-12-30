const { assert } = require('chai')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { createFakePublicKeysBatch, createFakeSignaturesBatch } = require('./signing-keys')

/***
 * Adds new Node Operator to the registry and configures it
 * @param {object} registry Node operators registry instance
 * @param {object} config Configuration of the added node operator
 * @param {string} config.name Name of the new node operator
 * @param {string} config.rewardAddress Reward address of the new node operator
 * @param {number} config.totalSigningKeysCount Count of the validators in the new node operator
 * @param {number} config.depositedSigningKeysCount Count of used signing keys in the new node operator
 * @param {number} config.exitedSigningKeysCount Count of stopped signing keys in the new node operator
 * @param {number} config.vettedSigningKeysCount Staking limit of the new node operator
 * @param {number} config.isActive The active state of new node operator
 * @param {object} txOptions Transaction options, like "from", "gasPrice" and e.t.c
 * @returns {number} newOperatorId Id of newly added Node Operator
 */
async function addNodeOperator(registry, config, txOptions) {
  const newOperatorId = await registry.getNodeOperatorsCount()
  // const { activeKeysCount: activeKeysCountBefore, availableKeysCount: availableKeysCountBefore } = await registry.getKeysUsageData()

  await registry.addNodeOperator(config.name, config.rewardAddress, txOptions)

  const totalSigningKeysCount = config.totalSigningKeysCount || 0
  const exitedSigningKeysCount = config.exitedSigningKeysCount || 0
  const depositedSigningKeysCount = config.depositedSigningKeysCount || 0
  const vettedSigningKeysCount = config.vettedSigningKeysCount || 0
  const isActive = config.isActive === undefined ? true : config.isActive

  if (depositedSigningKeysCount > vettedSigningKeysCount) {
    throw new Error('Invalid keys config: everDepositedKeysLimit < everDepositedKeysCount')
  }
  if (exitedSigningKeysCount > depositedSigningKeysCount) {
    throw new Error('Invalid keys config: everDepositedKeysCount < everExitedKeysCount')
  }

  if (totalSigningKeysCount < exitedSigningKeysCount + depositedSigningKeysCount) {
    throw new Error('Invalid keys config: totalSigningKeys < stoppedValidators + usedSigningKeys')
  }

  if (totalSigningKeysCount > 0) {
    const pubkeys = createFakePublicKeysBatch(totalSigningKeysCount)
    const signatures = createFakeSignaturesBatch(totalSigningKeysCount)
    await registry.addSigningKeys(newOperatorId, totalSigningKeysCount, pubkeys, signatures, txOptions)
  }

  if (depositedSigningKeysCount > 0) {
    await registry.increaseDepositedSigningKeysCount(newOperatorId, depositedSigningKeysCount, txOptions)
  }

  if (vettedSigningKeysCount > 0) {
    await registry.setNodeOperatorStakingLimit(newOperatorId, vettedSigningKeysCount, txOptions)
  }

  if (exitedSigningKeysCount > 0) {
    await registry.updateExitedValidatorsKeysCount(newOperatorId, exitedSigningKeysCount, txOptions)
  }

  if (!isActive) {
    await registry.deactivateNodeOperator(newOperatorId, txOptions)
  }

  const { exitedValidatorsCount, activeValidatorsKeysCount, readyToDepositValidatorsKeysCount } = await registry.getValidatorsKeysStats(
    newOperatorId
  )
  const nodeOperator = await registry.getNodeOperator(newOperatorId, true)

  if (isActive) {
    assertBn(nodeOperator.stakingLimit, vettedSigningKeysCount)
    assertBn(nodeOperator.totalSigningKeys, totalSigningKeysCount)
    assertBn(exitedValidatorsCount, exitedSigningKeysCount)
    assertBn(activeValidatorsKeysCount, depositedSigningKeysCount - exitedSigningKeysCount)
    assertBn(readyToDepositValidatorsKeysCount, vettedSigningKeysCount - depositedSigningKeysCount)
  } else {
    assertBn(exitedValidatorsCount, exitedSigningKeysCount)
    assertBn(activeValidatorsKeysCount, depositedSigningKeysCount - exitedSigningKeysCount)
    assertBn(readyToDepositValidatorsKeysCount, 0)
  }

  // const newOperator = await registry.getNodeOperator(newOperatorId, true)
  // const { activeKeysCount: activeKeysCountAfter, availableKeysCount: availableKeysCountAfter } = await registry.getKeysUsageData()

  // assert.equal(newOperator.name, config.name, 'Invalid name')
  // assert.equal(newOperator.rewardAddress, config.rewardAddress, 'Invalid reward address')
  // assert.equal(newOperator.active, isActive, 'Invalid active status')
  // assertBn(newOperator.stakingLimit, everDepositedKeysLimit, 'Invalid staking limit')

  // const expectedTotalSigningKeys = isActive ? everAddedKeysCount : everDepositedKeysCount
  // assertBn(newOperator.totalSigningKeys, expectedTotalSigningKeys, 'Invalid total signing keys')
  // assertBn(newOperator.usedSigningKeys, everDepositedKeysCount, 'Invalid used signing keys')
  // assertBn(newOperator.stoppedValidators, everExitedKeysCount, 'Invalid stopped signing keys')

  // const expectedActiveKeysCount = activeKeysCountBefore.toNumber() + everDepositedKeysCount - everExitedKeysCount
  // assertBn(expectedActiveKeysCount, activeKeysCountAfter)

  // const expectedAvailableKeys = isActive ? Math.max(0, Math.min(everAddedKeysCount, everDepositedKeysLimit) - everDepositedKeysCount) : 0

  // assertBn(availableKeysCountBefore.toNumber() + expectedAvailableKeys, availableKeysCountAfter)

  // return newOperatorId.toNumber()
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
