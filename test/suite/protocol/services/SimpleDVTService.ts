import { expect } from "chai";
import { randomBytes } from "ethers";

import { certainAddress, ether, impersonate, log, streccak, trace } from "lib";

import { LidoProtocol } from "../types";

export class SimpleDVTService {
  public readonly MIN_OPS_COUNT = 3n;
  public readonly MIN_OP_KEYS_COUNT = 10n;

  private PUBKEY_LENGTH = 48n;
  private SIGNATURE_LENGTH = 96n;

  public readonly MANAGE_SIGNING_KEYS_ROLE = streccak("MANAGE_SIGNING_KEYS");

  constructor(protected readonly protocol: LidoProtocol) {
  }

  /**
   * Fills the Simple DVT with some keys to deposit.
   */
  async fillOpsVettedKeys(
    minOperatorsCount = this.MIN_OPS_COUNT,
    minKeysCount = this.MIN_OP_KEYS_COUNT
  ) {
    await this.fillOpsKeys(minOperatorsCount, minKeysCount);

    const { sdvt } = this.protocol.contracts;

    for (let operatorId = 0n; operatorId < minOperatorsCount; operatorId++) {
      const nodeOperatorBefore = await sdvt.getNodeOperator(operatorId, false);

      if (nodeOperatorBefore.totalVettedValidators < nodeOperatorBefore.totalAddedValidators) {
        await this.setVettedValidatorsLimit(operatorId, nodeOperatorBefore.totalAddedValidators);
      }

      const nodeOperatorAfter = await sdvt.getNodeOperator(operatorId, false);

      expect(nodeOperatorAfter.totalVettedValidators).to.be.equal(nodeOperatorBefore.totalAddedValidators);
    }
  }

  /**
   * Fills the Simple DVT with some keys to deposit in case there are not enough of them.
   */
  async fillOpsKeys(
    minOperatorsCount = this.MIN_OPS_COUNT,
    minKeysCount = this.MIN_OP_KEYS_COUNT
  ) {
    log.debug("Filling Simple DVT with keys", {
      "Min operators count": minOperatorsCount,
      "Min keys count": minKeysCount
    });

    await this.fillOps(minOperatorsCount);

    const { sdvt } = this.protocol.contracts;

    for (let operatorId = 0n; operatorId < minOperatorsCount; operatorId++) {
      const unusedKeysCount = await sdvt.getUnusedSigningKeyCount(operatorId);
      if (unusedKeysCount < minKeysCount) {
        await this.addNodeOperatorKeys(operatorId, minKeysCount - unusedKeysCount);
      }

      const unusedKeysCountAfter = await sdvt.getUnusedSigningKeyCount(operatorId);

      expect(unusedKeysCountAfter).to.be.gte(minKeysCount);
    }
  }

  /**
   * Fills the Simple DVT with some operators in case there are not enough of them.
   */
  async fillOps(minOperatorsCount = this.MIN_OPS_COUNT) {
    const { sdvt } = this.protocol.contracts;

    const before = await sdvt.getNodeOperatorsCount();
    let count = 0n;

    while (before + count < minOperatorsCount) {
      const operatorId = before + count;

      const name = this.getOperatorName(operatorId);
      const rewardAddress = this.getOperatorRewardAddress(operatorId);
      const managerAddress = this.getOperatorManagerAddress(operatorId);

      await this.addNodeOperator(operatorId, name, rewardAddress, managerAddress);
      count++;
    }

    const after = await sdvt.getNodeOperatorsCount();

    expect(after).to.be.equal(before + count);
    expect(after).to.be.gte(minOperatorsCount);

    log.debug("Checked operators count", {
      "Min operators count": minOperatorsCount,
      "Operators count": after
    });
  }

  /**
   * Adds a new node operator to the Simple DVT.
   * Factory: https://etherscan.io/address/0xcAa3AF7460E83E665EEFeC73a7a542E5005C9639#code
   */
  async addNodeOperator(operatorId: bigint, name: string, rewardAddress: string, managerAddress: string) {
    const { sdvt, acl } = this.protocol.contracts;

    const easyTrackExecutor = await this.protocol.getSigner("easyTrackExecutor");

    const addTx = await sdvt.connect(easyTrackExecutor).addNodeOperator(name, rewardAddress);
    await trace("simpleDVT.addNodeOperator", addTx);

    const grantPermissionTx = await acl.connect(easyTrackExecutor).grantPermissionP(
      managerAddress,
      sdvt.address,
      this.MANAGE_SIGNING_KEYS_ROLE,
      // See https://legacy-docs.aragon.org/developers/tools/aragonos/reference-aragonos-3#parameter-interpretation for details
      [1 << 240 + Number(operatorId)]
    );
    await trace("acl.grantPermissionP", grantPermissionTx);
  }

  /**
   * Adds keys to the node operator.
   */
  async addNodeOperatorKeys(operatorId: bigint, keysCount: bigint) {
    const { sdvt } = this.protocol.contracts;

    const totalKeysBefore = await sdvt.getTotalSigningKeyCount(operatorId);
    const unusedKeysBefore = await sdvt.getUnusedSigningKeyCount(operatorId);
    const { rewardAddress } = await sdvt.getNodeOperator(operatorId, false);

    const actor = await impersonate(rewardAddress, ether("100"));

    const addKeysTx = await sdvt.connect(actor).addSigningKeys(
      operatorId,
      keysCount,
      randomBytes(Number(keysCount * this.PUBKEY_LENGTH)),
      randomBytes(Number(keysCount * this.SIGNATURE_LENGTH))
    );
    await trace("simpleDVT.addSigningKeys", addKeysTx);

    const totalKeysAfter = await sdvt.getTotalSigningKeyCount(operatorId);
    const unusedKeysAfter = await sdvt.getUnusedSigningKeyCount(operatorId);

    expect(totalKeysAfter).to.be.equal(totalKeysBefore + keysCount);
    expect(unusedKeysAfter).to.be.equal(unusedKeysBefore + keysCount);
  }

  /**
   * Sets the staking limit for the operator.
   */
  async setVettedValidatorsLimit(operatorId: bigint, limit: bigint) {
    const { sdvt } = this.protocol.contracts;

    const easyTrackExecutor = await this.protocol.getSigner("easyTrackExecutor");

    const setLimitTx = await sdvt.connect(easyTrackExecutor).setNodeOperatorStakingLimit(operatorId, limit);
    await trace("simpleDVT.setNodeOperatorStakingLimit", setLimitTx);
  }

  private getOperatorName = (id: bigint, group: bigint = 0n) => `OP-${group}-${id}`;

  private getOperatorRewardAddress = (id: bigint, group: bigint = 0n) => certainAddress(`OPR:${group}:${id}`);

  private getOperatorManagerAddress = (id: bigint, group: bigint = 0n) => certainAddress(`OPM:${group}:${id}`);
}
