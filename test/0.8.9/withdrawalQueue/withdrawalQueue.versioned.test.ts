import { expect } from "chai";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { OssifiableProxy, WithdrawalQueueERC721, WithdrawalQueueERC721__factory } from "typechain-types";

import { MAX_UINT256, randomAddress } from "lib";

import deployWithdrawalQueue from "./deploy";

describe("WithdrawalQueueERC721:Versioned", () => {
  let owner: HardhatEthersSigner;

  let proxy: OssifiableProxy;
  let impl: WithdrawalQueueERC721;
  let versioned: WithdrawalQueueERC721;

  const petrifiedVersion = MAX_UINT256;

  before(async () => {
    [owner] = await ethers.getSigners();
    const deployed = await deployWithdrawalQueue({ owner });

    impl = deployed.token;
    proxy = await ethers.deployContract("OssifiableProxy", [deployed.tokenAddress, owner.address, new Uint8Array()], {
      from: owner,
    });

    versioned = WithdrawalQueueERC721__factory.connect(await proxy.getAddress(), owner);
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

  context("setContractVersion", () => {
    it("Updates the contract version on the proxy", async () => {
      await versioned.initialize(randomAddress());

      expect(await versioned.getContractVersion()).to.equal(1n);
      expect(await impl.getContractVersion()).to.equal(petrifiedVersion);
    });
  });
});
