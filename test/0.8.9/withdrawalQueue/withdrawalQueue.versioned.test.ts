import { expect } from "chai";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { OssifiableProxy, WithdrawalQueueERC721, WithdrawalQueueERC721__factory } from "typechain-types";

import { deployWithdrawalQueue, MAX_UINT256, randomAddress } from "lib";

describe("WithdrawalQueueERC721:Versioned", () => {
  let admin: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  let impl: WithdrawalQueueERC721;
  let proxy: OssifiableProxy;
  let versioned: WithdrawalQueueERC721;

  const petrifiedVersion = MAX_UINT256;

  before(async () => {
    [admin, user] = await ethers.getSigners();

    const deployed = await deployWithdrawalQueue({
      queueAdmin: admin,
      doInitialise: false,
    });

    impl = deployed.impl;

    proxy = await ethers.deployContract("OssifiableProxy", [await impl.getAddress(), admin.address, new Uint8Array()], {
      from: admin,
    });

    versioned = WithdrawalQueueERC721__factory.connect(await proxy.getAddress(), user);
  });

  context("constructor", () => {
    it("Petrifies the implementation", async () => {
      expect(await impl.getContractVersion()).to.equal(petrifiedVersion);
    });
  });

  context("getContractVersion", () => {
    it("Returns 0 as the initial contract version", async () => {
      expect(await versioned.getContractVersion()).to.equal(0n);
    });
  });

  context("initialize", () => {
    it("Increments version", async () => {
      await versioned.initialize(randomAddress());

      expect(await versioned.getContractVersion()).to.equal(1n);
    });
  });
});
