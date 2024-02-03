import { sign, toEip2098 } from "./ec";
import { solidityPackedKeccak256 } from "ethers";

class DSMMessage {
  static MESSAGE_PREFIX: string;

  static setMessagePrefix(newMessagePrefix: string) {
    this.MESSAGE_PREFIX = newMessagePrefix;
  }

  get messagePrefix(): string {
    const messagePrefix = this.constructor.MESSAGE_PREFIX;
    if (messagePrefix === undefined) {
      throw new Error(`MESSAGE_PREFIX isn't set`);
    }
    return messagePrefix;
  }

  get hash(): string {
    throw new Error("Unimplemented");
  }

  sign(signerPrivateKey: string): DepositSecurityModule.SignatureStruct {
    return toEip2098(sign(this.hash, signerPrivateKey));
  }
}

export class DSMAttestMessage extends DSMMessage {
  blockNumber: number;
  blockHash: string;
  depositRoot: string;
  stakingModule: number;
  keysOpIndex: number;

  constructor(blockNumber: number, blockHash: string, depositRoot: string, stakingModule: number, keysOpIndex: number) {
    super();
    this.blockNumber = blockNumber;
    this.blockHash = blockHash;
    this.depositRoot = depositRoot;
    this.stakingModule = stakingModule;
    this.keysOpIndex = keysOpIndex;
  }

  get hash() {
    return solidityPackedKeccak256(
      ["bytes32", "uint256", "bytes32", "bytes32", "uint256", "uint256"],
      [this.messagePrefix, this.blockNumber, this.blockHash, this.depositRoot, this.stakingModule, this.keysOpIndex],
    );
  }
}

export class DSMPauseMessage extends DSMMessage {
  blockNumber: number;
  stakingModule: number;

  constructor(blockNumber: number, stakingModule: number) {
    super();
    this.blockNumber = blockNumber;
    this.stakingModule = stakingModule;
  }

  get hash() {
    return solidityPackedKeccak256(
      ["bytes32", "uint256", "uint256"],
      [this.messagePrefix, this.blockNumber, this.stakingModule],
    );
  }
}
