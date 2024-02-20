import { expect } from "chai";
import { HDNodeWallet, Wallet, ZeroAddress } from "ethers";
import { ethers } from "hardhat";
import { afterEach } from "mocha";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";

import { StETHPermitMock, WithdrawalQueueERC721, WstETHMock } from "typechain-types";

import {
  deployWithdrawalQueue,
  ether,
  getBlockTimestamp,
  impersonate,
  MAX_UINT256,
  ONE_ETHER,
  shareRate,
  shares,
  signStETHPermit,
  signWstETHPermit,
  Snapshot,
  WITHDRAWAL_MAX_STETH_WITHDRAWAL_AMOUNT,
  WITHDRAWAL_MIN_STETH_WITHDRAWAL_AMOUNT,
} from "lib";

interface Permit {
  deadline: bigint;
  value: bigint;
  v: number;
  r: Buffer;
  s: Buffer;
}

describe("WithdrawalQueueERC721:requests", () => {
  let aliceWallet: HDNodeWallet;
  let alice: HardhatEthersSigner;

  let owner: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let daoAgent: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  let queue: WithdrawalQueueERC721;
  let queueAddress: string;
  let stEth: StETHPermitMock;
  let stEthAddress: string;
  let wstEth: WstETHMock;
  let wstEthAddress: string;

  let originalState: string;
  let provider: typeof ethers.provider;

  const deadline = MAX_UINT256;

  before(async () => {
    ({ provider } = ethers);
    [owner, stranger, daoAgent, user] = await ethers.getSigners();

    const deployed = await deployWithdrawalQueue({
      stEthSettings: { initialStEth: ONE_ETHER, owner },
      queueAdmin: daoAgent,
      queueFinalizer: daoAgent,
    });

    ({ queue, queueAddress, stEth, stEthAddress, wstEth, wstEthAddress } = deployed);

    aliceWallet = Wallet.createRandom(provider);
    alice = await impersonate(aliceWallet.address, ether("10.00"));
  });

  beforeEach(async () => (originalState = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(originalState));

  context("requestWithdrawals", () => {
    beforeEach(async () => {
      await stEth.setTotalPooledEther(ether("600.00"));
      await stEth.mintShares(user, shares(300n));
      await stEth.connect(user).approve(queueAddress, ether("300.00"));
    });

    it("Reverts if the contract is paused", async () => {
      await queue.connect(daoAgent).pauseFor(100n);

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
      const shares1 = stEth.getSharesByPooledEth(amount1);
      const shares2 = stEth.getSharesByPooledEth(amount2);

      const requestIdBefore = await queue.getLastRequestId();

      await expect(queue.connect(user).requestWithdrawals([amount1, amount2], stranger))
        .to.emit(queue, "WithdrawalRequested")
        .withArgs(1, user.address, stranger.address, amount1, shares1)
        .to.emit(queue, "WithdrawalRequested")
        .withArgs(2, user.address, stranger.address, amount2, shares2);

      const diff = (await queue.getLastRequestId()) - requestIdBefore;
      expect(diff).to.equal(requestIdBefore + 2n);
    });

    it("Creates requests for multiple amounts with zero owner address ", async () => {
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

  context("requestWithdrawalsWithPermit", () => {
    const requestsCount = 5;
    const requestSize = ether("10.00");
    const requests = Array(requestsCount).fill(requestSize);
    const amount = BigInt(requestsCount) * requestSize;

    let permit: Permit;

    beforeEach(async () => {
      await stEth.setTotalPooledEther(ether("1000.00"));
      await stEth.mintShares(alice, shares(500n));
      await stEth.connect(alice).approve(queueAddress, ether("500.00"));

      const { v, r, s } = signStETHPermit(
        {
          type: "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)",
          owner: aliceWallet,
          spender: queueAddress,
          value: amount,
          nonce: await stEth.nonces(alice.address),
          deadline,
        },
        stEthAddress,
      );

      permit = { deadline: MAX_UINT256, value: amount, v, r, s };
    });

    it("Reverts if the contract is paused", async () => {
      await queue.connect(daoAgent).pauseFor(100n);

      await expect(
        queue.connect(alice).requestWithdrawalsWithPermit(requests, stranger, permit),
      ).to.be.revertedWithCustomError(queue, "ResumedExpected");
    });

    it("Reverts bad permit with `INVALID_SIGNATURE`", async () => {
      const { s } = permit;
      s[0] = (s[0] + 1) % 255;
      const badPermit = { ...permit, s };

      await expect(queue.connect(alice).requestWithdrawalsWithPermit(requests, owner, badPermit)).to.be.revertedWith(
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
        .withArgs(2, alice.address, owner.address, oneRequestSize, shares)
        .to.emit(queue, "WithdrawalRequested")
        .withArgs(3, alice.address, owner.address, oneRequestSize, shares)
        .to.emit(queue, "WithdrawalRequested")
        .withArgs(4, alice.address, owner.address, oneRequestSize, shares)
        .to.emit(queue, "WithdrawalRequested")
        .withArgs(5, alice.address, owner.address, oneRequestSize, shares);

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

  context("requestWithdrawalsWstETH", () => {
    beforeEach(async () => {
      await wstEth.mint(user, ether("100.00"));
      await stEth.mintShares(wstEthAddress, shares(100n));
      await stEth.mintShares(user, shares(100n));
      await wstEth.connect(user).approve(queueAddress, ether("300.00"));
    });

    it("Reverts if the contract is paused", async () => {
      await queue.connect(daoAgent).pauseFor(100n);

      await expect(queue.requestWithdrawalsWstETH([ether("1.00")], stranger)).to.be.revertedWithCustomError(
        queue,
        "ResumedExpected",
      );
    });

    it("Reverts if requested less that MIN_WITHDRAWAL_AMOUNT", async () => {
      const lower = WITHDRAWAL_MIN_STETH_WITHDRAWAL_AMOUNT - 1n;
      const amount = await wstEth.getStETHByWstETH(lower);

      await expect(queue.connect(user).requestWithdrawalsWstETH([lower], stranger))
        .to.be.revertedWithCustomError(queue, "RequestAmountTooSmall")
        .withArgs(amount);
    });

    it.skip("Reverts if requested more than MAX_WITHDRAWAL_AMOUNT", async () => {
      // TODO: Implement this test
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

  context("requestWithdrawalsWstETHWithPermit", () => {
    const requestsCount = 5;
    const requestSize = ether("10.00");
    const requests = Array(requestsCount).fill(requestSize);
    const amount = BigInt(requestsCount) * requestSize;

    let permit: Permit;

    beforeEach(async () => {
      await wstEth.mint(alice, ether("100.00"));
      await stEth.mintShares(wstEthAddress, shares(100n));
      await stEth.mintShares(alice, shares(100n));

      await wstEth.connect(alice).approve(queueAddress, ether("300.00"));

      const { v, r, s } = signWstETHPermit(
        {
          type: "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)",
          owner: aliceWallet,
          spender: queueAddress,
          value: amount,
          nonce: await wstEth.nonces(alice.address),
          deadline,
        },
        wstEthAddress,
      );

      permit = { deadline: MAX_UINT256, value: amount, v, r, s };
    });

    it("Reverts if the contract is paused", async () => {
      await queue.connect(daoAgent).pauseFor(100n);

      await expect(
        queue.connect(alice).requestWithdrawalsWstETHWithPermit(requests, owner, permit),
      ).to.be.revertedWithCustomError(queue, "ResumedExpected");
    });

    it("Reverts bad permit with `ERC20Permit: invalid signature`", async () => {
      const { s } = permit;
      s[0] = (s[0] + 1) % 255;
      const badPermit = { ...permit, s };

      await expect(
        queue.connect(alice).requestWithdrawalsWstETHWithPermit(requests, owner, badPermit),
      ).to.be.revertedWith("ERC20Permit: invalid signature");
    });

    it("Creates requests for multiple amounts with valid permit", async () => {
      const oneRequestSize = requests[0];
      const stEthAmount = await wstEth.getStETHByWstETH(oneRequestSize);
      const shares = await stEth.getSharesByPooledEth(stEthAmount);
      const requestIdBefore = await queue.getLastRequestId();

      await expect(queue.connect(alice).requestWithdrawalsWstETHWithPermit(requests, owner, permit))
        .to.emit(queue, "WithdrawalRequested")
        .withArgs(1, alice.address, owner.address, stEthAmount, shares)
        .to.emit(queue, "WithdrawalRequested")
        .withArgs(2, alice.address, owner.address, stEthAmount, shares)
        .to.emit(queue, "WithdrawalRequested")
        .withArgs(3, alice.address, owner.address, stEthAmount, shares)
        .to.emit(queue, "WithdrawalRequested")
        .withArgs(4, alice.address, owner.address, stEthAmount, shares)
        .to.emit(queue, "WithdrawalRequested")
        .withArgs(5, alice.address, owner.address, stEthAmount, shares);

      const requestIdAfter = await queue.getLastRequestId();
      const diff = requestIdAfter - requestIdBefore;
      expect(diff).to.equal(requestIdBefore + BigInt(requests.length));
    });

    it("Creates requests for single amounts with valid permit and zero owner address", async () => {
      const request = requests[0];
      const stEthAmount = await wstEth.getStETHByWstETH(request);
      const shares = await stEth.getSharesByPooledEth(stEthAmount);
      const requestIdBefore = await queue.getLastRequestId();

      await expect(queue.connect(alice).requestWithdrawalsWstETHWithPermit([request], ZeroAddress, permit))
        .to.emit(queue, "WithdrawalRequested")
        .withArgs(1, alice.address, alice.address, stEthAmount, shares);

      const requestIdAfter = await queue.getLastRequestId();
      const diff = requestIdAfter - requestIdBefore;
      expect(diff).to.equal(requestIdBefore + 1n);
    });
  });

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

  context("getWithdrawalStatus", () => {
    beforeEach(async () => {
      await stEth.setTotalPooledEther(ether("1000.00"));
      await setBalance(stEthAddress, ether("1001.00"));

      await stEth.mintShares(user, shares(300n));
      await stEth.connect(user).approve(queueAddress, ether("300.00"));
    });

    it("Reverts if the request does not exist", async () => {
      await expect(queue.getWithdrawalStatus([1]))
        .to.be.revertedWithCustomError(queue, "InvalidRequestId")
        .withArgs(1);
    });

    it("Returns empty array if no requests", async () => {
      expect(await queue.getWithdrawalStatus([])).to.deep.equal([]);
    });

    it("Returns correct status for new requests", async () => {
      const amount1 = ether("10.00");
      const amount2 = ether("20.00");

      const shares1 = await stEth.getSharesByPooledEth(amount1);
      const shares2 = await stEth.getSharesByPooledEth(amount2);

      await queue.connect(user).requestWithdrawals([amount1, amount2], stranger);

      const timestamp = BigInt(await getBlockTimestamp(provider));

      expect(await queue.getWithdrawalStatus([1, 2])).to.deep.equal([
        [amount1, shares1, stranger.address, timestamp, false, false],
        [amount2, shares2, stranger.address, timestamp, false, false],
      ]);
    });

    it("Returns correct status for finalized requests", async () => {
      const amount = ether("10.00");
      const shares = await stEth.getSharesByPooledEth(amount);

      await queue.connect(user).requestWithdrawals([amount], stranger);

      const timestamp = BigInt(await getBlockTimestamp(provider));
      const lastRequestId = await queue.getLastRequestId();

      await queue.connect(daoAgent).finalize(lastRequestId, shareRate(shares));

      expect(await queue.getWithdrawalStatus([lastRequestId])).to.deep.equal([
        [amount, shares, stranger.address, timestamp, true, false],
      ]);
    });

    it.skip("Returns correct status for claimed requests", async () => {
      const amount = ether("10.00");
      const shares = await stEth.getSharesByPooledEth(amount);

      await queue.connect(user).requestWithdrawals([amount], stranger);

      const timestamp = BigInt(await getBlockTimestamp(provider));
      const lastRequestId = await queue.getLastRequestId();

      await queue.connect(daoAgent).finalize(lastRequestId, shareRate(shares));
      await queue.connect(stranger).claimWithdrawal(lastRequestId);

      expect(await queue.getWithdrawalStatus([lastRequestId])).to.deep.equal([
        [amount, shares, stranger.address, timestamp, true, true],
      ]);
    });
  });
});
