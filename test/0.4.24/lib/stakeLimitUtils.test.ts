import { expect } from "chai";
import { ethers } from "hardhat";

import { StakeLimitUtils__Harness } from "typechain-types";

import { Snapshot } from "lib";

describe("StakeLimitUtils.sol", () => {
  let stakeLimit: StakeLimitUtils__Harness;

  let originalState: string;

  before(async () => {
    stakeLimit = await ethers.deployContract("StakeLimitUtils__Harness");
  });

  beforeEach(async () => (originalState = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(originalState));

  context("todo", () => {
    it("todo", async () => {
      expect(true).to.be.true;

      console.log(stakeLimit);
    });
  });
});
