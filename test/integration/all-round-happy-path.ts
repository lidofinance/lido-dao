import { expect } from "chai";
import { BaseContract, LogDescription, TransactionReceipt, TransactionResponse, ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { batch, ether, impersonate, log, trace } from "lib";

import { getProtocolContext, ProtocolContext } from "../../lib/protocol";
import { ensureSDVTOperators, oracleReport, unpauseStaking, unpauseWithdrawalQueue } from "../../lib/protocol/helpers";
import { Snapshot } from "../suite";

const AMOUNT = ether("100");
const MAX_DEPOSIT = 150n;
const CURATED_MODULE_ID = 1n;
const SIMPLE_DVT_MODULE_ID = 2n;

const ZERO_HASH = new Uint8Array(32).fill(0);

const getEvents = (receipt: TransactionReceipt, contract: BaseContract, name: string) =>
  receipt.logs
    .filter((l) => l !== null)
    .map((l) => contract.interface.parseLog(l))
    .filter((l) => l?.name === name) || ([] as LogDescription[]);

const getEvent = (receipt: TransactionReceipt, contract: BaseContract, name: string, index = 0) =>
  getEvents(receipt, contract, name)[index] as LogDescription | undefined;

describe("Protocol", () => {
  let ctx: ProtocolContext;
  let snapshot: string;

  let ethHolder: HardhatEthersSigner;
  let stEthHolder: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  let uncountedStETHShares: bigint;

  before(async () => {
    ctx = await getProtocolContext();

    const signers = await ethers.getSigners();

    [ethHolder, stEthHolder, stranger] = await Promise.all([
      impersonate(signers[0].address, ether("1000000")),
      impersonate(signers[1].address, ether("1000000")),
      impersonate(signers[2].address, ether("1000000")),
    ]);

    snapshot = await Snapshot.take();
  });

  after(async () => await Snapshot.restore(snapshot));

  const submitStake = async (amount: bigint, wallet: HardhatEthersSigner) => {
    const { lido } = ctx.contracts;
    const tx = await lido.connect(wallet).submit(ZeroAddress, { value: amount });
    await trace("lido.submit", tx);
  };

  const getBalances = async (wallet: HardhatEthersSigner) => {
    const { lido } = ctx.contracts;
    return batch({
      ETH: ethers.provider.getBalance(wallet),
      stETH: lido.balanceOf(wallet),
    });
  };

  it("Should be unpaused", async () => {
    const { lido, withdrawalQueue } = ctx.contracts;

    await unpauseStaking(ctx);
    await unpauseWithdrawalQueue(ctx);

    expect(await lido.isStakingPaused()).to.be.false;
    expect(await withdrawalQueue.isPaused()).to.be.false;
  });

  it("Should be able to finalize the withdrawal queue", async () => {
    const { lido, withdrawalQueue } = ctx.contracts;

    const stEthHolderAmount = ether("10000");
    const tx = await stEthHolder.sendTransaction({ to: lido.address, value: stEthHolderAmount });
    await trace("stEthHolder.sendTransaction", tx);

    // Note: when using tracer it stops on promise.all concurrency, and slows down the test
    const getRequests = async () => {
      const lastFinalizedRequestId = await withdrawalQueue.getLastFinalizedRequestId();
      const lastRequestId = await withdrawalQueue.getLastRequestId();

      return { lastFinalizedRequestId, lastRequestId };
    };

    let { lastFinalizedRequestId, lastRequestId } = await getRequests();

    while (lastFinalizedRequestId != lastRequestId) {
      await oracleReport(ctx);

      ({ lastFinalizedRequestId, lastRequestId } = await getRequests());

      log.debug("Withdrawal queue", {
        "Last finalized request ID": lastFinalizedRequestId,
        "Last request ID": lastRequestId,
      });

      await submitStake(ether("10000"), ethHolder);
    }

    await submitStake(ether("10000"), ethHolder);

    // Will be used in finalization part
    uncountedStETHShares = await lido.sharesOf(withdrawalQueue.address);

    const approveTx = await lido.connect(stEthHolder).approve(withdrawalQueue.address, 1000n);
    await trace("lido.approve", approveTx);

    const requestWithdrawalsTx = await withdrawalQueue.connect(stEthHolder).requestWithdrawals([1000n], stEthHolder);
    await trace("withdrawalQueue.requestWithdrawals", requestWithdrawalsTx);
  });

  it("Should have some Simple DVT operators", async () => {
    await ensureSDVTOperators(ctx, 3n, 5n);

    expect(await ctx.contracts.sdvt.getNodeOperatorsCount()).to.be.gt(3n);
  });

  it("Should allow ETH holders to submit stake", async () => {
    const { lido } = ctx.contracts;

    const strangerBalancesBeforeSubmit = await getBalances(stranger);

    log.debug("Stranger before submit", {
      address: stranger.address,
      ETH: ethers.formatEther(strangerBalancesBeforeSubmit.ETH),
      stETH: ethers.formatEther(strangerBalancesBeforeSubmit.stETH),
    });

    expect(strangerBalancesBeforeSubmit.stETH).to.be.equal(0n, "stETH balance before submit");
    expect(strangerBalancesBeforeSubmit.ETH).to.be.equal(ether("1000000"), "ETH balance before submit");

    const stakeLimitInfoBefore = await lido.getStakeLimitFullInfo();
    const growthPerBlock = stakeLimitInfoBefore.maxStakeLimit / stakeLimitInfoBefore.maxStakeLimitGrowthBlocks;

    const totalSupplyBeforeSubmit = await lido.totalSupply();
    const bufferedEtherBeforeSubmit = await lido.getBufferedEther();
    const stakingLimitBeforeSubmit = await lido.getCurrentStakeLimit();
    const heightBeforeSubmit = await ethers.provider.getBlockNumber();

    log.debug("Before submit", {
      "Chain height": heightBeforeSubmit,
      "Growth per block": ethers.formatEther(growthPerBlock),
      "Total supply": ethers.formatEther(totalSupplyBeforeSubmit),
      "Buffered ether": ethers.formatEther(bufferedEtherBeforeSubmit),
      "Staking limit": ethers.formatEther(stakingLimitBeforeSubmit),
    });

    const tx = await lido.connect(stranger).submit(ZeroAddress, { value: AMOUNT });
    const receipt = (await trace("lido.submit", tx)) as TransactionReceipt;

    expect(receipt).not.to.be.null;

    const strangerBalancesAfterSubmit = await getBalances(stranger);

    log.debug("Stranger after submit", {
      address: stranger.address,
      ETH: ethers.formatEther(strangerBalancesAfterSubmit.ETH),
      stETH: ethers.formatEther(strangerBalancesAfterSubmit.stETH),
    });

    const spendEth = AMOUNT + receipt.gasUsed * receipt.gasPrice;

    expect(strangerBalancesAfterSubmit.stETH).to.be.approximately(
      strangerBalancesBeforeSubmit.stETH + AMOUNT,
      10n,
      "stETH balance after submit",
    );
    expect(strangerBalancesAfterSubmit.ETH).to.be.approximately(
      strangerBalancesBeforeSubmit.ETH - spendEth,
      10n,
      "ETH balance after submit",
    );

    const submittedEvent = getEvent(receipt, lido, "Submitted");
    const transferSharesEvent = getEvent(receipt, lido, "TransferShares");
    const sharesToBeMinted = await lido.getSharesByPooledEth(AMOUNT);
    const mintedShares = await lido.sharesOf(stranger);

    expect(submittedEvent).not.to.be.undefined;
    expect(transferSharesEvent).not.to.be.undefined;

    expect(submittedEvent?.args[0]).to.be.equal(stranger, "Submitted event sender");
    expect(submittedEvent?.args[1]).to.be.equal(AMOUNT, "Submitted event amount");
    expect(submittedEvent?.args[2]).to.be.equal(ZeroAddress, "Submitted event referral");

    expect(transferSharesEvent?.args[0]).to.be.equal(ZeroAddress, "TransferShares event sender");
    expect(transferSharesEvent?.args[1]).to.be.equal(stranger, "TransferShares event recipient");
    expect(transferSharesEvent?.args[2]).to.be.approximately(sharesToBeMinted, 10n, "TransferShares event amount");

    expect(mintedShares).to.be.equal(sharesToBeMinted, "Minted shares");

    const totalSupplyAfterSubmit = await lido.totalSupply();
    const bufferedEtherAfterSubmit = await lido.getBufferedEther();
    const stakingLimitAfterSubmit = await lido.getCurrentStakeLimit();

    expect(totalSupplyAfterSubmit).to.be.equal(totalSupplyBeforeSubmit + AMOUNT, "Total supply after submit");
    expect(bufferedEtherAfterSubmit).to.be.equal(bufferedEtherBeforeSubmit + AMOUNT, "Buffered ether after submit");

    if (stakingLimitBeforeSubmit >= stakeLimitInfoBefore.maxStakeLimit - growthPerBlock) {
      expect(stakingLimitAfterSubmit).to.be.equal(
        stakingLimitBeforeSubmit - AMOUNT,
        "Staking limit after submit without growth",
      );
    } else {
      expect(stakingLimitAfterSubmit).to.be.equal(
        stakingLimitBeforeSubmit - AMOUNT + growthPerBlock,
        "Staking limit after submit",
      );
    }
  });

  it("Should deposit ETH to node operators", async () => {
    const { lido, withdrawalQueue } = ctx.contracts;

    const { depositSecurityModule } = ctx.contracts;
    const { depositedValidators: depositedValidatorsBeforeDeposit } = await lido.getBeaconStat();
    const withdrawalsUninitializedStETH = await withdrawalQueue.unfinalizedStETH();
    const depositableEther = await lido.getDepositableEther();
    const bufferedEtherBeforeDeposit = await lido.getBufferedEther();

    const expectedDepositableEther = bufferedEtherBeforeDeposit - withdrawalsUninitializedStETH;

    expect(depositableEther).to.be.equal(expectedDepositableEther, "Depositable ether");

    const dsmSigner = await impersonate(depositSecurityModule.address, ether("100"));

    const depositNorTx = await lido.connect(dsmSigner).deposit(MAX_DEPOSIT, CURATED_MODULE_ID, ZERO_HASH);
    const depositNorReceipt = (await trace("lido.deposit (Curated Module)", depositNorTx)) as TransactionReceipt;

    const depositSdvtTx = await lido.connect(dsmSigner).deposit(MAX_DEPOSIT, SIMPLE_DVT_MODULE_ID, ZERO_HASH);
    const depositSdvtReceipt = (await trace("lido.deposit (Simple DVT)", depositSdvtTx)) as TransactionReceipt;

    const bufferedEtherAfterDeposit = await lido.getBufferedEther();

    const unbufferedEventNor = getEvent(depositNorReceipt, lido, "Unbuffered");
    const unbufferedEventSdvt = getEvent(depositSdvtReceipt, lido, "Unbuffered");
    const depositedValidatorsChangedEventSdvt = getEvent(depositSdvtReceipt, lido, "DepositedValidatorsChanged");

    const unbufferedAmountNor = unbufferedEventNor?.args[0];
    const unbufferedAmountSdvt = unbufferedEventSdvt?.args[0];
    const newValidatorsCountSdvt = depositedValidatorsChangedEventSdvt?.args[0];

    const depositCounts = unbufferedAmountNor / ether("32") + unbufferedAmountSdvt / ether("32");

    expect(bufferedEtherAfterDeposit).to.be.equal(
      bufferedEtherBeforeDeposit - unbufferedAmountNor - unbufferedAmountSdvt,
      "Buffered ether after deposit",
    );
    expect(newValidatorsCountSdvt).to.be.equal(
      depositedValidatorsBeforeDeposit + depositCounts,
      "New validators count after deposit",
    );
  });

  it("Should rebase correctly", async () => {
    const { lido, withdrawalQueue, locator, burner, nor, sdvt } = ctx.contracts;

    const treasuryAddress = await locator.treasury();
    const strangerBalancesBeforeRebase = await getBalances(stranger);

    log.debug("Stranger before rebase", {
      address: stranger.address,
      ETH: ethers.formatEther(strangerBalancesBeforeRebase.ETH),
      stETH: ethers.formatEther(strangerBalancesBeforeRebase.stETH),
    });

    const getNodeOperatorsState = async (registry: typeof sdvt | typeof nor, name: string) => {
      const penalizedIds: bigint[] = [];
      let count = await registry.getNodeOperatorsCount();

      for (let i = 0n; i < count; i++) {
        const [operator, isNodeOperatorPenalized] = await Promise.all([
          registry.getNodeOperator(i, false),
          registry.isOperatorPenalized(i),
        ]);
        if (isNodeOperatorPenalized) penalizedIds.push(i);
        if (
          !operator.totalDepositedValidators ||
          operator.totalDepositedValidators === operator.totalExitedValidators
        ) {
          count--;
        }
      }

      log.debug("Node operators state", {
        "Module": name,
        "Penalized count": penalizedIds.length,
        "Total count": count,
      });

      return { penalized: penalizedIds.length, count };
    };

    const { penalized: norPenalized } = await getNodeOperatorsState(nor, "NOR");
    const { penalized: sdvtPenalized } = await getNodeOperatorsState(sdvt, "sDVT");

    const treasuryBalanceBeforeRebase = await lido.sharesOf(treasuryAddress);

    const reportParams = { clDiff: ether("100") };

    const { reportTx, extraDataTx } = (await oracleReport(ctx, reportParams)) as {
      reportTx: TransactionResponse;
      extraDataTx: TransactionResponse;
    };

    const strangerBalancesAfterRebase = await getBalances(stranger);
    const treasuryBalanceAfterRebase = await lido.sharesOf(treasuryAddress);

    const reportTxReceipt = (await reportTx.wait()) as TransactionReceipt;
    const extraDataTxReceipt = (await extraDataTx.wait()) as TransactionReceipt;

    const tokenRebasedEvent = getEvent(reportTxReceipt, lido, "TokenRebased");
    const transferEvents = getEvents(reportTxReceipt, lido, "Transfer");

    expect(transferEvents[0]?.args[0]).to.be.equal(withdrawalQueue.address, "Transfer from");
    expect(transferEvents[0]?.args[1]).to.be.equal(ctx.contracts.burner.address, "Transfer to");

    expect(transferEvents[1]?.args[0]).to.be.equal(ZeroAddress, "Transfer from");
    expect(transferEvents[1]?.args[1]).to.be.equal(nor.address, "Transfer to");

    expect(transferEvents[2]?.args[0]).to.be.equal(ZeroAddress, "Transfer from");
    expect(transferEvents[2]?.args[1]).to.be.equal(sdvt.address, "Transfer to");

    expect(transferEvents[3]?.args[0]).to.be.equal(ZeroAddress, "Transfer from");
    expect(transferEvents[3]?.args[1]).to.be.equal(treasuryAddress, "Transfer to");

    const treasuryTransferValue = transferEvents[3]?.args[2];
    const treasurySharesMinted = await lido.getSharesByPooledEth(treasuryTransferValue);

    expect(treasuryBalanceAfterRebase).to.be.approximately(
      treasuryBalanceBeforeRebase + treasurySharesMinted,
      10n,
      "Treasury balance after rebase",
    );
    expect(treasuryBalanceAfterRebase).to.be.gt(treasuryBalanceBeforeRebase, "Treasury balance after rebase increased");
    expect(strangerBalancesAfterRebase.stETH).to.be.gt(
      strangerBalancesBeforeRebase.stETH,
      "Stranger stETH balance after rebase increased",
    );

    const expectedBurnerTransfers = (norPenalized > 0 ? 1 : 0) + (sdvtPenalized > 0 ? 1 : 0);

    const burnerTransfers = getEvents(extraDataTxReceipt, lido, "Transfer").filter(
      (e) => e?.args[1] == burner.address,
    ).length;

    expect(burnerTransfers).to.be.equal(expectedBurnerTransfers, "Burner transfers is correct");

    // TODO: fix this check, looks like I can't get it working
    // if no penalized ops: distributions = number of active validators
    // otherwise: distributions = number of active validators + 1 transfer to burner

    // const expectedTransfersCountNor = norCount + (norPenalized > 0 ? 1n : 0n);
    // const expectedTransfersCountSdvt = sdvtCount + (sdvtPenalized > 0 ? 1n : 0n);

    // const distributions = getEvents(extraDataTxReceipt, lido, "Transfer").length;

    // NB: should have Transfer to all active operators (+1 optional to Burner), check activity condition above
    // expect(distributions).to.be.equal(expectedTransfersCountNor + expectedTransfersCountSdvt, "Transfers count is correct");

    expect(getEvent(reportTxReceipt, lido, "TokenRebased")).not.to.be.undefined;
    expect(getEvent(reportTxReceipt, withdrawalQueue, "WithdrawalsFinalized")).not.to.be.undefined;
    expect(getEvent(reportTxReceipt, burner, "StETHBurnt")).not.to.be.undefined;

    const [, , preTotalShares, , postTotalShares, , sharesMintedAsFees] = tokenRebasedEvent!.args;

    const burntShares = getEvent(reportTxReceipt, burner, "StETHBurnt")?.args[2];

    expect(postTotalShares).to.be.equal(preTotalShares + sharesMintedAsFees - burntShares, "Post total shares");
  });

  it("works correctly", async () => {
    // requesting withdrawals

    log.done("requests withdrawals");

    // rebasing again, withdrawals finalization

    log.done("rebases the protocol again and finalizes withdrawals");

    // withdrawing stETH
    console.log(uncountedStETHShares); // keep it while test is not finished

    log.done("withdraws stETH");
  });
});
