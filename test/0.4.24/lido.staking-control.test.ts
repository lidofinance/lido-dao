import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { deployLidoDao } from "lib";
import { ACL, Lido } from "typechain-types";

describe.only("Lido:staking-control", () => {
  let deployer: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  let lido: Lido;
  let acl: ACL;

  beforeEach(async () => {
    [deployer, user] = await ethers.getSigners();

    ({ lido, acl } = await deployLidoDao({ rootAccount: deployer, initialized: true }));

    await acl.createPermission(user, lido, await lido.STAKING_CONTROL_ROLE(), deployer);
    await acl.createPermission(user, lido, await lido.STAKING_PAUSE_ROLE(), deployer);

    lido = lido.connect(user);
  });

  context("resumeStaking", () => {
    it("Resumes staking", async () => {
      expect(await lido.isStakingPaused()).to.equal(true);
      await lido.resumeStaking();
      expect(await lido.isStakingPaused()).to.equal(false);
    });
  });

  context("pauseStaking", () => {
    it("Pauses staking", async () => {
      await lido.resumeStaking();
      expect(await lido.isStakingPaused()).to.equal(false);

      await lido.pauseStaking();
      expect(await lido.isStakingPaused()).to.equal(true);
    });
  });
});
