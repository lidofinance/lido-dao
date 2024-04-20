import { expect } from "chai";
import { ContractTransactionResponse } from "ethers";
import { ethers } from "hardhat";

import { StakeLimitUnstructuredStorage__Harness, StakeLimitUtils__Harness } from "typechain-types";

import { Snapshot } from "lib";

describe("StakeLimitUtils.sol", () => {
  let stakeLimitUnstructuredStorage: StakeLimitUnstructuredStorage__Harness;
  let stakeLimitUtils: StakeLimitUtils__Harness;

  let originalState: string;

  before(async () => {
    stakeLimitUnstructuredStorage = await ethers.deployContract("StakeLimitUnstructuredStorage__Harness");
    stakeLimitUtils = await ethers.deployContract("StakeLimitUtils__Harness");
  });

  beforeEach(async () => (originalState = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(originalState));

  context("StakeLimitUnstructuredStorage", () => {
    context("setStorageStakeLimitStruct", () => {
      it("Min possible values", async () => {
        const tx: ContractTransactionResponse = await stakeLimitUnstructuredStorage.setStorageStakeLimit(
          0n,
          0n,
          0n,
          0n,
        );
        await expect(tx).to.emit(stakeLimitUnstructuredStorage, "DataSet").withArgs(0n, 0n, 0n, 0n);

        const verifyValues = await stakeLimitUnstructuredStorage.harness__getStorageStakeLimit();
        await expect(verifyValues.prevStakeBlockNumber).to.be.equal(0n);
        await expect(verifyValues.prevStakeLimit).to.be.equal(0n);
        await expect(verifyValues.maxStakeLimitGrowthBlocks).to.be.equal(0n);
        await expect(verifyValues.maxStakeLimit).to.be.equal(0n);
      });

      it("Max possible values", async () => {
        const MAX_UINT32: bigint = 2n ** 32n - 1n;
        const MAX_UINT96: bigint = 2n ** 96n - 1n;

        const tx: ContractTransactionResponse = await stakeLimitUnstructuredStorage.setStorageStakeLimit(
          MAX_UINT32,
          MAX_UINT96,
          MAX_UINT32,
          MAX_UINT96,
        );
        await expect(tx)
          .to.emit(stakeLimitUnstructuredStorage, "DataSet")
          .withArgs(MAX_UINT32, MAX_UINT96, MAX_UINT32, MAX_UINT96);

        const verifyValues = await stakeLimitUnstructuredStorage.harness__getStorageStakeLimit();
        await expect(verifyValues.prevStakeBlockNumber).to.be.equal(MAX_UINT32);
        await expect(verifyValues.prevStakeLimit).to.be.equal(MAX_UINT96);
        await expect(verifyValues.maxStakeLimitGrowthBlocks).to.be.equal(MAX_UINT32);
        await expect(verifyValues.maxStakeLimit).to.be.equal(MAX_UINT96);
      });

      it("Arbitrary valid values", async () => {
        const prevStakeBlockNumber: bigint = 19698885n;
        const prevStakeLimit: bigint = 12345n * 10n ** 18n;
        const maxStakeLimitGrowthBlocks: bigint = 6789n;
        const maxStakeLimit: bigint = 902134n * 10n ** 18n;

        const tx: ContractTransactionResponse = await stakeLimitUnstructuredStorage.setStorageStakeLimit(
          prevStakeBlockNumber,
          prevStakeLimit,
          maxStakeLimitGrowthBlocks,
          maxStakeLimit,
        );
        await expect(tx)
          .to.emit(stakeLimitUnstructuredStorage, "DataSet")
          .withArgs(prevStakeBlockNumber, prevStakeLimit, maxStakeLimitGrowthBlocks, maxStakeLimit);

        const verifyValues = await stakeLimitUnstructuredStorage.harness__getStorageStakeLimit();
        await expect(verifyValues.prevStakeBlockNumber).to.be.equal(prevStakeBlockNumber);
        await expect(verifyValues.prevStakeLimit).to.be.equal(prevStakeLimit);
        await expect(verifyValues.maxStakeLimitGrowthBlocks).to.be.equal(maxStakeLimitGrowthBlocks);
        await expect(verifyValues.maxStakeLimit).to.be.equal(maxStakeLimit);
      });
    });

    context("getStorageStakeLimitStruct", () => {
      it("Min possible values", async () => {
        const tx: ContractTransactionResponse = await stakeLimitUnstructuredStorage.harness__setStorageStakeLimit(
          0n,
          0n,
          0n,
          0n,
        );
        await expect(tx).to.emit(stakeLimitUnstructuredStorage, "DataSet").withArgs(0n, 0n, 0n, 0n);

        const values = await stakeLimitUnstructuredStorage.getStorageStakeLimit();
        await expect(values.prevStakeBlockNumber).to.be.equal(0n);
        await expect(values.prevStakeLimit).to.be.equal(0n);
        await expect(values.maxStakeLimitGrowthBlocks).to.be.equal(0n);
        await expect(values.maxStakeLimit).to.be.equal(0n);

        const verifyValues = await stakeLimitUnstructuredStorage.harness__getStorageStakeLimit();
        await expect(verifyValues.prevStakeBlockNumber).to.be.equal(0n);
        await expect(verifyValues.prevStakeLimit).to.be.equal(0n);
        await expect(verifyValues.maxStakeLimitGrowthBlocks).to.be.equal(0n);
        await expect(verifyValues.maxStakeLimit).to.be.equal(0n);
      });

      it("Max possible values", async () => {
        const MAX_UINT32: bigint = 2n ** 32n - 1n;
        const MAX_UINT96: bigint = 2n ** 96n - 1n;

        const tx: ContractTransactionResponse = await stakeLimitUnstructuredStorage.harness__setStorageStakeLimit(
          MAX_UINT32,
          MAX_UINT96,
          MAX_UINT32,
          MAX_UINT96,
        );
        await expect(tx)
          .to.emit(stakeLimitUnstructuredStorage, "DataSet")
          .withArgs(MAX_UINT32, MAX_UINT96, MAX_UINT32, MAX_UINT96);

        const values = await stakeLimitUnstructuredStorage.getStorageStakeLimit();
        await expect(values.prevStakeBlockNumber).to.be.equal(MAX_UINT32);
        await expect(values.prevStakeLimit).to.be.equal(MAX_UINT96);
        await expect(values.maxStakeLimitGrowthBlocks).to.be.equal(MAX_UINT32);
        await expect(values.maxStakeLimit).to.be.equal(MAX_UINT96);

        const verifyValues = await stakeLimitUnstructuredStorage.harness__getStorageStakeLimit();
        await expect(verifyValues.prevStakeBlockNumber).to.be.equal(MAX_UINT32);
        await expect(verifyValues.prevStakeLimit).to.be.equal(MAX_UINT96);
        await expect(verifyValues.maxStakeLimitGrowthBlocks).to.be.equal(MAX_UINT32);
        await expect(verifyValues.maxStakeLimit).to.be.equal(MAX_UINT96);
      });

      it("Arbitrary valid values", async () => {
        const prevStakeBlockNumber: bigint = 18787654n;
        const prevStakeLimit: bigint = 23451n * 10n ** 18n;
        const maxStakeLimitGrowthBlocks: bigint = 7896n;
        const maxStakeLimit: bigint = 209431n * 10n ** 18n;

        const tx: ContractTransactionResponse = await stakeLimitUnstructuredStorage.harness__setStorageStakeLimit(
          prevStakeBlockNumber,
          prevStakeLimit,
          maxStakeLimitGrowthBlocks,
          maxStakeLimit,
        );
        await expect(tx)
          .to.emit(stakeLimitUnstructuredStorage, "DataSet")
          .withArgs(prevStakeBlockNumber, prevStakeLimit, maxStakeLimitGrowthBlocks, maxStakeLimit);

        const values = await stakeLimitUnstructuredStorage.getStorageStakeLimit();
        await expect(values.prevStakeBlockNumber).to.be.equal(prevStakeBlockNumber);
        await expect(values.prevStakeLimit).to.be.equal(prevStakeLimit);
        await expect(values.maxStakeLimitGrowthBlocks).to.be.equal(maxStakeLimitGrowthBlocks);
        await expect(values.maxStakeLimit).to.be.equal(maxStakeLimit);

        const verifyValues = await stakeLimitUnstructuredStorage.harness__getStorageStakeLimit();
        await expect(verifyValues.prevStakeBlockNumber).to.be.equal(prevStakeBlockNumber);
        await expect(verifyValues.prevStakeLimit).to.be.equal(prevStakeLimit);
        await expect(verifyValues.maxStakeLimitGrowthBlocks).to.be.equal(maxStakeLimitGrowthBlocks);
        await expect(verifyValues.maxStakeLimit).to.be.equal(maxStakeLimit);
      });
    });
  });

  context("StakeLimitUtils", () => {
    context("calculate", () => {
      expect(stakeLimitUtils).not.to.be.undefined; //DUMMY
    });

    context("pause", () => {});

    context("set", () => {});

    context("remove", () => {});

    context("update", () => {});
  });
});
