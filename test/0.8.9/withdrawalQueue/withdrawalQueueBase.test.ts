import { expect } from "chai";
import { parseUnits } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";

import { ReceiverMock, WithdrawalsQueueBaseHarness } from "typechain-types";

import { ether, getBlockTimestamp, shareRate, shares, Snapshot, WITHDRAWAL_MAX_BATCHES_LENGTH } from "lib";

const buildBatchCalculationState = (...args: unknown[]) => ({
  remainingEthBudget: args[0] as bigint,
  finished: args[1] as boolean,
  batches: args[2] as number[],
  batchesLength: args[3] as number,
});

const MAX_BATCHES = Number(WITHDRAWAL_MAX_BATCHES_LENGTH);

describe("WithdrawalQueueBase", () => {
  let owner: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  let queue: WithdrawalsQueueBaseHarness;
  let receiver: ReceiverMock;

  let originalState: string;
  let provider: typeof ethers.provider;

  beforeEach(async () => {
    ({ provider } = ethers);
    [owner, stranger] = await ethers.getSigners();

    queue = await ethers.deployContract("WithdrawalsQueueBaseHarness");
    receiver = await ethers.deployContract("ReceiverMock");
  });

  beforeEach(async () => (originalState = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(originalState));

  context("getLastRequestId", () => {
    it("Returns 0 if no requests in the queue", async () => {
      expect(await queue.getLastRequestId()).to.equal(0);
    });

    it("Returns the last request id in case queue is not empty", async () => {
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);

      expect(await queue.getLastRequestId()).to.equal(1);
    });
  });

  context("getLastFinalizedRequestId", () => {
    it("Returns 0 if no requests in the queue", async () => {
      expect(await queue.getLastFinalizedRequestId()).to.equal(0);
    });

    it("Returns the last finalized request id in case queue is not empty", async () => {
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);
      await queue.exposedFinalize(1, ether("1.00"), shareRate(1n));

      expect(await queue.getLastFinalizedRequestId()).to.equal(1);
    });
  });

  context("getLockedEtherAmount", () => {
    it("Returns 0 if no requests in the queue", async () => {
      expect(await queue.getLockedEtherAmount()).to.equal(0);
    });

    it("Returns the locked ether amount in case queue is not empty", async () => {
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);
      await queue.exposedFinalize(1, ether("1.00"), shareRate(1n));

      expect(await queue.getLockedEtherAmount()).to.equal(ether("1.00"));
    });
  });

  context("getLastCheckpointIndex", () => {
    it("Returns 0 if no requests in the queue", async () => {
      expect(await queue.getLastCheckpointIndex()).to.equal(0);
    });

    it("Returns the last checkpoint index in case queue is not empty", async () => {
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);
      await queue.exposedFinalize(1, ether("1.00"), shareRate(1n));

      expect(await queue.getLastCheckpointIndex()).to.equal(1);
    });
  });

  context("unfinalizedRequestNumber", () => {
    it("Returns 0 if no requests in the queue", async () => {
      expect(await queue.unfinalizedRequestNumber()).to.equal(0);
    });

    it("Returns the number of unfinalized requests in case queue is not empty", async () => {
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);
      await queue.exposedEnqueue(ether("2.00"), shares(2n), owner);

      expect(await queue.unfinalizedRequestNumber()).to.equal(2);
    });
  });

  context("unfinalizedStETH", () => {
    it("Returns 0 if no requests in the queue", async () => {
      expect(await queue.unfinalizedStETH()).to.equal(0);
    });

    it("Returns the amount of unfinalized stETH in case queue is not empty", async () => {
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);
      await queue.exposedEnqueue(ether("2.00"), shares(2n), owner);

      expect(await queue.unfinalizedStETH()).to.equal(shares(3n));
    });
  });

  context("calculateFinalizationBatches", () => {
    it("Reverts on invalid state", async () => {
      await expect(
        queue.calculateFinalizationBatches(
          shareRate(300n),
          100000,
          1000,
          buildBatchCalculationState(ether("10.00"), true, Array(MAX_BATCHES).fill(0n), 0),
        ),
      ).to.be.revertedWithCustomError(queue, "InvalidState");

      await expect(
        queue.calculateFinalizationBatches(
          shareRate(300n),
          100000,
          1000,
          buildBatchCalculationState(0, false, Array(MAX_BATCHES).fill(0n), 36),
        ),
      ).to.be.revertedWithCustomError(queue, "InvalidState");
    });

    it("Stops on max timestamp", async () => {
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);

      const timestamp = await getBlockTimestamp(provider);

      const calc = await queue.calculateFinalizationBatches(
        shareRate(1n),
        timestamp - 1,
        1,
        buildBatchCalculationState(ether("2.00"), false, Array(MAX_BATCHES).fill(0n), 0),
      );

      expect(calc.finished).to.equal(true, "calc->finished");
      expect(calc.batchesLength).to.equal(0, "calc->batchesLength");
    });

    it("Works correctly on multiple calls", async () => {
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);

      const calc1 = await queue.calculateFinalizationBatches(
        shareRate(1n),
        10000000000,
        1,
        buildBatchCalculationState(ether("2.00"), false, Array(MAX_BATCHES).fill(0n), 0),
      );

      expect(calc1.remainingEthBudget).to.equal(ether("1.00"), "calc1->remainingEthBudget");
      expect(calc1.finished).to.equal(false, "calc1->finished");
      expect(calc1.batches[0]).to.equal(1, "calc1->batches[0]");
      expect(calc1.batchesLength).to.equal(1, "calc1->batchesLength");

      const calc2 = await queue.calculateFinalizationBatches(
        shareRate(1n),
        10000000000,
        1,
        buildBatchCalculationState(
          calc1.remainingEthBudget,
          calc1.finished,
          calc1.batches.map((x) => x),
          calc1.batchesLength,
        ),
      );

      expect(calc2.remainingEthBudget).to.equal(0, "calc2->remainingEthBudget");
      expect(calc2.finished).to.equal(true, "calc2->finished");
      expect(calc2.batches[0]).to.equal(2, "calc2->batches[0]");
      expect(calc2.batchesLength).to.equal(1, "calc2->batchesLength");
    });

    it("Works correctly on multiple calls with multiple batches for discounts", async () => {
      await queue.exposedEnqueue(ether("2.00"), shares(1n), owner);
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);

      const calc1 = await queue.calculateFinalizationBatches(
        shareRate(1n),
        10000000000,
        1,
        buildBatchCalculationState(ether("2.00"), false, Array(MAX_BATCHES).fill(0n), 0),
      );

      expect(calc1.remainingEthBudget).to.equal(ether("1.00"), "calc1->remainingEthBudget");
      expect(calc1.finished).to.equal(false, "calc1->finished");
      expect(calc1.batches[0]).to.equal(1, "calc1->batches[0]");
      expect(calc1.batchesLength).to.equal(1, "calc1->batchesLength");

      const calc2 = await queue.calculateFinalizationBatches(
        shareRate(1n),
        10000000000,
        1,
        buildBatchCalculationState(
          calc1.remainingEthBudget,
          calc1.finished,
          calc1.batches.map((x) => x),
          calc1.batchesLength,
        ),
      );

      expect(calc2.remainingEthBudget).to.equal(0, "calc2->remainingEthBudget");
      expect(calc2.finished).to.equal(true, "calc2->finished");
      expect(calc2.batches[0]).to.equal(2, "calc2->batches[0]");
      expect(calc2.batchesLength).to.equal(1, "calc2->batchesLength");
    });

    it("Works for multiple requests above max share rate in different reports", async () => {
      const maxShareRate = parseUnits("1", 26); // 0.1

      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);
      await queue.exposedSetLastReportTimestamp(await getBlockTimestamp(provider));

      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);
      await queue.exposedSetLastReportTimestamp(await getBlockTimestamp(provider));

      const calc1 = await queue.calculateFinalizationBatches(
        maxShareRate,
        10000000000,
        1,
        buildBatchCalculationState(ether("20.00"), false, Array(MAX_BATCHES).fill(0n), 0),
      );

      expect(calc1.remainingEthBudget).to.equal(ether("19.90"), "calc1->remainingEthBudget");
      expect(calc1.finished).to.equal(false, "calc1->finished");
      expect(calc1.batches[0]).to.equal(1, "calc1->batches[0]");
      expect(calc1.batchesLength).to.equal(1, "calc1->batchesLength");

      const calc2 = await queue.calculateFinalizationBatches(
        maxShareRate,
        10000000000,
        1,
        buildBatchCalculationState(
          calc1.remainingEthBudget,
          calc1.finished,
          calc1.batches.map((x) => x),
          calc1.batchesLength,
        ),
      );

      expect(calc2.remainingEthBudget).to.equal(ether("19.80"), "calc2->remainingEthBudget");
      expect(calc2.finished).to.equal(true, "calc2->finished");
      expect(calc2.batches[0]).to.equal(2, "calc2->batches[0]");
      expect(calc2.batchesLength).to.equal(1, "calc2->batchesLength");
    });

    it("Works for multiple requests below max share rate in different reports", async () => {
      const maxShareRate = shareRate(1n);

      await queue.exposedEnqueue(ether("10.00"), shares(500n), owner);
      await queue.exposedSetLastReportTimestamp(await getBlockTimestamp(provider));

      await queue.exposedEnqueue(ether("10.00"), shares(500n), owner);
      await queue.exposedSetLastReportTimestamp(await getBlockTimestamp(provider));

      const calc1 = await queue.calculateFinalizationBatches(
        maxShareRate,
        10000000000,
        1,
        buildBatchCalculationState(ether("20.00"), false, Array(MAX_BATCHES).fill(0n), 0),
      );

      expect(calc1.remainingEthBudget).to.equal(ether("10.00"), "calc1->remainingEthBudget");
      expect(calc1.finished).to.equal(false, "calc1->finished");
      expect(calc1.batches[0]).to.equal(1, "calc1->batches[0]");
      expect(calc1.batchesLength).to.equal(1, "calc1->batchesLength");

      const calc2 = await queue.calculateFinalizationBatches(
        maxShareRate,
        10000000000,
        1,
        buildBatchCalculationState(
          calc1.remainingEthBudget,
          calc1.finished,
          calc1.batches.map((x) => x),
          calc1.batchesLength,
        ),
      );

      expect(calc2.remainingEthBudget).to.equal(ether("0.00"), "calc2->remainingEthBudget");
      expect(calc2.finished).to.equal(true, "calc2->finished");
      expect(calc2.batches[0]).to.equal(2, "calc2->batches[0]");
      expect(calc2.batchesLength).to.equal(1, "calc2->batchesLength");
    });

    it("Works for budget break", async () => {
      const budget = ether("0.50");

      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);

      const calc = await queue.calculateFinalizationBatches(
        shareRate(1n),
        10000000000,
        1,
        buildBatchCalculationState(budget, false, Array(MAX_BATCHES).fill(0n), 0),
      );

      expect(calc.remainingEthBudget).to.equal(budget);
      expect(calc.finished).to.equal(true);
      expect(calc.batchesLength).to.equal(0);
    });

    it.skip("Works for on-chain batch limiter", async () => {
      // TODO: Implement this test L271: if (_state.batchesLength == MAX_BATCHES_LENGTH) break;
    });
  });

  context("prefinalize", () => {
    it("Reverts if share rate is 0", async () => {
      await expect(queue.prefinalize([1], 0)).to.be.revertedWithCustomError(queue, "ZeroShareRate");
    });

    it("Reverts for zero request id", async () => {
      await expect(queue.prefinalize([0], shareRate(1n)))
        .to.be.revertedWithCustomError(queue, "InvalidRequestId")
        .withArgs(0);
    });

    it("Reverts if batches length is zero", async () => {
      await expect(queue.prefinalize([], shareRate(1n))).to.be.revertedWithCustomError(queue, "EmptyBatches");
    });

    it("Reverts if request id is out of queue bounds", async () => {
      await expect(queue.prefinalize([1], shareRate(1n)))
        .to.be.revertedWithCustomError(queue, "InvalidRequestId")
        .withArgs(1);
    });

    it("Reverts if request id is already finalized", async () => {
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);
      await queue.exposedFinalize(1, ether("1.00"), shareRate(1n));

      await expect(queue.prefinalize([1], shareRate(1n)))
        .to.be.revertedWithCustomError(queue, "InvalidRequestId")
        .withArgs(1);
    });

    it("Reverts if batches are not in ascending order", async () => {
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);
      await queue.exposedEnqueue(ether("2.00"), shares(2n), owner);

      await expect(queue.prefinalize([2, 1], shareRate(1n))).to.be.revertedWithCustomError(
        queue,
        "BatchesAreNotSorted",
      );
    });

    it("Returns ethToLock and sharesToBurn", async () => {
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);

      const result = await queue.prefinalize([1], shareRate(1n));

      expect(result.ethToLock).to.equal(ether("1.00"));
      expect(result.sharesToBurn).to.equal(shares(1n));
    });

    it("Returns ethToLock and sharesToBurn for discounted", async () => {
      await queue.exposedEnqueue(ether("2.00"), shares(1n), owner);
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);

      const result = await queue.prefinalize([1, 2], shareRate(1n));

      expect(result.ethToLock).to.equal(ether("2.00")); // 2 + 1 = 2 :D :magic:
      expect(result.sharesToBurn).to.equal(shares(2n));
    });
  });

  context("_finalize", () => {
    it("Reverts if request id is out of queue bounds", async () => {
      await expect(queue.exposedFinalize(1, ether("1.00"), shareRate(1n)))
        .to.be.revertedWithCustomError(queue, "InvalidRequestId")
        .withArgs(1);
    });

    it("Reverts if request id is already finalized", async () => {
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);
      await queue.exposedFinalize(1, ether("1.00"), shareRate(1n));

      await expect(queue.exposedFinalize(1, ether("1.00"), shareRate(1n)))
        .to.be.revertedWithCustomError(queue, "InvalidRequestId")
        .withArgs(1);
    });

    it("Reverts if amount to finalize is greater than the locked amount", async () => {
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);

      await expect(queue.exposedFinalize(1, ether("2.00"), shareRate(1n)))
        .to.be.revertedWithCustomError(queue, "TooMuchEtherToFinalize")
        .withArgs(ether("2.00"), ether("1.00"));
    });
  });

  context("_enqueue", () => {
    it("Enqueues a new request", async () => {
      await expect(queue.exposedEnqueue(ether("1.00"), shares(1n), owner))
        .to.emit(queue, "WithdrawalRequested")
        .withArgs(1, owner.address, owner.address, ether("1.00"), shares(1n));

      expect(await queue.getLastRequestId()).to.equal(1);
    });

    it("Enqueues multiple requests", async () => {
      await expect(queue.exposedEnqueue(ether("1.00"), shares(1n), owner))
        .to.emit(queue, "WithdrawalRequested")
        .withArgs(1, owner.address, owner.address, ether("1.00"), shares(1n));

      await expect(queue.exposedEnqueue(ether("2.00"), shares(2n), owner))
        .to.emit(queue, "WithdrawalRequested")
        .withArgs(2, owner.address, owner.address, ether("2.00"), shares(2n));

      expect(await queue.getLastRequestId()).to.equal(2);
    });
  });

  context("_getStatus", () => {
    it("Reverts if request id is out of queue bounds", async () => {
      await expect(queue.exposedGetStatus(0)).to.be.revertedWithCustomError(queue, "InvalidRequestId").withArgs(0);
    });

    it("Reverts if request out of queue bounds", async () => {
      await expect(queue.exposedGetStatus(1)).to.be.revertedWithCustomError(queue, "InvalidRequestId").withArgs(1);
    });

    it("Returns the queue status", async () => {
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);

      const timestamp = await getBlockTimestamp(provider);

      const status = await queue.exposedGetStatus(1);

      expect(status.amountOfStETH).to.equal(shares(1n));
      expect(status.amountOfShares).to.equal(shares(1n));
      expect(status.owner).to.equal(owner.address);
      expect(status.timestamp).to.equal(timestamp);
      expect(status.isFinalized).to.equal(false);
      expect(status.isClaimed).to.equal(false);
    });
  });

  context("_findCheckpointHint", () => {
    it("Reverts if request id is 0", async () => {
      await expect(queue.exposedFindCheckpointHint(0n, 0n, 1n))
        .to.revertedWithCustomError(queue, "InvalidRequestId")
        .withArgs(0);
    });

    it("Reverts if request id is out of queue bounds", async () => {
      await expect(queue.exposedFindCheckpointHint(1n, 0n, 1n))
        .to.revertedWithCustomError(queue, "InvalidRequestId")
        .withArgs(1);
    });

    it("Reverts if start index is out of queue bounds", async () => {
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);

      await expect(queue.exposedFindCheckpointHint(1n, 0n, 1n))
        .to.revertedWithCustomError(queue, "InvalidRequestIdRange")
        .withArgs(0n, 1n);
    });

    it("Reverts if end index is out of queue bounds", async () => {
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);

      await expect(queue.exposedFindCheckpointHint(1n, 1n, 1000n))
        .to.revertedWithCustomError(queue, "InvalidRequestIdRange")
        .withArgs(1n, 1000n);
    });

    it("Returns 0 if no checkpoints", async () => {
      await queue.exposedEnqueue(ether("1.00"), shares(1n), owner);

      const lastCheckpointIndex = await queue.getLastCheckpointIndex();

      expect(await queue.exposedFindCheckpointHint(1n, 1n, lastCheckpointIndex)).to.equal(0);
    });
  });

  context("_claim", () => {});

  context("_calculateClaimableEther", () => {});

  context("_calculateClaimableStETH", () => {});

  context("_initializeQueue", () => {});

  context("_sendValue", () => {
    it("Reverts if not enough ether", async () => {
      await expect(queue.exposedSendValue(stranger, ether("1.00"))).to.be.revertedWithCustomError(
        queue,
        "NotEnoughEther",
      );
    });

    it("Reverts if not successful transfer", async () => {
      await setBalance(await queue.getAddress(), ether("10.00"));

      await receiver.setCanReceive(false);

      await expect(queue.exposedSendValue(receiver, ether("1.00"))).to.be.revertedWithCustomError(
        queue,
        "CantSendValueRecipientMayHaveReverted",
      );
    });

    it("Sends value to the recipient", async () => {
      await setBalance(await queue.getAddress(), ether("10.00"));

      const balanceBefore = await provider.getBalance(stranger);

      await queue.exposedSendValue(stranger, ether("1.00"));

      const balanceAfter = await provider.getBalance(stranger);

      expect(balanceAfter - balanceBefore).to.equal(ether("1.00"));
    });
  });

  context("_calcBatch", () => {
    it("Returns shareRate and shares for equal values", async () => {
      const timestamp = await getBlockTimestamp(provider);

      const prevRequest = {
        cumulativeStETH: 1000,
        cumulativeShares: 1000,
        owner: owner.address,
        timestamp,
        claimed: false,
        finalized: false,
        reportTimestamp: timestamp,
      };

      const request = {
        ...prevRequest,
        cumulativeStETH: 2000,
        cumulativeShares: 2000,
      };

      const batch = await queue.exposedCalcBatch(prevRequest, request);

      expect(batch.shareRate).to.equal(shareRate(1n), "batch->shareRate");
      expect(batch.shares).to.equal(1000, "batch->shares");
    });

    it("Returns shareRate and shares for different values", async () => {
      const timestamp = await getBlockTimestamp(provider);

      const prevRequest = {
        cumulativeStETH: 2000,
        cumulativeShares: 1000,
        owner: owner.address,
        timestamp,
        claimed: false,
        finalized: false,
        reportTimestamp: timestamp,
      };

      const request = {
        ...prevRequest,
        cumulativeStETH: 6000,
        cumulativeShares: 3000,
      };

      const batch = await queue.exposedCalcBatch(prevRequest, request);

      expect(batch.shareRate).to.equal(shareRate(2n), "batch->shareRate");
      expect(batch.shares).to.equal(2000, "batch->shares");
    });
  });

  context("_getLastReportTimestamp", () => {
    it("Returns 0 if no reports", async () => {
      expect(await queue.exposedGetLastReportTimestamp()).to.equal(0);
    });

    it("Returns the last report timestamp", async () => {
      const timestamp = await getBlockTimestamp(provider);

      await queue.exposedSetLastReportTimestamp(timestamp);

      expect(await queue.exposedGetLastReportTimestamp()).to.equal(timestamp);
    });
  });

  context("_setLastRequestId", () => {
    it("Sets the last request id", async () => {
      expect(await queue.getLastRequestId()).to.equal(0);

      await queue.exposedSetLastRequestId(1);

      expect(await queue.getLastRequestId()).to.equal(1);
    });
  });

  context("_setLastFinalizedRequestId", () => {
    it("Sets the last finalized request id", async () => {
      expect(await queue.getLastFinalizedRequestId()).to.equal(0);

      await queue.exposedSetLastFinalizedRequestId(1);

      expect(await queue.getLastFinalizedRequestId()).to.equal(1);
    });
  });

  context("_setLastCheckpointIndex", () => {
    it("Sets the last checkpoint index", async () => {
      expect(await queue.getLastCheckpointIndex()).to.equal(0);

      await queue.exposedSetLastCheckpointIndex(1);

      expect(await queue.getLastCheckpointIndex()).to.equal(1);
    });
  });

  context("_setLockedEtherAmount", () => {
    it("Sets the locked ether amount", async () => {
      expect(await queue.getLockedEtherAmount()).to.equal(0);

      await queue.exposedSetLockedEtherAmount(ether("100.00"));

      expect(await queue.getLockedEtherAmount()).to.equal(ether("100.00"));
    });
  });

  context("_setLastReportTimestamp", () => {
    it("Sets the last report timestamp", async () => {
      const timestamp = await getBlockTimestamp(provider);

      expect(await queue.exposedGetLastReportTimestamp()).to.equal(0);

      await queue.exposedSetLastReportTimestamp(timestamp);

      expect(await queue.exposedGetLastReportTimestamp()).to.equal(timestamp);
    });
  });
});
