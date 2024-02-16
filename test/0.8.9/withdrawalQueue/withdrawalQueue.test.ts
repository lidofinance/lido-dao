import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";
import { afterEach } from "mocha";

import { HardhatEthersProvider } from "@nomicfoundation/hardhat-ethers/internal/hardhat-ethers-provider";
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

const getBlockTimestamp = async (provider: HardhatEthersProvider) => {
  const block = await provider.getBlock("latest");
  return block!.timestamp;
};

describe("WithdrawalQueueERC721.sol", () => {
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

  let RESUME_ROLE: string;
  let ORACLE_ROLE: string;

  const getDeployConfig = (config: WithdrawalQueueContractConfig) => [config.wstEthAddress, config.name, config.symbol];

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

    RESUME_ROLE = await withdrawalQueue.RESUME_ROLE();
    ORACLE_ROLE = await withdrawalQueue.ORACLE_ROLE();
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

    it("Reverts if already initialized and in pause", async () => {
      await withdrawalQueue.initialize(queueAdmin.address);

      await expect(withdrawalQueue.initialize(queueAdmin.address)).to.be.revertedWithCustomError(
        withdrawalQueue,
        "ResumedExpected",
      );
    });

    it("Reverts if already initialized and not in pause", async () => {
      await withdrawalQueue.initialize(queueAdmin.address);

      await withdrawalQueue.connect(queueAdmin).grantRole(RESUME_ROLE, queueAdmin.address);
      await withdrawalQueue.connect(queueAdmin).resume();

      await expect(withdrawalQueue.initialize(queueAdmin.address)).to.be.revertedWithCustomError(
        withdrawalQueue,
        "NonZeroContractVersionOnInit",
      );
    });

    it("Sets initial properties", async () => {
      await withdrawalQueue.initialize(queueAdmin.address);

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

  context("Bunker mode", () => {
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
        await expect(
          withdrawalQueue.connect(stanger).onOracleReport(true, 0, 0),
        ).to.be.revertedWithOZAccessControlError(stanger.address, ORACLE_ROLE);
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
});
