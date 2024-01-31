import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { MaxUint256, ZeroAddress } from "ethers";
import { ethers } from "hardhat";
import { INITIAL_STETH_HOLDER, certainAddress, proxify } from "lib/address";
import {
  LidoInitializedForFinalizeUpgradeV2,
  LidoInitializedForFinalizeUpgradeV2__factory,
  LidoLocator,
  LidoLocatorPartialReturningOnlyWithdrawalQueueAndBurner__factory,
} from "typechain-types";

describe.only("Lido:finalizeUpgrade_v2", () => {
  let deployer: HardhatEthersSigner;

  let impl: LidoInitializedForFinalizeUpgradeV2;
  let lido: LidoInitializedForFinalizeUpgradeV2;
  let locator: LidoLocator;

  const initialValue = 1n;
  const initialVersion = 0n;
  const finalizeVersion = 2n;

  const withdrawalQueueAddress = certainAddress("lido:initialize:withdrawalQueue");
  const burnerAddress = certainAddress("lido:initialize:burner");
  const eip712helperAddress = certainAddress("lido:initialize:eip712helper");

  beforeEach(async () => {
    [deployer] = await ethers.getSigners();
    const lidoFactory = new LidoInitializedForFinalizeUpgradeV2__factory(deployer);
    impl = await lidoFactory.deploy();
    [lido] = await proxify({ impl, admin: deployer });

    const locatorFactory = new LidoLocatorPartialReturningOnlyWithdrawalQueueAndBurner__factory(deployer);
    locator = (await locatorFactory.deploy(withdrawalQueueAddress, burnerAddress)) as LidoLocator;
  });

  it("Reverts if contract version does not equal zero", async () => {
    const unexpectedVersion = 1n;

    await expect(lido.__initialize(unexpectedVersion, { value: initialValue }))
      .to.emit(lido, "Submitted")
      .withArgs(INITIAL_STETH_HOLDER, initialValue, ZeroAddress)
      .and.to.emit(lido, "Transfer")
      .withArgs(ZeroAddress, INITIAL_STETH_HOLDER, initialValue)
      .and.to.emit(lido, "TransferShares")
      .withArgs(ZeroAddress, INITIAL_STETH_HOLDER, initialValue)
      .and.to.emit(lido, "ContractVersionSet")
      .withArgs(unexpectedVersion);

    await expect(lido.finalizeUpgrade_v2(ZeroAddress, eip712helperAddress)).to.be.reverted;
  });

  context("contractVersion equals 0", () => {
    beforeEach(async () => {
      const latestBlock = BigInt(await time.latestBlock());

      await expect(lido.__initialize(initialVersion, { value: initialValue }))
        .to.emit(lido, "Submitted")
        .withArgs(INITIAL_STETH_HOLDER, initialValue, ZeroAddress)
        .and.to.emit(lido, "Transfer")
        .withArgs(ZeroAddress, INITIAL_STETH_HOLDER, initialValue)
        .and.to.emit(lido, "TransferShares")
        .withArgs(ZeroAddress, INITIAL_STETH_HOLDER, initialValue)
        .and.to.emit(lido, "ContractVersionSet")
        .withArgs(initialVersion);

      expect(await impl.getInitializationBlock()).to.equal(MaxUint256);
      expect(await lido.getInitializationBlock()).to.equal(latestBlock + 1n);
    });

    it("Reverts if Locator is zero address", async () => {
      await expect(lido.finalizeUpgrade_v2(ZeroAddress, eip712helperAddress)).to.be.reverted;
    });

    it("Reverts if EIP-712 helper is zero address", async () => {
      await expect(lido.finalizeUpgrade_v2(locator, ZeroAddress)).to.be.reverted;
    });

    it("Bootstraps initial holder, sets the locator and EIP-712 helper", async () => {
      await expect(lido.finalizeUpgrade_v2(locator, eip712helperAddress))
        .and.to.emit(lido, "ContractVersionSet")
        .withArgs(finalizeVersion)
        .and.to.emit(lido, "EIP712StETHInitialized")
        .withArgs(eip712helperAddress)
        .and.to.emit(lido, "Approval")
        .withArgs(withdrawalQueueAddress, burnerAddress, MaxUint256)
        .and.to.emit(lido, "LidoLocatorSet")
        .withArgs(await locator.getAddress());

      expect(await lido.getBufferedEther()).to.equal(initialValue);
      expect(await lido.getLidoLocator()).to.equal(await locator.getAddress());
      expect(await lido.getEIP712StETH()).to.equal(eip712helperAddress);
      expect(await lido.allowance(withdrawalQueueAddress, burnerAddress)).to.equal(MaxUint256);
    });
  });
});
