import { expect } from "chai";
import { HDNodeWallet, Wallet, ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import {
  StETH__MockForWithdrawalQueue,
  WithdrawalsQueueHarness,
  WstETH__MockForWithdrawalQueue,
} from "typechain-types";

import {
  impersonate,
  MAX_UINT256,
  proxify,
  shares,
  signStETHPermit,
  Snapshot,
  WITHDRAWAL_BUNKER_MODE_DISABLED_TIMESTAMP,
  WITHDRAWAL_FINALIZE_ROLE,
  WITHDRAWAL_MAX_STETH_WITHDRAWAL_AMOUNT,
  WITHDRAWAL_MIN_STETH_WITHDRAWAL_AMOUNT,
  WITHDRAWAL_ORACLE_ROLE,
  WITHDRAWAL_PAUSE_ROLE,
  WITHDRAWAL_RESUME_ROLE,
} from "lib";

import { ether } from "../../lib/units";

const ZERO = 0n;

interface Permit {
  deadline: bigint;
  value: bigint;
  v: number;
  r: Buffer;
  s: Buffer;
}

describe("WithdrawalQueue", () => {
  let aliceWallet: HDNodeWallet;
  let alice: HardhatEthersSigner;

  let owner: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  let stEth: StETH__MockForWithdrawalQueue;
  let stEthAddress: string;
  let wstEth: WstETH__MockForWithdrawalQueue;
  let wstEthAddress: string;

  let queue: WithdrawalsQueueHarness;
  let queueAddress: string;

  let originalState: string;

  const deadline = MAX_UINT256;

  beforeEach(async () => {
    [owner, stranger, user] = await ethers.getSigners();

    stEth = await ethers.deployContract("StETH__MockForWithdrawalQueue", []);
    stEthAddress = await stEth.getAddress();

    wstEth = await ethers.deployContract("WstETH__MockForWithdrawalQueue", [await stEth.getAddress()]);
    wstEthAddress = await wstEth.getAddress();

    const impl = await ethers.deployContract("WithdrawalsQueueHarness", [wstEthAddress], owner);

    [queue] = await proxify({ impl, admin: owner });

    queueAddress = await queue.getAddress();

    aliceWallet = Wallet.createRandom(ethers.provider);
    alice = await impersonate(aliceWallet.address, ether("10.00"));
  });

  beforeEach(async () => (originalState = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(originalState));

  context("Constants", () => {
    it("Returns ths BUNKER_MODE_DISABLED_TIMESTAMP variable", async () => {
      expect(await queue.BUNKER_MODE_DISABLED_TIMESTAMP()).to.equal(WITHDRAWAL_BUNKER_MODE_DISABLED_TIMESTAMP);
    });

    it("Returns ACL roles", async () => {
      expect(await queue.PAUSE_ROLE()).to.equal(WITHDRAWAL_PAUSE_ROLE);
      expect(await queue.RESUME_ROLE()).to.equal(WITHDRAWAL_RESUME_ROLE);
      expect(await queue.FINALIZE_ROLE()).to.equal(WITHDRAWAL_FINALIZE_ROLE);
      expect(await queue.ORACLE_ROLE()).to.equal(WITHDRAWAL_ORACLE_ROLE);
    });

    it("Returns the MIN_STETH_WITHDRAWAL_AMOUNT variable", async () => {
      expect(await queue.MIN_STETH_WITHDRAWAL_AMOUNT()).to.equal(WITHDRAWAL_MIN_STETH_WITHDRAWAL_AMOUNT);
    });

    it("Returns the MAX_STETH_WITHDRAWAL_AMOUNT variable", async () => {
      expect(await queue.MAX_STETH_WITHDRAWAL_AMOUNT()).to.equal(WITHDRAWAL_MAX_STETH_WITHDRAWAL_AMOUNT);
    });

    it("Returns the STETH address", async () => {
      expect(await queue.STETH()).to.equal(stEthAddress);
    });

    it("Returns the WSTETH address", async () => {
      expect(await queue.WSTETH()).to.equal(wstEthAddress);
    });
  });

  context("constructor", () => {
    it("Reverts if wstETH address is zero", async () => {
      await expect(ethers.deployContract("WithdrawalsQueueHarness", [ZeroAddress])).to.be.revertedWithoutReason();
    });

    it("Sets initial properties", async () => {
      const deployed = await ethers.deployContract("WithdrawalsQueueHarness", [wstEthAddress]);

      expect(await deployed.STETH()).to.equal(stEthAddress, "stETH address");
      expect(await deployed.WSTETH()).to.equal(wstEthAddress, "wstETH address");
    });
  });

  context("initialize", () => {
    it("Reverts if initialized with zero address", async () => {
      await expect(queue.initialize(ZeroAddress)).to.be.revertedWithCustomError(queue, "AdminZeroAddress");
    });

    it("Sets initial properties and emits `InitializedV1`", async () => {
      await expect(queue.initialize(owner.address)).to.emit(queue, "InitializedV1").withArgs(owner.address);

      expect(await queue.getContractVersion()).to.equal(1n, "getContractVersion");
      expect(await queue.getLastRequestId()).to.equal(ZERO, "getLastRequestId");
      expect(await queue.getLastFinalizedRequestId()).to.equal(ZERO, "getLastFinalizedRequestId");
      expect(await queue.getLastCheckpointIndex()).to.equal(ZERO, "getLastCheckpointIndex");
      expect(await queue.unfinalizedStETH()).to.equal(ZERO, "unfinalizedStETH");
      expect(await queue.unfinalizedRequestNumber()).to.equal(ZERO, "unfinalizedRequestNumber");
      expect(await queue.getLockedEtherAmount()).to.equal(ZERO, "getLockedEtherAmount");
    });

    it("Pauses the contract", async () => {
      await queue.initialize(owner.address);

      expect(await queue.isPaused()).to.equal(true, "isPaused");
    });

    it("Disables bunker mode", async () => {
      await queue.initialize(owner.address);

      const TS = await queue.BUNKER_MODE_DISABLED_TIMESTAMP();

      expect(await queue.isBunkerModeActive()).to.equal(false, "isBunkerModeActive");
      expect(await queue.bunkerModeSinceTimestamp()).to.equal(TS, "bunkerModeSinceTimestamp");
    });
  });

  context("Pausable", () => {
    beforeEach(async () => {
      await queue.initialize(owner.address);
    });

    context("resume", () => {
      it("Reverts if the caller is unauthorised", async () => {
        await expect(queue.connect(stranger).resume()).to.be.revertedWithOZAccessControlError(
          stranger.address,
          WITHDRAWAL_RESUME_ROLE,
        );
      });

      it("Resumes the contract with RESUME_ROLE", async () => {
        await queue.grantRole(await queue.RESUME_ROLE(), owner);

        await queue.resume();

        expect(await queue.isPaused()).to.equal(false);
      });
    });

    context("pauseFor", () => {
      beforeEach(async () => {
        await queue.grantRole(await queue.RESUME_ROLE(), owner);

        await queue.resume();
      });

      it("Reverts if the caller is unauthorised", async () => {
        await expect(queue.connect(stranger).pauseFor(1n)).to.be.revertedWithOZAccessControlError(
          stranger.address,
          WITHDRAWAL_PAUSE_ROLE,
        );
      });

      it("Pauses the contract with PAUSE_ROLE", async () => {
        await queue.grantRole(await queue.PAUSE_ROLE(), owner);

        await queue.pauseFor(1n);

        expect(await queue.isPaused()).to.equal(true, "isPaused after");
      });
    });

    context("pauseUntil", () => {
      beforeEach(async () => {
        await queue.grantRole(await queue.RESUME_ROLE(), owner);

        await queue.resume();
      });

      it("Reverts if the caller is unauthorised", async () => {
        const blockTimestamp = await time.latest();

        await expect(queue.connect(stranger).pauseUntil(blockTimestamp + 1)).to.be.revertedWithOZAccessControlError(
          stranger.address,
          WITHDRAWAL_PAUSE_ROLE,
        );
      });

      it("Pauses the contract with PAUSE_ROLE", async () => {
        const blockTimestamp = await time.latest();

        await queue.grantRole(await queue.PAUSE_ROLE(), owner);

        await queue.connect(owner).pauseUntil(blockTimestamp + 100);

        expect(await queue.isPaused()).to.equal(true, "isPaused after pauseUntil");

        await time.increase(100);

        expect(await queue.isPaused()).to.equal(false, "isPaused after time increase");
      });
    });
  });

  context("Withdrawal Requests", () => {
    beforeEach(async () => {
      await queue.initialize(owner.address);
      await queue.grantRole(await queue.RESUME_ROLE(), owner);
      await queue.grantRole(await queue.PAUSE_ROLE(), owner);
      await queue.resume();
    });

    const getPermit = async (
      owner: HDNodeWallet,
      spender: string,
      value: bigint,
      deadline: bigint,
    ): Promise<Permit> => {
      const type = "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)";

      const { v, r, s } = signStETHPermit({ type, owner, spender, value, nonce: 1n, deadline }, stEthAddress);

      return { deadline: MAX_UINT256, value, v, r, s };
    };

    context("requestWithdrawals", () => {
      beforeEach(async () => {
        await stEth.setTotalPooledEther(ether("600.00"));
        await stEth.mintShares(user, shares(300n));
        await stEth.connect(user).approve(queueAddress, ether("300.00"));
      });

      it("Reverts if the contract is paused", async () => {
        await queue.pauseFor(1000n);

        await expect(queue.requestWithdrawals([ether("1.00")], stranger)).to.be.revertedWithCustomError(
          queue,
          "ResumedExpected",
        );
      });

      it("Reverts if requested less that MIN_WITHDRAWAL_AMOUNT", async () => {
        const lower = WITHDRAWAL_MIN_STETH_WITHDRAWAL_AMOUNT - 1n;

        await expect(queue.connect(user).requestWithdrawals([lower], stranger))
          .to.be.revertedWithCustomError(queue, "RequestAmountTooSmall")
          .withArgs(lower);
      });

      it("Reverts if requested more than MAX_WITHDRAWAL_AMOUNT", async () => {
        const higher = WITHDRAWAL_MAX_STETH_WITHDRAWAL_AMOUNT + 1n;

        await expect(queue.connect(user).requestWithdrawals([higher], stranger))
          .to.be.revertedWithCustomError(queue, "RequestAmountTooLarge")
          .withArgs(higher);
      });

      it("Reverts if requested more than the user's balance", async () => {
        const overflow = ether("1000.00");

        await expect(queue.connect(user).requestWithdrawals([overflow], stranger)).to.be.revertedWith(
          "ALLOWANCE_EXCEEDED",
        );
      });

      it("Creates requests for multiple amounts", async () => {
        const amount1 = ether("10.00");
        const amount2 = ether("20.00");
        const shares1 = await stEth.getSharesByPooledEth(amount1);
        const shares2 = await stEth.getSharesByPooledEth(amount2);

        const requestIdBefore = await queue.getLastRequestId();

        await expect(queue.connect(user).requestWithdrawals([amount1, amount2], stranger))
          .to.emit(queue, "WithdrawalRequested")
          .withArgs(1, user.address, stranger.address, amount1, shares1)
          .to.emit(queue, "WithdrawalRequested")
          .withArgs(2, user.address, stranger.address, amount2, shares2);

        const diff = (await queue.getLastRequestId()) - requestIdBefore;
        expect(diff).to.equal(requestIdBefore + 2n);
      });

      it("Creates requests for multiple amounts with zero owner address", async () => {
        const amount = ether("10.00");
        const shares = await stEth.getSharesByPooledEth(amount);

        const requestIdBefore = await queue.getLastRequestId();

        await expect(queue.connect(user).requestWithdrawals([amount], ZeroAddress))
          .to.emit(queue, "WithdrawalRequested")
          .withArgs(1, user.address, user.address, amount, shares);

        const diff = (await queue.getLastRequestId()) - requestIdBefore;
        expect(diff).to.equal(requestIdBefore + 1n);
      });
    });

    context("requestWithdrawalsWstETH", () => {
      beforeEach(async () => {
        await stEth.setTotalPooledEther(ether("600.00"));
        await stEth.mintShares(wstEthAddress, shares(100n));
        await stEth.mintShares(user, shares(100n));
        await wstEth.mint(user, ether("100.00"));
        await wstEth.connect(user).approve(queueAddress, ether("300.00"));
      });

      it("Reverts if the contract is paused", async () => {
        await queue.pauseFor(100n);

        await expect(queue.requestWithdrawalsWstETH([ether("1.00")], stranger)).to.be.revertedWithCustomError(
          queue,
          "ResumedExpected",
        );
      });

      it("Reverts if requested more than the user's balance", async () => {
        const overflow = ether("1000.00");

        await expect(queue.connect(user).requestWithdrawalsWstETH([overflow], stranger)).to.be.revertedWith(
          "ERC20: transfer amount exceeds balance",
        );
      });

      it("Creates requests for multiple amounts", async () => {
        const amount1 = ether("10.00");
        const amount2 = ether("20.00");

        const stEthAmount1 = await wstEth.getStETHByWstETH(amount1);
        const stEthAmount2 = await wstEth.getStETHByWstETH(amount2);

        const shares1 = await stEth.getSharesByPooledEth(stEthAmount1);
        const shares2 = await stEth.getSharesByPooledEth(stEthAmount2);

        const requestIdBefore = await queue.getLastRequestId();

        await expect(queue.connect(user).requestWithdrawalsWstETH([amount1, amount2], stranger))
          .to.emit(queue, "WithdrawalRequested")
          .withArgs(1, user.address, stranger.address, stEthAmount1, shares1)
          .to.emit(queue, "WithdrawalRequested")
          .withArgs(2, user.address, stranger.address, stEthAmount2, shares2);

        const requestIdAfter = await queue.getLastRequestId();
        const diff = requestIdAfter - requestIdBefore;
        expect(diff).to.equal(requestIdBefore + 2n);
      });

      it("Creates requests for single amount with zero owner address", async () => {
        const amount = ether("10.00");

        const stEthAmount = await wstEth.getStETHByWstETH(amount);
        const shares = await stEth.getSharesByPooledEth(stEthAmount);

        const requestIdBefore = await queue.getLastRequestId();

        await expect(queue.connect(user).requestWithdrawalsWstETH([amount], ZeroAddress))
          .to.emit(queue, "WithdrawalRequested")
          .withArgs(1, user.address, user.address, stEthAmount, shares);

        const requestIdAfter = await queue.getLastRequestId();
        const diff = requestIdAfter - requestIdBefore;
        expect(diff).to.equal(requestIdBefore + 1n);
      });
    });

    context("requestWithdrawalsWithPermit", () => {
      const requestsCount = 2;
      const requestSize = ether("10.00");
      const requests = Array(requestsCount).fill(requestSize);
      const amount = BigInt(requestsCount) * requestSize;

      let permit: Permit;

      beforeEach(async () => {
        await stEth.setTotalPooledEther(ether("1000.00"));
        await stEth.mintShares(alice, shares(500n));
        await stEth.connect(alice).approve(queueAddress, ether("500.00"));

        permit = await getPermit(aliceWallet, owner.address, amount, deadline);
      });

      it("Reverts if the contract is paused", async () => {
        await queue.pauseFor(100n);

        await expect(
          queue.connect(alice).requestWithdrawalsWithPermit(requests, stranger, permit),
        ).to.be.revertedWithCustomError(queue, "ResumedExpected");
      });

      it("Reverts bad permit with `INVALID_SIGNATURE`", async () => {
        await stEth.mock__setSignatureIsValid(false);

        await expect(queue.connect(alice).requestWithdrawalsWithPermit(requests, owner, permit)).to.be.revertedWith(
          "INVALID_SIGNATURE",
        );
      });

      it("Creates requests for multiple amounts with valid permit", async () => {
        const oneRequestSize = requests[0];
        const shares = await stEth.getSharesByPooledEth(oneRequestSize);

        const requestIdBefore = await queue.getLastRequestId();

        await expect(queue.connect(alice).requestWithdrawalsWithPermit(requests, owner, permit))
          .to.emit(queue, "WithdrawalRequested")
          .withArgs(1, alice.address, owner.address, oneRequestSize, shares)
          .to.emit(queue, "WithdrawalRequested")
          .withArgs(2, alice.address, owner.address, oneRequestSize, shares);

        const diff = (await queue.getLastRequestId()) - requestIdBefore;
        expect(diff).to.equal(requestIdBefore + BigInt(requests.length));
      });

      it("Creates requests for single amounts with valid permit and zero owner address", async () => {
        const request = requests[0];
        const shares = await stEth.getSharesByPooledEth(request);

        const requestIdBefore = await queue.getLastRequestId();

        await expect(queue.connect(alice).requestWithdrawalsWithPermit([request], ZeroAddress, permit))
          .to.emit(queue, "WithdrawalRequested")
          .withArgs(1, alice.address, alice.address, request, shares);

        const diff = (await queue.getLastRequestId()) - requestIdBefore;
        expect(diff).to.equal(requestIdBefore + 1n);
      });
    });

    context("requestWithdrawalsWstETHWithPermit", () => {});

    context("getWithdrawalRequests", () => {
      beforeEach(async () => {
        await stEth.setTotalPooledEther(ether("1000.00"));
        await stEth.mintShares(user, shares(300n));
        await stEth.connect(user).approve(queueAddress, ether("300.00"));
      });

      it("Returns the requested amounts", async () => {
        const amount1 = ether("10.00");
        const amount2 = ether("20.00");

        await queue.connect(user).requestWithdrawals([amount1, amount2], stranger);

        expect(await queue.getWithdrawalRequests(user)).to.deep.equal([]);
        expect(await queue.getWithdrawalRequests(stranger)).to.deep.equal([1n, 2n]);
      });
    });
  });

  context("getWithdrawalStatus", () => {});

  context("getClaimableEther", () => {});

  context("claimWithdrawalsTo", () => {});

  context("claimWithdrawals", () => {});

  context("findCheckpointHints", () => {});

  context("onOracleReport", () => {});

  context("isBunkerModeActive", () => {});

  context("bunkerModeSinceTimestamp", () => {});
});
