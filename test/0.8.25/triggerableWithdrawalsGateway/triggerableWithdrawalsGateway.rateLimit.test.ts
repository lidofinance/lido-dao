import { expect } from "chai";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { TriggerableWithdrawalsGateway } from "typechain-types";

import { advanceChainTime } from "lib";

import { DEFAULT_TWG_LIMIT, deployTriggerableWithdrawalsGateway } from "test/deploy";
import { Snapshot } from "test/suite";

import {
  FULL_WITHDRAWAL_WEIGHT_GWEI,
  fullWithdrawal,
  GWEI_PER_ETH,
  MAX_PARTIAL_WITHDRAWAL_AMOUNT_GWEI,
  partialWithdrawal,
} from "../triggerable-withdrawals-helpers";

const {
  maxWithdrawalLimitGwei: MAX,
  withdrawalLimitPerFrameGwei: PER_FRAME,
  frameDurationInSec: FRAME,
} = DEFAULT_TWG_LIMIT;

describe("TriggerableWithdrawalsGateway.sol: rate limit", () => {
  let gateway: TriggerableWithdrawalsGateway;
  let admin: HardhatEthersSigner;
  let limitManager: HardhatEthersSigner;
  let requester: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  let originalState: string;

  before(async () => {
    [admin, limitManager, requester, stranger] = await ethers.getSigners();

    ({ gateway } = await deployTriggerableWithdrawalsGateway(admin));

    await gateway.connect(admin).grantRole(await gateway.TW_EXIT_LIMIT_MANAGER_ROLE(), limitManager.address);
    await gateway.connect(admin).grantRole(await gateway.ADD_WITHDRAWAL_REQUEST_ROLE(), requester.address);
  });

  beforeEach(async () => {
    originalState = await Snapshot.take();
    // Re-setting the full limit starts a new frame now: frames are long compared to the few seconds
    // between transactions in a test, so the restored quota below is exact in frames
    await gateway.connect(limitManager).setWithdrawalLimit(MAX, PER_FRAME, FRAME);
  });

  afterEach(async () => await Snapshot.restore(originalState));

  const currentLimit = async () => (await gateway.getWithdrawalLimitFullInfo()).currentWithdrawalLimitGwei;

  /** Consumes exactly `weightGwei` of the limit with partial withdrawals. */
  const consume = async (weightGwei: bigint) => {
    const intents = [];
    for (let left = weightGwei, i = 0; left > 0n; ++i) {
      const chunk = left > MAX_PARTIAL_WITHDRAWAL_AMOUNT_GWEI ? MAX_PARTIAL_WITHDRAWAL_AMOUNT_GWEI : left;
      intents.push(partialWithdrawal(i, chunk));
      left -= chunk;
    }
    await gateway.connect(requester).triggerWithdrawals(intents, requester.address, { value: BigInt(intents.length) });
  };

  context("setWithdrawalLimit", () => {
    const NEW_MAX = 4096n * GWEI_PER_ETH;
    const NEW_PER_FRAME = 64n * GWEI_PER_ETH;

    it("reverts if caller has no TW_EXIT_LIMIT_MANAGER_ROLE", async () => {
      await expect(gateway.connect(stranger).setWithdrawalLimit(NEW_MAX, NEW_PER_FRAME, 12))
        .to.be.revertedWithCustomError(gateway, "AccessControlUnauthorizedAccount")
        .withArgs(stranger.address, await gateway.TW_EXIT_LIMIT_MANAGER_ROLE());
    });

    it("sets the limit and emits WithdrawalLimitSet", async () => {
      await expect(gateway.connect(limitManager).setWithdrawalLimit(NEW_MAX, NEW_PER_FRAME, 12))
        .to.emit(gateway, "WithdrawalLimitSet")
        .withArgs(NEW_MAX, NEW_PER_FRAME, 12);

      const info = await gateway.getWithdrawalLimitFullInfo();
      expect(info.maxWithdrawalLimitGwei).to.equal(NEW_MAX);
      expect(info.withdrawalLimitPerFrameGwei).to.equal(NEW_PER_FRAME);
      expect(info.frameDurationInSec).to.equal(12);
      expect(info.currentWithdrawalLimitGwei).to.equal(NEW_MAX);
    });

    it("reverts if the max withdrawal limit is below the full withdrawal weight", async () => {
      await expect(gateway.connect(limitManager).setWithdrawalLimit(FULL_WITHDRAWAL_WEIGHT_GWEI - 1n, 1, 12))
        .to.be.revertedWithCustomError(gateway, "TooSmallMaxWithdrawalLimit")
        .withArgs(FULL_WITHDRAWAL_WEIGHT_GWEI - 1n);
    });

    it("reverts if the limit per frame is zero", async () => {
      await expect(gateway.connect(limitManager).setWithdrawalLimit(FULL_WITHDRAWAL_WEIGHT_GWEI, 0, 12))
        .to.be.revertedWithCustomError(gateway, "ZeroArgument")
        .withArgs("withdrawalLimitPerFrameGwei");
    });

    it("reverts if the limit per frame exceeds the max withdrawal limit", async () => {
      await expect(
        gateway
          .connect(limitManager)
          .setWithdrawalLimit(FULL_WITHDRAWAL_WEIGHT_GWEI, FULL_WITHDRAWAL_WEIGHT_GWEI + 1n, 12),
      ).to.be.revertedWithCustomError(gateway, "TooLargeLimitPerFrame");
    });

    it("reverts if frame duration is zero", async () => {
      await expect(
        gateway.connect(limitManager).setWithdrawalLimit(FULL_WITHDRAWAL_WEIGHT_GWEI, 1, 0),
      ).to.be.revertedWithCustomError(gateway, "ZeroFrameDuration");
    });

    it("keeps the quota restored since the last request", async () => {
      await consume(MAX);
      await advanceChainTime(3n * FRAME);
      expect(await currentLimit()).to.equal(3n * PER_FRAME);

      await gateway.connect(limitManager).setWithdrawalLimit(MAX, PER_FRAME, FRAME);

      expect(await currentLimit()).to.equal(3n * PER_FRAME);
    });

    it("caps the current limit by a lower max withdrawal limit", async () => {
      await consume(1000n * GWEI_PER_ETH);

      await gateway.connect(limitManager).setWithdrawalLimit(NEW_MAX, PER_FRAME, FRAME);

      expect(await currentLimit()).to.equal(NEW_MAX);
    });

    it("does not increase the current limit when the max withdrawal limit grows", async () => {
      await consume(1000n * GWEI_PER_ETH);

      await gateway.connect(limitManager).setWithdrawalLimit(MAX * 2n, PER_FRAME, FRAME);

      expect(await currentLimit()).to.equal(MAX - 1000n * GWEI_PER_ETH);
    });
  });

  context("consumption", () => {
    it("allows a batch that exactly exhausts the limit", async () => {
      await consume(MAX);

      expect(await currentLimit()).to.equal(0);
    });

    it("counts partial withdrawals to the gwei", async () => {
      await consume(1n);

      expect(await currentLimit()).to.equal(MAX - 1n);
    });

    it("reverts the whole batch if it exceeds the remaining limit", async () => {
      const remaining = FULL_WITHDRAWAL_WEIGHT_GWEI - 1n;
      await consume(MAX - remaining);

      await expect(
        gateway
          .connect(requester)
          .triggerWithdrawals([partialWithdrawal(0, 1n), fullWithdrawal(1)], requester.address, {
            value: 2n,
          }),
      )
        .to.be.revertedWithCustomError(gateway, "WithdrawalLimitExceeded")
        .withArgs(FULL_WITHDRAWAL_WEIGHT_GWEI + 1n, remaining);

      expect(await currentLimit()).to.equal(remaining);
    });
  });

  context("restoration", () => {
    beforeEach(async () => {
      await consume(MAX);
    });

    it("does not restore the limit within a frame", async () => {
      await advanceChainTime(FRAME / 2n);

      expect(await currentLimit()).to.equal(0);
    });

    it("restores the limit per frame for each passed frame", async () => {
      await advanceChainTime(5n * FRAME);

      expect(await currentLimit()).to.equal(5n * PER_FRAME);
    });

    it("restores without overflow at the uint64 bounds", async () => {
      const U64_MAX = 2n ** 64n - 1n;
      // The exhausted quota is carried over, so the limit starts empty
      await gateway.connect(limitManager).setWithdrawalLimit(U64_MAX, U64_MAX, FRAME);
      await advanceChainTime(2n * FRAME);

      // The quota restored in two frames exceeds uint64 before the cap is applied
      expect(await currentLimit()).to.equal(U64_MAX);
    });

    it("caps the restored limit by the max withdrawal limit", async () => {
      await advanceChainTime((MAX / PER_FRAME + 10n) * FRAME);

      expect(await currentLimit()).to.equal(MAX);
    });

    it("lets a full withdrawal through once enough quota is restored", async () => {
      const framesForFullWithdrawal = FULL_WITHDRAWAL_WEIGHT_GWEI / PER_FRAME;
      await advanceChainTime((framesForFullWithdrawal - 1n) * FRAME);

      await expect(
        gateway.connect(requester).triggerWithdrawals([fullWithdrawal(0)], requester.address, { value: 1n }),
      ).to.be.revertedWithCustomError(gateway, "WithdrawalLimitExceeded");

      await advanceChainTime(FRAME);

      await expect(
        gateway.connect(requester).triggerWithdrawals([fullWithdrawal(0)], requester.address, { value: 1n }),
      ).to.emit(gateway, "WithdrawalsTriggered");
    });
  });
});
