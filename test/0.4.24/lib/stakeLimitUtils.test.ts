import { expect } from "chai";
import { ContractTransactionResponse } from "ethers";
import { ethers } from "hardhat";

import { mineUpTo } from "@nomicfoundation/hardhat-network-helpers";
import { latestBlock } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time";

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
        expect(verifyValues.prevStakeBlockNumber).to.be.equal(0n);
        expect(verifyValues.prevStakeLimit).to.be.equal(0n);
        expect(verifyValues.maxStakeLimitGrowthBlocks).to.be.equal(0n);
        expect(verifyValues.maxStakeLimit).to.be.equal(0n);
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
        expect(verifyValues.prevStakeBlockNumber).to.be.equal(MAX_UINT32);
        expect(verifyValues.prevStakeLimit).to.be.equal(MAX_UINT96);
        expect(verifyValues.maxStakeLimitGrowthBlocks).to.be.equal(MAX_UINT32);
        expect(verifyValues.maxStakeLimit).to.be.equal(MAX_UINT96);
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
        expect(verifyValues.prevStakeBlockNumber).to.be.equal(prevStakeBlockNumber);
        expect(verifyValues.prevStakeLimit).to.be.equal(prevStakeLimit);
        expect(verifyValues.maxStakeLimitGrowthBlocks).to.be.equal(maxStakeLimitGrowthBlocks);
        expect(verifyValues.maxStakeLimit).to.be.equal(maxStakeLimit);
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
        expect(values.prevStakeBlockNumber).to.be.equal(0n);
        expect(values.prevStakeLimit).to.be.equal(0n);
        expect(values.maxStakeLimitGrowthBlocks).to.be.equal(0n);
        expect(values.maxStakeLimit).to.be.equal(0n);

        const verifyValues = await stakeLimitUnstructuredStorage.harness__getStorageStakeLimit();
        expect(verifyValues.prevStakeBlockNumber).to.be.equal(0n);
        expect(verifyValues.prevStakeLimit).to.be.equal(0n);
        expect(verifyValues.maxStakeLimitGrowthBlocks).to.be.equal(0n);
        expect(verifyValues.maxStakeLimit).to.be.equal(0n);
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
        expect(values.prevStakeBlockNumber).to.be.equal(MAX_UINT32);
        expect(values.prevStakeLimit).to.be.equal(MAX_UINT96);
        expect(values.maxStakeLimitGrowthBlocks).to.be.equal(MAX_UINT32);
        expect(values.maxStakeLimit).to.be.equal(MAX_UINT96);

        const verifyValues = await stakeLimitUnstructuredStorage.harness__getStorageStakeLimit();
        expect(verifyValues.prevStakeBlockNumber).to.be.equal(MAX_UINT32);
        expect(verifyValues.prevStakeLimit).to.be.equal(MAX_UINT96);
        expect(verifyValues.maxStakeLimitGrowthBlocks).to.be.equal(MAX_UINT32);
        expect(verifyValues.maxStakeLimit).to.be.equal(MAX_UINT96);
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
        expect(values.prevStakeBlockNumber).to.be.equal(prevStakeBlockNumber);
        expect(values.prevStakeLimit).to.be.equal(prevStakeLimit);
        expect(values.maxStakeLimitGrowthBlocks).to.be.equal(maxStakeLimitGrowthBlocks);
        expect(values.maxStakeLimit).to.be.equal(maxStakeLimit);

        const verifyValues = await stakeLimitUnstructuredStorage.harness__getStorageStakeLimit();
        expect(verifyValues.prevStakeBlockNumber).to.be.equal(prevStakeBlockNumber);
        expect(verifyValues.prevStakeLimit).to.be.equal(prevStakeLimit);
        expect(verifyValues.maxStakeLimitGrowthBlocks).to.be.equal(maxStakeLimitGrowthBlocks);
        expect(verifyValues.maxStakeLimit).to.be.equal(maxStakeLimit);
      });
    });
  });

  context("StakeLimitUtils", () => {
    context("calculate", () => {
      it("zero state means zero limit", async () => {
        await stakeLimitUtils.harness_setState(0n, 0n, 0n, 0n);

        expect(await stakeLimitUtils.calculateCurrentStakeLimit()).to.be.equal(0n);
      });

      it("zero block increment means the limit is static", async () => {
        const staticStakeLimit = 1000n * 10n ** 18n;
        const prevStakeBlockNumber1 = 10000n;

        await stakeLimitUtils.harness_setState(prevStakeBlockNumber1, staticStakeLimit, 0n, staticStakeLimit);
        expect(await stakeLimitUtils.calculateCurrentStakeLimit()).to.be.equal(staticStakeLimit);

        const prevStakeBlockNumber2 = 11000n;
        await stakeLimitUtils.harness_setState(prevStakeBlockNumber2, staticStakeLimit, 0n, staticStakeLimit);
        expect(await stakeLimitUtils.calculateCurrentStakeLimit()).to.be.equal(staticStakeLimit);

        await mineUpTo(123n + BigInt(await latestBlock()));
        expect(await stakeLimitUtils.calculateCurrentStakeLimit()).to.be.equal(staticStakeLimit);
      });

      it("restore the full limit", async () => {
        const prevStakeBlockNumber1 = await latestBlock();
        const prevStakeLimit = 0n;
        const maxStakeLimit = 6n * 10n ** 18n;
        const maxStakeLimitGrowthBlocks = 101n;

        await stakeLimitUtils.harness_setState(
          prevStakeBlockNumber1,
          prevStakeLimit,
          maxStakeLimitGrowthBlocks,
          maxStakeLimit,
        );
        // 1 block passed due to the setter call above
        expect(await stakeLimitUtils.calculateCurrentStakeLimit()).to.be.equal(
          maxStakeLimit / maxStakeLimitGrowthBlocks,
        );

        // growth blocks passed (might be not equal to maxStakeLimit yet due to rounding)
        await mineUpTo(BigInt(prevStakeBlockNumber1) + maxStakeLimitGrowthBlocks);
        expect(await stakeLimitUtils.calculateCurrentStakeLimit()).to.be.equal(
          prevStakeLimit + maxStakeLimitGrowthBlocks * (maxStakeLimit / maxStakeLimitGrowthBlocks),
        );

        // move forward one more block to account for rounding and reach max
        await mineUpTo(BigInt(prevStakeBlockNumber1) + maxStakeLimitGrowthBlocks + 1n);
        // growth blocks mined, the limit should be full
        expect(await stakeLimitUtils.calculateCurrentStakeLimit()).to.be.equal(maxStakeLimit);
      });
    });

    context("pause", () => {});

    context("set", () => {});

    context("remove", () => {});

    context("update", () => {});
  });
});
