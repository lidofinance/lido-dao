import { AbiCoder, keccak256, solidityPackedKeccak256 } from "ethers";
import { network } from "hardhat";
import { streccak } from "./keccak";

interface DeriveDomainSeparatorArgs {
  type: string;
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

/**
 * @todo: refactor using ethers.TypedDataEncoder
 */
export function deriveDomainSeparator({
  type,
  name,
  version,
  chainId,
  verifyingContract,
}: DeriveDomainSeparatorArgs): string {
  const coder = new AbiCoder();

  return keccak256(
    coder.encode(
      ["bytes32", "bytes32", "bytes32", "uint256", "address"],
      [streccak(type), streccak(name), streccak(version), chainId, verifyingContract],
    ),
  );
}

export function deriveStethDomainSeparator(stethAddress: string): string {
  return deriveDomainSeparator({
    type: "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
    name: "Liquid staked Ether 2.0",
    version: "2",
    chainId: network.config.chainId!,
    verifyingContract: stethAddress,
  });
}

interface DeriveTypeDataHashArgs {
  address: string;
  structHash: string;
}

export function deriveTypeDataHash({ address, structHash }: DeriveTypeDataHashArgs): string {
  return solidityPackedKeccak256(
    ["bytes", "bytes32", "bytes32"],
    ["0x1901", deriveStethDomainSeparator(address), structHash],
  );
}
