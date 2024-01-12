import { ethers } from "hardhat";
import { BaseContract, BytesLike } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { OssifiableProxy } from "../typechain-types";

interface ProxifyArgs<T> {
  impl: T;
  admin: HardhatEthersSigner;
  caller?: HardhatEthersSigner;
  data?: BytesLike;
}

export async function proxify<T extends BaseContract>({
  impl,
  admin,
  caller = admin,
  data = new Uint8Array(),
}: ProxifyArgs<T>): Promise<[T, OssifiableProxy]> {
  const implAddres = await impl.getAddress();

  const proxy = await ethers.deployContract("OssifiableProxy", [implAddres, admin.address, data], {
    from: admin,
  });

  const proxied = impl.attach(await proxy.getAddress()) as T;
  proxied.connect(caller);

  return [proxied, proxy];
}
