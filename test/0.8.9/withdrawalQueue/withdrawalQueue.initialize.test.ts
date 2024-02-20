import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";
import { afterEach } from "mocha";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { WithdrawalQueueERC721 } from "typechain-types";

import {
  DEFAULT_ADMIN_ROLE,
  deployWithdrawalQueue,
  Snapshot,
  WITHDRAWAL_BUNKER_MODE_DISABLED_TIMESTAMP,
  WITHDRAWAL_FINALIZE_ROLE,
  WITHDRAWAL_MANAGE_TOKEN_URI_ROLE,
  WITHDRAWAL_MAX_BATCHES_LENGTH,
  WITHDRAWAL_MAX_STETH_WITHDRAWAL_AMOUNT,
  WITHDRAWAL_MIN_STETH_WITHDRAWAL_AMOUNT,
  WITHDRAWAL_ORACLE_ROLE,
  WITHDRAWAL_PAUSE_ROLE,
  WITHDRAWAL_RESUME_ROLE,
} from "lib";

interface WithdrawalQueueContractConfig {
  stEthAddress: string;
  wstEthAddress: string;
  name: string;
  symbol: string;
}

const ZERO = 0n;

describe("WithdrawalQueueERC721:initialize", () => {
  const config: WithdrawalQueueContractConfig = {
    stEthAddress: "",
    wstEthAddress: "",
    name: "",
    symbol: "",
  };

  let withdrawalQueue: WithdrawalQueueERC721;

  let queueAdmin: HardhatEthersSigner;

  let originalState: string;

  let RESUME_ROLE: string;

  const getDeployConfig = (config: WithdrawalQueueContractConfig) => [config.wstEthAddress, config.name, config.symbol];

  before(async () => {
    [queueAdmin] = await ethers.getSigners();

    const deployed = await deployWithdrawalQueue({
      queueAdmin: queueAdmin,
      doInitialise: false,
    });

    withdrawalQueue = deployed.queue;

    config.stEthAddress = deployed.stEthAddress;
    config.wstEthAddress = deployed.wstEthAddress;
    config.name = deployed.name;
    config.symbol = deployed.symbol;

    RESUME_ROLE = await withdrawalQueue.RESUME_ROLE();
  });

  beforeEach(async () => (originalState = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(originalState));

  context("Constants", () => {
    // WithdrawalQueueBase

    it("Returns the MAX_BATCHES_LENGTH variable", async () => {
      expect(await withdrawalQueue.MAX_BATCHES_LENGTH()).to.equal(WITHDRAWAL_MAX_BATCHES_LENGTH);
    });

    // WithdrawalQueue

    it("Returns ths BUNKER_MODE_DISABLED_TIMESTAMP variable", async () => {
      expect(await withdrawalQueue.BUNKER_MODE_DISABLED_TIMESTAMP()).to.equal(
        WITHDRAWAL_BUNKER_MODE_DISABLED_TIMESTAMP,
      );
    });

    it("Returns ACL variables", async () => {
      expect(await withdrawalQueue.DEFAULT_ADMIN_ROLE()).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await withdrawalQueue.PAUSE_ROLE()).to.equal(WITHDRAWAL_PAUSE_ROLE);
      expect(await withdrawalQueue.RESUME_ROLE()).to.equal(WITHDRAWAL_RESUME_ROLE);
      expect(await withdrawalQueue.FINALIZE_ROLE()).to.equal(WITHDRAWAL_FINALIZE_ROLE);
      expect(await withdrawalQueue.ORACLE_ROLE()).to.equal(WITHDRAWAL_ORACLE_ROLE);
    });

    it("Returns the MIN_STETH_WITHDRAWAL_AMOUNT variable", async () => {
      expect(await withdrawalQueue.MIN_STETH_WITHDRAWAL_AMOUNT()).to.equal(WITHDRAWAL_MIN_STETH_WITHDRAWAL_AMOUNT);
    });

    it("Returns the MAX_STETH_WITHDRAWAL_AMOUNT variable", async () => {
      expect(await withdrawalQueue.MAX_STETH_WITHDRAWAL_AMOUNT()).to.equal(WITHDRAWAL_MAX_STETH_WITHDRAWAL_AMOUNT);
    });

    it("Returns the STETH address", async () => {
      expect(await withdrawalQueue.STETH()).to.equal(config.stEthAddress);
    });

    it("Returns the WSTETH address", async () => {
      expect(await withdrawalQueue.WSTETH()).to.equal(config.wstEthAddress);
    });

    // WithdrawalQueueERC721

    it("Returns the MANAGE_TOKEN_URI_ROLE variable", async () => {
      expect(await withdrawalQueue.MANAGE_TOKEN_URI_ROLE()).to.equal(WITHDRAWAL_MANAGE_TOKEN_URI_ROLE);
    });
  });

  context("constructor", () => {
    it("Reverts if wstAddress is wrong", async () => {
      const deployConfig = getDeployConfig({ ...config, wstEthAddress: ZeroAddress });

      await expect(ethers.deployContract("WithdrawalQueueERC721", deployConfig)).to.be.revertedWithoutReason();
    });

    it("Reverts if name is empty", async () => {
      const deployConfig = getDeployConfig({ ...config, name: "" });

      await expect(ethers.deployContract("WithdrawalQueueERC721", deployConfig)).to.be.revertedWithCustomError(
        withdrawalQueue,
        "ZeroMetadata",
      );
    });

    it("Reverts if symbol is empty", async () => {
      const deployConfig = getDeployConfig({ ...config, symbol: "" });

      await expect(ethers.deployContract("WithdrawalQueueERC721", deployConfig)).to.be.revertedWithCustomError(
        withdrawalQueue,
        "ZeroMetadata",
      );
    });

    it("Sets the name and symbol", async () => {
      expect(await withdrawalQueue.name()).to.equal(config.name, "name");
      expect(await withdrawalQueue.symbol()).to.equal(config.symbol, "symbol");
    });

    it("Sets the WSTETH and STETH addresses", async () => {
      expect(await withdrawalQueue.WSTETH()).to.equal(config.wstEthAddress, "WSTETH");
      expect(await withdrawalQueue.STETH()).to.equal(config.stEthAddress, "STETH");
    });

    it("Sets initial properties", async () => {
      expect(await withdrawalQueue.isPaused()).to.equal(false, "isPaused");
      expect(await withdrawalQueue.getLastRequestId()).to.equal(ZERO, "getLastRequestId");
      expect(await withdrawalQueue.getLastFinalizedRequestId()).to.equal(ZERO, "getLastFinalizedRequestId");
      expect(await withdrawalQueue.getLastCheckpointIndex()).to.equal(ZERO, "getLastCheckpointIndex");
      expect(await withdrawalQueue.unfinalizedStETH()).to.equal(ZERO, "unfinalizedStETH");
      expect(await withdrawalQueue.unfinalizedRequestNumber()).to.equal(ZERO, "unfinalizedRequestNumber");
      expect(await withdrawalQueue.getLockedEtherAmount()).to.equal(ZERO, "getLockedEtherAmount");
    });

    it("Enables bunker mode", async () => {
      expect(await withdrawalQueue.isBunkerModeActive()).to.equal(true, "isBunkerModeActive");
      expect(await withdrawalQueue.bunkerModeSinceTimestamp()).to.equal(0, "bunkerModeSinceTimestamp");
    });
  });

  context("initialize", () => {
    it("Reverts if initialized with zero address", async () => {
      await expect(withdrawalQueue.initialize(ZeroAddress)).to.be.revertedWithCustomError(
        withdrawalQueue,
        "AdminZeroAddress",
      );
    });

    it("Reverts if already initialized", async () => {
      await withdrawalQueue.initialize(queueAdmin.address);

      await expect(withdrawalQueue.initialize(queueAdmin.address)).to.be.revertedWithCustomError(
        withdrawalQueue,
        "ResumedExpected",
      );

      await withdrawalQueue.connect(queueAdmin).grantRole(RESUME_ROLE, queueAdmin.address);
      await withdrawalQueue.connect(queueAdmin).resume();

      await expect(withdrawalQueue.initialize(queueAdmin.address)).to.be.revertedWithCustomError(
        withdrawalQueue,
        "NonZeroContractVersionOnInit",
      );
    });

    it("Sets initial properties and emits `InitializedV1`", async () => {
      await expect(withdrawalQueue.initialize(queueAdmin.address))
        .to.emit(withdrawalQueue, "InitializedV1")
        .withArgs(queueAdmin.address);

      expect(await withdrawalQueue.getContractVersion()).to.equal(1n, "getContractVersion");
      expect(await withdrawalQueue.getLastRequestId()).to.equal(ZERO, "getLastRequestId");
      expect(await withdrawalQueue.getLastFinalizedRequestId()).to.equal(ZERO, "getLastFinalizedRequestId");
      expect(await withdrawalQueue.getLastCheckpointIndex()).to.equal(ZERO, "getLastCheckpointIndex");
      expect(await withdrawalQueue.unfinalizedStETH()).to.equal(ZERO, "unfinalizedStETH");
      expect(await withdrawalQueue.unfinalizedRequestNumber()).to.equal(ZERO, "unfinalizedRequestNumber");
      expect(await withdrawalQueue.getLockedEtherAmount()).to.equal(ZERO, "getLockedEtherAmount");
    });

    it("Pause the contract", async () => {
      await withdrawalQueue.initialize(queueAdmin.address);

      expect(await withdrawalQueue.isPaused()).to.equal(true, "isPaused");
    });

    it("Disables bunker mode", async () => {
      await withdrawalQueue.initialize(queueAdmin.address);

      const TS = await withdrawalQueue.BUNKER_MODE_DISABLED_TIMESTAMP();

      expect(await withdrawalQueue.isBunkerModeActive()).to.equal(false, "isBunkerModeActive");
      expect(await withdrawalQueue.bunkerModeSinceTimestamp()).to.equal(TS, "bunkerModeSinceTimestamp");
    });
  });
});
