import { PUBKEY_LENGTH, SIGNATURE_LENGTH } from "./constants";
import { de0x, hexConcat, pad } from "./string";

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

class ValidatorKeys {
  public readonly count: number;
  public readonly publicKeysList: string[];
  public readonly signaturesList: string[];

  constructor(publicKeys: string[], signatures: string[]) {
    if (publicKeys.length !== signatures.length) {
      throw new Error("Public keys & signatures length mismatch");
    }

    publicKeys = publicKeys.map(de0x);
    signatures = signatures.map(de0x);

    if (!publicKeys.every((pk) => pk.length !== PUBKEY_LENGTH)) {
      throw new Error("Invalid Public Key length");
    }

    if (!signatures.every((s) => s.length !== SIGNATURE_LENGTH)) {
      throw new Error("Invalid Signature length");
    }
    this.count = publicKeys.length;
    this.publicKeysList = publicKeys;
    this.signaturesList = signatures;
  }

  get(index: number) {
    if (index >= this.count) {
      throw new Error(`Index out of range`);
    }

    return ["0x" + this.publicKeysList[index], "0x" + this.signaturesList[index]];
  }

  slice(start = 0, end = this.count) {
    return [hexConcat(...this.publicKeysList.slice(start, end)), hexConcat(...this.signaturesList.slice(start, end))];
  }
}

class FakeValidatorKeys extends ValidatorKeys {
  constructor(length: number, { seed = randomInt(10, 10 ** 9), kFill = "f", sFill = "e" } = {}) {
    super(
      Array(length)
        .fill(0)
        .map((_, i) => Number(seed + i).toString(16))
        .map((v) => (v.length % 2 === 0 ? v : "0" + v)) // make resulting hex str length representation even(faa -> 0faa)
        .map((v) => pad("0x" + v, PUBKEY_LENGTH, kFill)),
      Array(length)
        .fill(0)
        .map((_, i) => Number(seed + i).toString(16))
        .map((v) => (v.length % 2 === 0 ? v : "0" + v)) // make resulting hex str length representation even(faa -> 0faa)
        .map((v) => pad("0x" + v, SIGNATURE_LENGTH, sFill)),
    );
  }
}

export { ValidatorKeys, FakeValidatorKeys };
