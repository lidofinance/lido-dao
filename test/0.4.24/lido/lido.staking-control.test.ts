import { expect } from "chai";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { ACL, Lido } from "typechain-types";

import { deployLidoDao } from "lib";

describe("Lido:staking-control", () => {
  let deployer: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  let lido: Lido;
  let acl: ACL;

  beforeEach(async () => {
    [deployer, user, stranger] = await ethers.getSigners();

    ({ lido, acl } = await deployLidoDao({ rootAccount: deployer, initialized: true }));

    await acl.createPermission(user, lido, await lido.STAKING_CONTROL_ROLE(), deployer);
    await acl.createPermission(user, lido, await lido.STAKING_PAUSE_ROLE(), deployer);

    lido = lido.connect(user);
  });

  context("resumeStaking", () => {
    it("Resumes staking", async () => {
      expect(await lido.isStakingPaused()).to.equal(true);
      await expect(lido.resumeStaking()).to.emit(lido, "StakingResumed");
      expect(await lido.isStakingPaused()).to.equal(false);
    });

    it("Reverts if the caller is unauthorized", async () => {
      await expect(lido.connect(stranger).resumeStaking()).to.be.revertedWith("APP_AUTH_FAILED");
    });
  });

  context("pauseStaking", () => {
    beforeEach(async () => {
      await lido.resumeStaking();
      expect(await lido.isStakingPaused()).to.equal(false);
    });

    it("Pauses staking", async () => {
      await expect(lido.pauseStaking()).to.emit(lido, "StakingPaused");
      expect(await lido.isStakingPaused()).to.equal(true);
    });

    it("Reverts if the caller is unauthorized", async () => {
      await expect(lido.connect(stranger).pauseStaking()).to.be.revertedWith("APP_AUTH_FAILED");
    });
  });
});
