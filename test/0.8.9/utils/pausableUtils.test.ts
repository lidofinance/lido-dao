import { expect } from "chai";
import { ethers } from "hardhat";

import { PausableUntilMockWithExposedApi } from "typechain-types";

import { getBlockTimestamp, MAX_UINT256 } from "lib";

describe("PausableUtils", () => {
  let pausable: PausableUntilMockWithExposedApi;

  beforeEach(async () => {
    pausable = await ethers.deployContract("PausableUntilMockWithExposedApi");
  });

  context("Constants", () => {
    it("Returns the PAUSE_INFINITELY variable", async () => {
      expect(await pausable.PAUSE_INFINITELY()).to.equal(MAX_UINT256);
    });
  });

  context("isPaused", () => {
    it("Returns false if not paused", async () => {
      expect(await pausable.isPaused()).to.equal(false);
    });

    it("Returns true if paused", async () => {
      await expect(pausable.pauseFor(1000n)).to.emit(pausable, "Paused");

      expect(await pausable.isPaused()).to.equal(true);
    });
  });

  context("getResumeSinceTimestamp", () => {
    it("Returns 0 if contract is paused", async () => {
      expect(await pausable.getResumeSinceTimestamp()).to.equal(0);
    });

    it("Returns the duration since the contract was paused", async () => {
      await pausable.pauseFor(1000n);

      const blockTimestamp = await getBlockTimestamp(ethers.provider);

      expect(await pausable.getResumeSinceTimestamp()).to.equal(blockTimestamp + 1000);
    });
  });

  context("pauseFor", () => {
    it("Reverts if contract is already paused", async () => {
      await expect(pausable.pauseFor(1000n)).to.emit(pausable, "Paused");

      await expect(pausable.pauseFor(1000n)).to.be.revertedWithCustomError(pausable, "ResumedExpected");
    });

    it("Reverts if zero pause duration", async () => {
      await expect(pausable.pauseFor(0)).to.be.revertedWithCustomError(pausable, "ZeroPauseDuration");
    });

    it("Pauses contract correctly and emits `Paused` event", async () => {
      await expect(pausable.pauseFor(404n)).to.emit(pausable, "Paused").withArgs(404n);
    });

    it("Pauses contract to MAX_UINT256 and emits `Paused` event", async () => {
      await expect(pausable.pauseFor(MAX_UINT256)).to.emit(pausable, "Paused").withArgs(MAX_UINT256);
    });
  });

  context("pauseUntil", () => {
    it("Reverts if contract is already paused", async () => {
      await expect(pausable.pauseFor(1000n)).to.emit(pausable, "Paused");

      await expect(pausable.pauseFor(1000n)).to.be.revertedWithCustomError(pausable, "ResumedExpected");
    });

    it("Reverts if timestamp is in the past", async () => {
      await expect(pausable.pauseUntil(0)).to.be.revertedWithCustomError(pausable, "PauseUntilMustBeInFuture");
    });

    it("Pauses contract correctly and emits `Paused` event", async () => {
      const blockTimestamp = await getBlockTimestamp(ethers.provider);

      await expect(pausable.pauseUntil(blockTimestamp + 1000))
        .to.emit(pausable, "Paused")
        .withArgs(1000n);
    });

    it("Pauses contract to MAX_UINT256 and emits `Paused` event", async () => {
      await expect(pausable.pauseUntil(MAX_UINT256)).to.emit(pausable, "Paused").withArgs(MAX_UINT256);
    });
  });

  context("resume", async () => {
    it("Reverts if contract is not paused", async () => {
      await expect(pausable.resume()).to.be.revertedWithCustomError(pausable, "PausedExpected");
    });

    it("Resumes the contract", async () => {
      await expect(pausable.pauseFor(1000n)).to.emit(pausable, "Paused");

      await expect(pausable.resume()).to.emit(pausable, "Resumed");
      expect(await pausable.isPaused()).to.equal(false);
    });

    it("Reverts if already resumed", async () => {
      await expect(pausable.pauseFor(1000n)).to.emit(pausable, "Paused");

      await expect(pausable.resume()).to.emit(pausable, "Resumed");

      await expect(pausable.resume()).to.be.revertedWithCustomError(pausable, "PausedExpected");
      expect(await pausable.isPaused()).to.equal(false);
    });
  });

  context("Modifiers", () => {
    context("whenPaused", () => {
      it("Reverts if contract is not paused", async () => {
        await expect(pausable.testWhenPaused()).to.be.revertedWithCustomError(pausable, "PausedExpected");
      });

      it("Does not revert if contract is paused", async () => {
        await expect(pausable.pauseFor(1000n)).to.emit(pausable, "Paused");

        await expect(pausable.testWhenPaused()).to.not.be.reverted;
      });
    });

    context("whenResumed", () => {
      it("Reverts if contract is paused", async () => {
        await expect(pausable.pauseFor(1000n)).to.emit(pausable, "Paused");

        await expect(pausable.testWhenResumed()).to.be.revertedWithCustomError(pausable, "ResumedExpected");
      });

      it("Does not revert if contract is not paused", async () => {
        await expect(pausable.testWhenResumed()).to.not.be.reverted;
      });
    });
  });
});
