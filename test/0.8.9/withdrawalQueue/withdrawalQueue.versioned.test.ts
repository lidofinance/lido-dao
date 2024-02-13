import { expect } from "chai";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { WithdrawalQueueERC721 } from "typechain-types";

import { proxify, randomAddress } from "lib";

import deployWithdrawalQueue from "./deploy";

describe("WithdrawalQueueERC721:Versioned", () => {
  let owner: HardhatEthersSigner;

  let versioned: WithdrawalQueueERC721;

  before(async () => {
    [owner] = await ethers.getSigners();
    const deployed = await deployWithdrawalQueue({ owner });

    [versioned] = await proxify({ impl: deployed.token, admin: owner });
  });

  it("Increments version", async () => {
    await versioned.initialize(randomAddress());
    expect(await versioned.getContractVersion()).to.equal(1n);
  });
});
