import { expect } from "chai";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { LidoLocator } from "typechain-types";

import { streccak } from "lib";

import { DEFAULT_TWG_LIMIT, deployLidoLocator, deployTriggerableWithdrawalsGateway } from "test/deploy";

import { FULL_WITHDRAWAL_WEIGHT_GWEI } from "../triggerable-withdrawals-helpers";

const MIN_MAX_LIMIT = FULL_WITHDRAWAL_WEIGHT_GWEI;

describe("TriggerableWithdrawalsGateway.sol: deployment", () => {
  let admin: HardhatEthersSigner;
  let locator: LidoLocator;

  const deploy = async (args: unknown[]) => ethers.deployContract("TriggerableWithdrawalsGateway", args);

  const factory = () => ethers.getContractFactory("TriggerableWithdrawalsGateway");

  before(async () => {
    [admin] = await ethers.getSigners();
    locator = await deployLidoLocator();
  });

  it("deploys with valid parameters", async () => {
    const { gateway, locator: gatewayLocator } = await deployTriggerableWithdrawalsGateway(admin);

    expect(await gateway.LOCATOR()).to.equal(await gatewayLocator.getAddress());
    expect(await gateway.hasRole(await gateway.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
    expect(await gateway.getRoleMemberCount(await gateway.DEFAULT_ADMIN_ROLE())).to.equal(1);
    expect(await gateway.isPaused()).to.be.false;
  });

  it("has expected role and storage constants", async () => {
    const { gateway } = await deployTriggerableWithdrawalsGateway(admin);

    expect(await gateway.PAUSE_ROLE()).to.equal(streccak("PAUSE_ROLE"));
    expect(await gateway.RESUME_ROLE()).to.equal(streccak("RESUME_ROLE"));
    expect(await gateway.ADD_WITHDRAWAL_REQUEST_ROLE()).to.equal(streccak("ADD_WITHDRAWAL_REQUEST_ROLE"));
    expect(await gateway.TW_EXIT_LIMIT_MANAGER_ROLE()).to.equal(streccak("TW_EXIT_LIMIT_MANAGER_ROLE"));
    expect(await gateway.WITHDRAWAL_LIMIT_POSITION()).to.equal(
      streccak("lido.TriggerableWithdrawalsGateway.withdrawalLimitGwei"),
    );
  });

  it("starts with a fully available withdrawal limit", async () => {
    const { gateway } = await deployTriggerableWithdrawalsGateway(admin);

    const info = await gateway.getWithdrawalLimitFullInfo();
    expect(info.maxWithdrawalLimitGwei).to.equal(DEFAULT_TWG_LIMIT.maxWithdrawalLimitGwei);
    expect(info.withdrawalLimitPerFrameGwei).to.equal(DEFAULT_TWG_LIMIT.withdrawalLimitPerFrameGwei);
    expect(info.frameDurationInSec).to.equal(DEFAULT_TWG_LIMIT.frameDurationInSec);
    expect(info.prevWithdrawalLimitGwei).to.equal(DEFAULT_TWG_LIMIT.maxWithdrawalLimitGwei);
    expect(info.currentWithdrawalLimitGwei).to.equal(DEFAULT_TWG_LIMIT.maxWithdrawalLimitGwei);
  });

  it("emits WithdrawalLimitSet on deployment", async () => {
    const gateway = await deploy([admin.address, await locator.getAddress(), MIN_MAX_LIMIT, 1, 12]);

    await expect(gateway.deploymentTransaction()).to.emit(gateway, "WithdrawalLimitSet").withArgs(MIN_MAX_LIMIT, 1, 12);
  });

  it("accepts the max withdrawal limit equal to the full withdrawal weight", async () => {
    const gateway = await deploy([admin.address, await locator.getAddress(), MIN_MAX_LIMIT, MIN_MAX_LIMIT, 12]);

    expect((await gateway.getWithdrawalLimitFullInfo()).maxWithdrawalLimitGwei).to.equal(MIN_MAX_LIMIT);
  });

  it("accepts the max withdrawal limit of uint64", async () => {
    const gateway = await deploy([admin.address, await locator.getAddress(), 2n ** 64n - 1n, 1, 12]);

    expect((await gateway.getWithdrawalLimitFullInfo()).currentWithdrawalLimitGwei).to.equal(2n ** 64n - 1n);
  });

  context("reverts", () => {
    it("if admin is zero address", async () => {
      await expect(deploy([ethers.ZeroAddress, await locator.getAddress(), MIN_MAX_LIMIT, 1, 12]))
        .to.be.revertedWithCustomError(await factory(), "ZeroArgument")
        .withArgs("admin");
    });

    it("if lidoLocator is zero address", async () => {
      await expect(deploy([admin.address, ethers.ZeroAddress, MIN_MAX_LIMIT, 1, 12]))
        .to.be.revertedWithCustomError(await factory(), "ZeroArgument")
        .withArgs("lidoLocator");
    });

    it("if the max withdrawal limit is below the full withdrawal weight", async () => {
      await expect(deploy([admin.address, await locator.getAddress(), MIN_MAX_LIMIT - 1n, 1, 12]))
        .to.be.revertedWithCustomError(await factory(), "TooSmallMaxWithdrawalLimit")
        .withArgs(MIN_MAX_LIMIT - 1n);
    });

    it("if the limit per frame is zero", async () => {
      await expect(deploy([admin.address, await locator.getAddress(), MIN_MAX_LIMIT, 0, 12]))
        .to.be.revertedWithCustomError(await factory(), "ZeroArgument")
        .withArgs("withdrawalLimitPerFrameGwei");
    });

    it("if the limit per frame exceeds the max withdrawal limit", async () => {
      await expect(
        deploy([admin.address, await locator.getAddress(), MIN_MAX_LIMIT, MIN_MAX_LIMIT + 1n, 12]),
      ).to.be.revertedWithCustomError(await factory(), "TooLargeLimitPerFrame");
    });

    it("if frame duration is zero", async () => {
      await expect(
        deploy([admin.address, await locator.getAddress(), MIN_MAX_LIMIT, 1, 0]),
      ).to.be.revertedWithCustomError(await factory(), "ZeroFrameDuration");
    });

    it("if frame duration exceeds uint32", async () => {
      await expect(
        deploy([admin.address, await locator.getAddress(), MIN_MAX_LIMIT, 1, 2n ** 32n]),
      ).to.be.revertedWithCustomError(await factory(), "TooLargeFrameDuration");
    });

    it("if the max withdrawal limit exceeds uint64", async () => {
      await expect(deploy([admin.address, await locator.getAddress(), 2n ** 64n, 1, 12])).to.be.revertedWithCustomError(
        await factory(),
        "TooLargeMaxLimit",
      );
    });
  });
});
