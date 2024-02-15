import { expect } from "chai";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { WithdrawalQueueERC721 } from "typechain-types";

import { deployWithdrawalQueue, proxify, randomAddress } from "lib";

describe("WithdrawalQueueERC721:Versioned", () => {
  let owner: HardhatEthersSigner;
  let versioned: WithdrawalQueueERC721;

  before(async () => {
    [owner] = await ethers.getSigners();

    const deployed = await deployWithdrawalQueue({
      queueAdmin: owner,
      doInitialise: false,
    });

    [versioned] = await proxify({ impl: deployed.impl, admin: owner });
  });

  it("getContractVersion", async () => {
    await versioned.initialize(randomAddress());

    expect(await versioned.getContractVersion()).to.equal(1n);
  });
});
