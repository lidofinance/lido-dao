import { expect } from "chai";
import { ethers } from "hardhat";
import { afterEach } from "mocha";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { WithdrawalQueueERC721 } from "typechain-types";

import { deployWithdrawalQueue, getBlockTimestamp, Snapshot, WITHDRAWAL_BUNKER_MODE_DISABLED_TIMESTAMP } from "lib";

interface WithdrawalQueueContractConfig {
  stEthAddress: string;
  wstEthAddress: string;
  name: string;
  symbol: string;
}

describe("WithdrawalQueueERC721:bunker", () => {
  const config: WithdrawalQueueContractConfig = {
    stEthAddress: "",
    wstEthAddress: "",
    name: "",
    symbol: "",
  };

  let withdrawalQueue: WithdrawalQueueERC721;

  let queueAdmin: HardhatEthersSigner;
  let stanger: HardhatEthersSigner;
  let oracle: HardhatEthersSigner;

  let originalState: string;
  let provider: typeof ethers.provider;

  let ORACLE_ROLE: string;

  before(async () => {
    ({ provider } = ethers);

    [queueAdmin, stanger, oracle] = await ethers.getSigners();

    const deployed = await deployWithdrawalQueue({
      queueAdmin: queueAdmin,
      doInitialise: false,
    });

    withdrawalQueue = deployed.queue;

    config.stEthAddress = deployed.stEthAddress;
    config.wstEthAddress = deployed.wstEthAddress;
    config.name = deployed.name;
    config.symbol = deployed.symbol;

    ORACLE_ROLE = await withdrawalQueue.ORACLE_ROLE();
  });

  beforeEach(async () => (originalState = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(originalState));

  context("isBunkerModeActive", () => {
    it("Returns true if bunker mode is active", async () => {
      expect(await withdrawalQueue.isBunkerModeActive()).to.equal(true);
    });

    it("Returns false if bunker mode is disabled", async () => {
      await withdrawalQueue.initialize(queueAdmin.address); // Disable bunker mode

      expect(await withdrawalQueue.isBunkerModeActive()).to.equal(false);
    });
  });

  context("bunkerModeSinceTimestamp", () => {
    it("Returns 0 if bunker mode is active", async () => {
      expect(await withdrawalQueue.bunkerModeSinceTimestamp()).to.equal(0);
    });

    it("Returns the timestamp if bunker mode is disabled", async () => {
      await withdrawalQueue.initialize(queueAdmin.address); // Disable bunker mode

      expect(await withdrawalQueue.bunkerModeSinceTimestamp()).to.equal(WITHDRAWAL_BUNKER_MODE_DISABLED_TIMESTAMP);
    });
  });

  context("onOracleReport", () => {
    before(async () => {
      await withdrawalQueue.initialize(queueAdmin.address);
      await withdrawalQueue.grantRole(ORACLE_ROLE, oracle.address);
    });

    it("Reverts if not called by the oracle", async () => {
      await expect(withdrawalQueue.connect(stanger).onOracleReport(true, 0, 0)).to.be.revertedWithOZAccessControlError(
        stanger.address,
        ORACLE_ROLE,
      );
    });

    it("Reverts if the bunker mode start time in future", async () => {
      const futureTimestamp = (await getBlockTimestamp(provider)) + 1000;

      await expect(
        withdrawalQueue.connect(oracle).onOracleReport(true, futureTimestamp, 0),
      ).to.be.revertedWithCustomError(withdrawalQueue, "InvalidReportTimestamp");
    });

    it("Reverts if the current report time in future", async () => {
      const futureTimestamp = (await getBlockTimestamp(provider)) + 1000;

      await expect(
        withdrawalQueue.connect(oracle).onOracleReport(true, 0, futureTimestamp),
      ).to.be.revertedWithCustomError(withdrawalQueue, "InvalidReportTimestamp");
    });

    it("Enables bunker mode and emit `BunkerModeEnabled`", async () => {
      const validTimestamp = await getBlockTimestamp(provider);

      await expect(withdrawalQueue.connect(oracle).onOracleReport(true, validTimestamp, validTimestamp))
        .to.emit(withdrawalQueue, "BunkerModeEnabled")
        .withArgs(validTimestamp);

      expect(await withdrawalQueue.isBunkerModeActive()).to.equal(true);
      expect(await withdrawalQueue.bunkerModeSinceTimestamp()).to.equal(validTimestamp);
    });

    it("Disables bunker mode and emit `BunkerModeDisabled`", async () => {
      const validTimestamp = await getBlockTimestamp(provider);

      await withdrawalQueue.connect(oracle).onOracleReport(true, validTimestamp, validTimestamp);

      await expect(withdrawalQueue.connect(oracle).onOracleReport(false, validTimestamp, validTimestamp + 1)).to.emit(
        withdrawalQueue,
        "BunkerModeDisabled",
      );

      expect(await withdrawalQueue.isBunkerModeActive()).to.equal(false);
      expect(await withdrawalQueue.bunkerModeSinceTimestamp()).to.equal(WITHDRAWAL_BUNKER_MODE_DISABLED_TIMESTAMP);
    });
  });
});
