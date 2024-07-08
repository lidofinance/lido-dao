import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { log, trace } from "lib";

import { LidoProtocol } from "../types";

export class NodeOperatorsRegistryService {
  public readonly MIN_OPS_COUNT = 3n;
  public readonly MIN_OP_KEYS_COUNT = 10n;

  constructor(protected readonly protocol: LidoProtocol) {}

  /**
   * Fills the Simple DVT with some keys to deposit.
   */
  async fillOpsVettedKeys(
    signer: HardhatEthersSigner,
    minOperatorsCount = this.MIN_OPS_COUNT,
    minKeysCount = this.MIN_OP_KEYS_COUNT,
  ) {
    await this.fillOpsKeys(signer, minOperatorsCount, minKeysCount);
  }

  async fillOpsKeys(
    signer: HardhatEthersSigner,
    minOperatorsCount = this.MIN_OPS_COUNT,
    minKeysCount = this.MIN_OP_KEYS_COUNT,
  ) {
    log.debug("Filling Simple DVT with keys", {
      "Min operators count": minOperatorsCount,
      "Min keys count": minKeysCount,
    });

    await this.fillOps(signer, minOperatorsCount);
  }

  async fillOps(signer: HardhatEthersSigner, minOperatorsCount = this.MIN_OPS_COUNT) {
    const { sdvt } = this.protocol.contracts;

    const nodeOperatorsCountBefore = await sdvt.getNodeOperatorsCount();

    let count = 0n;
    while (nodeOperatorsCountBefore + count < minOperatorsCount) {
      const operatorId = nodeOperatorsCountBefore + count;

      const name = this.getOperatorName(operatorId);
      const address = this.getOperatorAddress(operatorId);
      // const managersAddress = this.getManagersAddress(operatorId);

      // TODO: verify this calls are correct, compare with FactoryContract
      const addTx = await sdvt.connect(signer).addNodeOperator(name, address);

      await trace("simpleDVT.addNodeOperator", addTx);

      count++;
    }
  }

  private getOperatorName = (id: bigint, group: bigint = 0n) => `OP-${group}-${id}`;

  private getOperatorAddress = (id: bigint, group: bigint = 0n) => `0x11${this.getAddress(group, id)}`;

  // private getManagersAddress = (id: bigint, group: bigint = 0n) =>
  //   `0x22${this.getAddress(group, id)}`;

  private getAddress = (id: bigint, group: bigint = 0n) =>
    `${group.toString(16).padStart(5, "0")}${id.toString(16).padStart(33, "0")}`;
}
