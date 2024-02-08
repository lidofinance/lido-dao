import { AbiCoder, HDNodeWallet, keccak256, solidityPackedKeccak256 } from "ethers";
import { network } from "hardhat";
import { OwnerWithEip712PermitSignature } from "typechain-types";
import { sign } from "./ec";
import { streccak } from "./keccak";
import { de0x } from "./string";
import { toBuffer } from "ethereumjs-util";

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
  structHash: string;
  domainSeparator: string;
}

export function deriveTypeDataHash({ structHash, domainSeparator }: DeriveTypeDataHashArgs): string {
  return solidityPackedKeccak256(["bytes", "bytes32", "bytes32"], ["0x1901", domainSeparator, structHash]);
}

interface SignPermitArgs {
  type: string;
  owner: HDNodeWallet;
  spender: string;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
  steth: string;
}

export function signStethPermit({ type, owner, spender, value, nonce, deadline, steth }: SignPermitArgs) {
  const parameters = keccak256(
    new AbiCoder().encode(
      ["bytes32", "address", "address", "uint256", "uint256", "uint256"],
      [streccak(type), owner.address, spender, value, nonce, deadline],
    ),
  );

  const domainSeparator = deriveStethDomainSeparator(steth);
  const message = keccak256("0x1901" + de0x(domainSeparator) + de0x(parameters));

  return sign(message, owner.privateKey);
}

interface SignPermitEIP1271Args {
  type: string;
  owner: OwnerWithEip712PermitSignature;
  spender: string;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
  steth: string;
}

export async function signStethPermitEIP1271({
  type,
  owner,
  spender,
  value,
  nonce,
  deadline,
  steth,
}: SignPermitEIP1271Args) {
  type = streccak(type);

  const parameters = keccak256(
    new AbiCoder().encode(
      ["bytes32", "address", "address", "uint256", "uint256", "uint256"],
      [type, await owner.getAddress(), spender, value, nonce, deadline],
    ),
  );

  const domainSeparator = deriveStethDomainSeparator(steth);
  const message = keccak256("0x1901" + de0x(domainSeparator) + de0x(parameters));

  const { v, r, s } = await owner.sign(message);

  return {
    v: Number(v),
    r: toBuffer(r),
    s: toBuffer(s),
  };
}
