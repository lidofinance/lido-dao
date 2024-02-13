import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { WithdrawalQueueERC721 } from "typechain-types";

import { MAX_UINT256, Snapshot, streccak } from "lib";

import deployWithdrawalQueue from "./deploy";

interface WithdrawalQueueContractACLRolesConstants {
  PAUSE_ROLE: string;
  RESUME_ROLE: string;
  FINALIZE_ROLE: string;
  ORACLE_ROLE: string;
}

interface WithdrawalQueueContractConstants {
  // WithdrawalQueueBase
  MAX_BATCHES_LENGTH: bigint;
  // WithdrawalQueue
  BUNKER_MODE_DISABLED_TIMESTAMP: bigint;
  ACL: WithdrawalQueueContractACLRolesConstants;
  MIN_STETH_WITHDRAWAL_AMOUNT: bigint;
  MAX_STETH_WITHDRAWAL_AMOUNT: bigint;
  // WithdrawalQueueERC721
  MANAGE_TOKEN_URI_ROLE: string;
}

interface WithdrawalQueueContractConfig {
  stEthAddress: string;
  wstEthAddress: string;
  name: string;
  symbol: string;
  CONSTANT: WithdrawalQueueContractConstants;
}

const ZERO = 0n;

describe("WithdrawalQueueERC721.sol", () => {
  const config: WithdrawalQueueContractConfig = {
    stEthAddress: "",
    wstEthAddress: "",
    name: "",
    symbol: "",
    CONSTANT: {
      MAX_BATCHES_LENGTH: 36n,
      BUNKER_MODE_DISABLED_TIMESTAMP: MAX_UINT256,
      MIN_STETH_WITHDRAWAL_AMOUNT: 100n,
      MAX_STETH_WITHDRAWAL_AMOUNT: 10n ** 21n, // 1000 * 1e18
      ACL: {
        PAUSE_ROLE: streccak("PAUSE_ROLE"),
        RESUME_ROLE: streccak("RESUME_ROLE"),
        FINALIZE_ROLE: streccak("FINALIZE_ROLE"),
        ORACLE_ROLE: streccak("ORACLE_ROLE"),
      },
      MANAGE_TOKEN_URI_ROLE: streccak("MANAGE_TOKEN_URI_ROLE"),
    },
  };

  let wq: WithdrawalQueueERC721;

  let admin: HardhatEthersSigner;

  const getDeployConfig = (config: WithdrawalQueueContractConfig) => [config.wstEthAddress, config.name, config.symbol];

  before(async () => {
    [admin] = await ethers.getSigners();

    const deployed = await deployWithdrawalQueue({ owner: admin });

    wq = deployed.token;

    config.stEthAddress = deployed.stEthAddress;
    config.wstEthAddress = deployed.wstEthAddress;
    config.name = deployed.name;
    config.symbol = deployed.symbol;
  });

  context("Constants", () => {
    let originalState: string;

    beforeEach(async () => (originalState = await Snapshot.take()));
    afterEach(async () => await Snapshot.restore(originalState));

    // WithdrawalQueueBase

    it("Returns the MAX_BATCHES_LENGTH variable", async () => {
      expect(await wq.MAX_BATCHES_LENGTH()).to.equal(config.CONSTANT.MAX_BATCHES_LENGTH);
    });

    // WithdrawalQueue

    it("Returns ths BUNKER_MODE_DISABLED_TIMESTAMP variable", async () => {
      expect(await wq.BUNKER_MODE_DISABLED_TIMESTAMP()).to.equal(config.CONSTANT.BUNKER_MODE_DISABLED_TIMESTAMP);
    });

    it("Returns ACL variables", async () => {
      expect(await wq.PAUSE_ROLE()).to.equal(config.CONSTANT.ACL.PAUSE_ROLE);
      expect(await wq.RESUME_ROLE()).to.equal(config.CONSTANT.ACL.RESUME_ROLE);
      expect(await wq.FINALIZE_ROLE()).to.equal(config.CONSTANT.ACL.FINALIZE_ROLE);
      expect(await wq.ORACLE_ROLE()).to.equal(config.CONSTANT.ACL.ORACLE_ROLE);
    });

    it("Returns the MIN_STETH_WITHDRAWAL_AMOUNT variable", async () => {
      expect(await wq.MIN_STETH_WITHDRAWAL_AMOUNT()).to.equal(config.CONSTANT.MIN_STETH_WITHDRAWAL_AMOUNT);
    });

    it("Returns the MAX_STETH_WITHDRAWAL_AMOUNT variable", async () => {
      expect(await wq.MAX_STETH_WITHDRAWAL_AMOUNT()).to.equal(config.CONSTANT.MAX_STETH_WITHDRAWAL_AMOUNT);
    });

    it("Returns the STETH address", async () => {
      expect(await wq.STETH()).to.equal(config.stEthAddress);
    });

    it("Returns the WSTETH address", async () => {
      expect(await wq.WSTETH()).to.equal(config.wstEthAddress);
    });

    // WithdrawalQueueERC721

    it("Returns the MANAGE_TOKEN_URI_ROLE variable", async () => {
      expect(await wq.MANAGE_TOKEN_URI_ROLE()).to.equal(config.CONSTANT.MANAGE_TOKEN_URI_ROLE);
    });
  });

  context("constructor", () => {
    let originalState: string;

    beforeEach(async () => (originalState = await Snapshot.take()));
    afterEach(async () => await Snapshot.restore(originalState));

    it("Reverts if wstAddress is wrong", async () => {
      await expect(
        ethers.deployContract(
          "WithdrawalQueueERC721",
          getDeployConfig({
            ...config,
            wstEthAddress: ZeroAddress,
          }),
        ),
      ).to.be.revertedWithoutReason();
    });

    it("Reverts if name is empty", async () => {
      await expect(
        ethers.deployContract(
          "WithdrawalQueueERC721",
          getDeployConfig({
            ...config,
            name: "",
          }),
        ),
      ).to.be.revertedWithCustomError(wq, "ZeroMetadata");
    });

    it("Reverts if symbol is empty", async () => {
      await expect(
        ethers.deployContract(
          "WithdrawalQueueERC721",
          getDeployConfig({
            ...config,
            symbol: "",
          }),
        ),
      ).to.be.revertedWithCustomError(wq, "ZeroMetadata");
    });

    it("Sets the name and symbol", async () => {
      expect(await wq.name()).to.equal(config.name, "name");
      expect(await wq.symbol()).to.equal(config.symbol, "symbol");
    });

    it("Sets initial properties", async () => {
      expect(await wq.isPaused()).to.equal(false, "isPaused");
      // expect(await wq.getLastRequestId()).to.equal(ZERO, "getLastRequestId");
      expect(await wq.getLastFinalizedRequestId()).to.equal(ZERO, "getLastFinalizedRequestId");
      expect(await wq.getLastCheckpointIndex()).to.equal(ZERO, "getLastCheckpointIndex");
      expect(await wq.unfinalizedStETH()).to.equal(ZERO, "unfinalizedStETH");
      expect(await wq.unfinalizedRequestNumber()).to.equal(ZERO, "unfinalizedRequestNumber");
      expect(await wq.getLockedEtherAmount()).to.equal(ZERO, "getLockedEtherAmount");
    });
  });
});
