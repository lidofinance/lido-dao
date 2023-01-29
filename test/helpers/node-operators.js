const { assert } = require('chai')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { FakeValidatorKeys } = require('./signing-keys')

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
  const targetValidatorsKeysCount = config.targetValidatorsKeysCount || 0
  const stuckKeysCount = config.stuckKeysCount || 0
  const isActive = config.isActive === undefined ? true : config.isActive

  if (vettedSigningKeysCount < depositedSigningKeysCount) {
    throw new Error('Invalid keys config: vettedSigningKeysCount < depositedSigningKeysCount')
  }

  if (vettedSigningKeysCount > totalSigningKeysCount) {
    throw new Error('Invalid keys config: vettedSigningKeysCount > totalSigningKeysCount')
  }

  if (exitedSigningKeysCount > depositedSigningKeysCount) {
    throw new Error('Invalid keys config: depositedSigningKeysCount < exitedSigningKeysCount')
  }

  if (totalSigningKeysCount < exitedSigningKeysCount + depositedSigningKeysCount) {
    throw new Error('Invalid keys config: totalSigningKeys < stoppedValidators + usedSigningKeys')
  }

  let validatorKeys
  if (totalSigningKeysCount > 0) {
    validatorKeys = new FakeValidatorKeys(totalSigningKeysCount)
    await registry.addSigningKeys(newOperatorId, totalSigningKeysCount, ...validatorKeys.slice(), txOptions)
  }

  if (depositedSigningKeysCount > 0) {
    await registry.increaseNodeOperatorDepositedSigningKeysCount(newOperatorId, depositedSigningKeysCount, txOptions)
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
  return { validatorKeys, id: newOperatorId.toNumber() }
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

async function filterNodeOperators(registry, predicate) {
  const allNodeOperators = await getAllNodeOperators(registry)
  return allNodeOperators.filter(predicate)
}

module.exports = {
  addNodeOperator,
  findNodeOperatorId,
  getAllNodeOperators,
  filterNodeOperators
}
