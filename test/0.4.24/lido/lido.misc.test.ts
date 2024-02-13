import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { ACL, Lido, LidoLocator, LidoLocator__factory, WithdrawalQueueMinimalApiForLido } from "typechain-types";

import { batch, certainAddress, deployLidoDao, ether, impersonate, ONE_ETHER } from "lib";

describe("Lido:misc", () => {
  let deployer: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let elRewardsVault: HardhatEthersSigner;
  let withdrawalsVault: HardhatEthersSigner;

  let lido: Lido;
  let acl: ACL;
  let locator: LidoLocator;
  let withdrawalQueue: WithdrawalQueueMinimalApiForLido;

  const elRewardsVaultBalance = ether("100.0");
  const withdrawalsVaultBalance = ether("100.0");

  beforeEach(async () => {
    [deployer, user, stranger] = await ethers.getSigners();

    withdrawalQueue = await ethers.deployContract("WithdrawalQueueMinimalApiForLido");
    ({ lido, acl } = await deployLidoDao({
      rootAccount: deployer,
      initialized: true,
      locatorConfig: {
        withdrawalQueue,
      },
    }));

    await acl.createPermission(user, lido, await lido.RESUME_ROLE(), deployer);
    await acl.createPermission(user, lido, await lido.PAUSE_ROLE(), deployer);
    await acl.createPermission(user, lido, await lido.UNSAFE_CHANGE_DEPOSITED_VALIDATORS_ROLE(), deployer);
    lido = lido.connect(user);

    locator = LidoLocator__factory.connect(await lido.getLidoLocator(), user);

    elRewardsVault = await impersonate(await locator.elRewardsVault(), elRewardsVaultBalance);
    withdrawalsVault = await impersonate(await locator.withdrawalVault(), withdrawalsVaultBalance);
  });

  context("receiveELRewards", () => {
    it("Reverts if the caller is not `ElRewardsVault`", async () => {
      await expect(lido.connect(stranger).receiveELRewards()).to.be.revertedWithoutReason();
    });

    it("Tops up the total EL rewards collected", async () => {
      const elRewardsToSend = ONE_ETHER;

      const before = await batch({
        totalElRewardsCollected: lido.getTotalELRewardsCollected(),
        lidoBalance: ethers.provider.getBalance(lido),
      });

      await expect(lido.connect(elRewardsVault).receiveELRewards({ value: elRewardsToSend }))
        .to.emit(lido, "ELRewardsReceived")
        .withArgs(elRewardsToSend);

      const after = await batch({
        totalElRewardsCollected: lido.getTotalELRewardsCollected(),
        lidoBalance: ethers.provider.getBalance(lido),
      });

      expect(after.totalElRewardsCollected).to.equal(before.totalElRewardsCollected + elRewardsToSend);
      expect(after.lidoBalance).to.equal(before.lidoBalance + elRewardsToSend);
    });
  });

  context("getTotalELRewardsCollected", () => {
    it("Returns the current total EL rewards collected", async () => {
      const totalElRewardsBefore = await lido.getTotalELRewardsCollected();
      const elRewardsToSend = ONE_ETHER;

      await lido.connect(elRewardsVault).receiveELRewards({ value: elRewardsToSend });

      expect(await lido.getTotalELRewardsCollected()).to.equal(totalElRewardsBefore + elRewardsToSend);
    });
  });

  context("receiveWithdrawals", () => {
    it("Reverts if the caller is not `WithdrawalsVault`", async () => {
      await expect(lido.connect(stranger).receiveWithdrawals()).to.be.revertedWithoutReason();
    });

    it("Tops up the Lido buffer", async () => {
      const withdrawalsToSend = ONE_ETHER;

      const lidoBalanceBefore = await ethers.provider.getBalance(lido);

      await expect(lido.connect(withdrawalsVault).receiveWithdrawals({ value: withdrawalsToSend }))
        .to.emit(lido, "WithdrawalsReceived")
        .withArgs(withdrawalsToSend);

      expect(await ethers.provider.getBalance(lido)).to.equal(lidoBalanceBefore + withdrawalsToSend);
    });
  });

  context("transferToVault", () => {
    it("Reverts always", async () => {
      await expect(lido.transferToVault(certainAddress("lido:transferToVault"))).to.be.revertedWith("NOT_SUPPORTED");
    });
  });

  context("getBufferedEther", () => {
    it("Returns ether current buffered on the contract", async () => {
      await lido.resume();

      const bufferedEtherBefore = await lido.getBufferedEther();

      const stakeAmount = ether("10.0");
      await lido.submit(ZeroAddress, { value: stakeAmount });

      expect(await lido.getBufferedEther()).to.equal(bufferedEtherBefore + stakeAmount);
    });
  });

  context("getLidoLocator", () => {
    it("Returns the address of `LidoLocator`", async () => {
      expect(await lido.getLidoLocator()).to.equal(await locator.getAddress());
    });
  });

  context("canDeposit", () => {
    it("Returns true if Lido is not stopped and bunkerMode is disabled", async () => {
      await lido.resume();
      await withdrawalQueue._setBunkerMode(false);

      expect(await lido.canDeposit()).to.equal(true);
    });

    it("Returns false if Lido is stopped and bunkerMode is disabled", async () => {
      await withdrawalQueue._setBunkerMode(false);

      expect(await lido.canDeposit()).to.equal(false);
    });

    it("Returns false if Lido is not stopped and bunkerMode is enabled", async () => {
      await lido.resume();
      await withdrawalQueue._setBunkerMode(true);

      expect(await lido.canDeposit()).to.equal(false);
    });

    it("Returns false if Lido is stopped and bunkerMode is disabled", async () => {
      await withdrawalQueue._setBunkerMode(true);

      expect(await lido.canDeposit()).to.equal(false);
    });
  });

  context("unsafeChangeDepositedValidators", () => {
    it("Sets the number of deposited validators", async () => {
      const { depositedValidators } = await lido.getBeaconStat();

      const updatedDepositedValidators = depositedValidators + 50n;

      await expect(lido.unsafeChangeDepositedValidators(updatedDepositedValidators))
        .to.emit(lido, "DepositedValidatorsChanged")
        .withArgs(updatedDepositedValidators);

      expect((await lido.getBeaconStat()).depositedValidators).to.equal(updatedDepositedValidators);
    });

    it("Reverts if the caller is unauthorized", async () => {
      await expect(lido.connect(stranger).unsafeChangeDepositedValidators(100n)).to.be.revertedWith("APP_AUTH_FAILED");
    });
  });
});
