import { expect } from "chai";
import { randomBytes } from "ethers";

import { certainAddress, log, trace } from "lib";

import { ProtocolContext } from "../types";

const MIN_OPS_COUNT = 3n;
const MIN_OP_KEYS_COUNT = 10n;

const PUBKEY_LENGTH = 48n;
const SIGNATURE_LENGTH = 96n;

export const ensureNOROperators = async (
  ctx: ProtocolContext,
  minOperatorsCount = MIN_OPS_COUNT,
  minOperatorKeysCount = MIN_OP_KEYS_COUNT,
) => {
  await ensureNOROperatorsHaveMinKeys(ctx, minOperatorsCount, minOperatorKeysCount);

  const { nor } = ctx.contracts;

  for (let operatorId = 0n; operatorId < minOperatorsCount; operatorId++) {
    const nodeOperatorBefore = await nor.getNodeOperator(operatorId, false);

    if (nodeOperatorBefore.totalVettedValidators < nodeOperatorBefore.totalAddedValidators) {
      await setNOROperatorStakingLimit(ctx, {
        operatorId,
        limit: nodeOperatorBefore.totalAddedValidators,
      });
    }

    const nodeOperatorAfter = await nor.getNodeOperator(operatorId, false);

    expect(nodeOperatorAfter.totalVettedValidators).to.be.equal(nodeOperatorBefore.totalAddedValidators);
  }
};

/**
 * Fills the Nor operators with some keys to deposit in case there are not enough of them.
 */
const ensureNOROperatorsHaveMinKeys = async (
  ctx: ProtocolContext,
  minOperatorsCount = MIN_OPS_COUNT,
  minKeysCount = MIN_OP_KEYS_COUNT,
) => {
  await ensureNORMinOperators(ctx, minOperatorsCount);

  const { nor } = ctx.contracts;

  for (let operatorId = 0n; operatorId < minOperatorsCount; operatorId++) {
    const keysCount = await nor.getTotalSigningKeyCount(operatorId);

    if (keysCount < minKeysCount) {
      log.warning(`Adding NOR fake keys to operator ${operatorId}`);

      await addNORFakeNodeOperatorKeys(ctx, {
        operatorId,
        keysToAdd: minKeysCount - keysCount,
      });
    }

    const keysCountAfter = await nor.getTotalSigningKeyCount(operatorId);

    expect(keysCountAfter).to.be.gte(minKeysCount);
  }

  log.debug("Checked NOR operators keys count", {
    "Min operators count": minOperatorsCount,
    "Min keys count": minKeysCount,
  });
};

/**
 * Fills the NOR with some operators in case there are not enough of them.
 */
const ensureNORMinOperators = async (ctx: ProtocolContext, minOperatorsCount = MIN_OPS_COUNT) => {
  const { nor } = ctx.contracts;

  const before = await nor.getNodeOperatorsCount();
  let count = 0n;

  while (before + count < minOperatorsCount) {
    const operatorId = before + count;

    const operator = {
      operatorId,
      name: getOperatorName(operatorId),
      rewardAddress: getOperatorRewardAddress(operatorId),
      managerAddress: getOperatorManagerAddress(operatorId),
    };

    log.warning(`Adding fake operator ${operatorId}`);

    await addFakeNodeOperatorToNor(ctx, operator);
    count++;
  }

  const after = await nor.getNodeOperatorsCount();

  expect(after).to.be.equal(before + count);
  expect(after).to.be.gte(minOperatorsCount);

  log.debug("Checked NOR operators count", {
    "Min operators count": minOperatorsCount,
    "Operators count": after,
  });
};

/**
 * Adds a new node operator to the NOR.
 */
export const addFakeNodeOperatorToNor = async (
  ctx: ProtocolContext,
  params: {
    operatorId: bigint;
    name: string;
    rewardAddress: string;
    managerAddress: string;
  },
) => {
  const { nor } = ctx.contracts;
  const { operatorId, name, rewardAddress, managerAddress } = params;

  const agentSigner = await ctx.getSigner("agent");

  const addTx = await nor.connect(agentSigner).addNodeOperator(name, rewardAddress);
  await trace("nodeOperatorRegistry.addNodeOperator", addTx);

  log.debug("Added NOR fake operator", {
    "Operator ID": operatorId,
    "Name": name,
    "Reward address": rewardAddress,
    "Manager address": managerAddress,
  });
};

/**
 * Adds some signing keys to the operator in the NOR.
 */
export const addNORFakeNodeOperatorKeys = async (
  ctx: ProtocolContext,
  params: {
    operatorId: bigint;
    keysToAdd: bigint;
  },
) => {
  const { nor } = ctx.contracts;
  const { operatorId, keysToAdd } = params;

  const totalKeysBefore = await nor.getTotalSigningKeyCount(operatorId);
  const unusedKeysBefore = await nor.getUnusedSigningKeyCount(operatorId);

  const votingSigner = await ctx.getSigner("voting");

  const addKeysTx = await nor
    .connect(votingSigner)
    .addSigningKeys(
      operatorId,
      keysToAdd,
      randomBytes(Number(keysToAdd * PUBKEY_LENGTH)),
      randomBytes(Number(keysToAdd * SIGNATURE_LENGTH)),
    );
  await trace("nodeOperatorRegistry.addSigningKeys", addKeysTx);

  const totalKeysAfter = await nor.getTotalSigningKeyCount(operatorId);
  const unusedKeysAfter = await nor.getUnusedSigningKeyCount(operatorId);

  expect(totalKeysAfter).to.be.equal(totalKeysBefore + keysToAdd);
  expect(unusedKeysAfter).to.be.equal(unusedKeysBefore + keysToAdd);

  log.debug("Added NOR fake signing keys", {
    "Operator ID": operatorId,
    "Keys to add": keysToAdd,
    "Total keys before": totalKeysBefore,
    "Total keys after": totalKeysAfter,
    "Unused keys before": unusedKeysBefore,
    "Unused keys after": unusedKeysAfter,
  });
};

/**
 * Sets the staking limit for the operator.
 */
const setNOROperatorStakingLimit = async (
  ctx: ProtocolContext,
  params: {
    operatorId: bigint;
    limit: bigint;
  },
) => {
  const { nor } = ctx.contracts;
  const { operatorId, limit } = params;

  const votingSigner = await ctx.getSigner("voting");

  const setLimitTx = await nor.connect(votingSigner).setNodeOperatorStakingLimit(operatorId, limit);
  await trace("nodeOperatorRegistry.setNodeOperatorStakingLimit", setLimitTx);
};

/**
 * Helper function to get some operator name.
 */
const getOperatorName = (id: bigint, group: bigint = 0n) => `NOR:OP-${group}-${id}`;

/**
 * Helper function to get some operator reward address.
 */
const getOperatorRewardAddress = (id: bigint, group: bigint = 0n) => certainAddress(`NOR:OPR:${group}:${id}`);

/**
 * Helper function to get some operator manager address.
 */
const getOperatorManagerAddress = (id: bigint, group: bigint = 0n) => certainAddress(`NOR:OPM:${group}:${id}`);
