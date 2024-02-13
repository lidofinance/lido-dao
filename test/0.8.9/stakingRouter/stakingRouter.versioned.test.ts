import { expect } from "chai";
import { randomBytes } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { StakingRouter } from "typechain-types";

import { proxify, randomAddress } from "lib";

describe("StakingRouter:Versioned", () => {
  let owner: HardhatEthersSigner;

  let versioned: StakingRouter;

  before(async () => {
    [owner] = await ethers.getSigners();
    const depositContract = randomAddress();
    const impl = await ethers.deployContract("StakingRouter", [depositContract]);

    [versioned] = await proxify({ impl, admin: owner });
  });

  it("Increments version", async () => {
    await versioned.initialize(randomAddress(), randomAddress(), randomBytes(32));
    expect(await versioned.getContractVersion()).to.equal(1n);
  });
});
