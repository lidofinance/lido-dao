import { expect } from "chai";
import { ContractTransactionReceipt, LogDescription, ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import { setBalance } from "@nomicfoundation/hardhat-network-helpers";

import { ether, findEventsWithInterfaces, impersonate, ONE_GWEI, updateBalance } from "lib";
import { getProtocolContext, ProtocolContext } from "lib/protocol";
import { report } from "lib/protocol/helpers";

import { Snapshot } from "test/suite";

const LIMITER_PRECISION_BASE = BigInt(10 ** 9);

const SHARE_RATE_PRECISION = BigInt(10 ** 27);
const ONE_DAY = 86400n;
const MAX_BASIS_POINTS = 10000n;

describe("Accounting integration", () => {
  let ctx: ProtocolContext;
  let snapshot: string;

  beforeEach(async () => {
    ctx = await getProtocolContext();

    snapshot = await Snapshot.take();
  });

  afterEach(async () => await Snapshot.restore(snapshot));

  const getEvents = (receipt: ContractTransactionReceipt, eventName: string) => {
    return findEventsWithInterfaces(receipt, eventName, ctx.interfaces);
  };

  const getFirstEvent = (receipt: ContractTransactionReceipt, eventName: string) => {
    const events = getEvents(receipt, eventName);
    expect(events.length).to.be.greaterThan(0);
    return events[0];
  };

  const shareRateFromEvent = (tokenRebasedEvent: LogDescription) => {
    const sharesRateBefore =
      (tokenRebasedEvent.args.preTotalEther * SHARE_RATE_PRECISION) / tokenRebasedEvent.args.preTotalShares;
    const sharesRateAfter =
      (tokenRebasedEvent.args.postTotalEther * SHARE_RATE_PRECISION) / tokenRebasedEvent.args.postTotalShares;
    return { sharesRateBefore, sharesRateAfter };
  };

  const roundToGwei = (value: bigint) => {
    return (value / ONE_GWEI) * ONE_GWEI;
  };

  const rebaseLimitWei = async () => {
    const { oracleReportSanityChecker, lido } = ctx.contracts;

    const maxPositiveTokeRebase = await oracleReportSanityChecker.getMaxPositiveTokenRebase();
    const totalPooledEther = await lido.getTotalPooledEther();
    expect(maxPositiveTokeRebase).to.be.greaterThanOrEqual(0);
    expect(totalPooledEther).to.be.greaterThanOrEqual(0);
    return (maxPositiveTokeRebase * totalPooledEther) / LIMITER_PRECISION_BASE;
  };

  const getWithdrawalParams = (tx: ContractTransactionReceipt) => {
    const withdrawalsFinalized = getEvents(tx, "WithdrawalsFinalized");
    const amountOfETHLocked = withdrawalsFinalized.length > 0 ? withdrawalsFinalized[0].args.amountOfETHLocked : 0n;
    const sharesToBurn = withdrawalsFinalized.length > 0 ? withdrawalsFinalized[0].args.sharesToBurn : 0n;

    const sharesBurnt = getEvents(tx, "SharesBurnt");
    const sharesBurntAmount = sharesBurnt.length > 0 ? sharesBurnt[0].args.sharesAmount : 0n;

    return { amountOfETHLocked, sharesBurntAmount, sharesToBurn };
  };

  const sharesRateFromEvent = (tx: ContractTransactionReceipt) => {
    const tokenRebasedEvent = getFirstEvent(tx, "TokenRebased");
    expect(tokenRebasedEvent.args.preTotalEther).to.be.greaterThanOrEqual(0);
    expect(tokenRebasedEvent.args.postTotalEther).to.be.greaterThanOrEqual(0);
    return [
      (tokenRebasedEvent.args.preTotalEther * SHARE_RATE_PRECISION) / tokenRebasedEvent.args.preTotalShares,
      (tokenRebasedEvent.args.postTotalEther * SHARE_RATE_PRECISION) / tokenRebasedEvent.args.postTotalShares,
    ];
  };

  // Get shares burn limit from oracle report sanity checker contract when NO changes in pooled Ether are expected
  const sharesBurnLimitNoPooledEtherChanges = async () => {
    const rebaseLimit = await ctx.contracts.oracleReportSanityChecker.getMaxPositiveTokenRebase();
    const rebaseLimitPlus1 = rebaseLimit + LIMITER_PRECISION_BASE;

    return ((await ctx.contracts.lido.getTotalShares()) * rebaseLimit) / rebaseLimitPlus1;
  };

  it("Should account correctly with no CL rebase", async () => {
    const { lido, accountingOracle } = ctx.contracts;

    const lastProcessingRefSlotBefore = await accountingOracle.getLastProcessingRefSlot();
    const totalELRewardsCollectedBefore = await lido.getTotalELRewardsCollected();
    const totalPooledEtherBefore = await lido.getTotalPooledEther();
    const totalSharesBefore = await lido.getTotalShares();
    const ethBalanceBefore = await ethers.provider.getBalance(lido.address);

    // Report
    const { reportTx } = await report(ctx, { clDiff: 0n, excludeVaultsBalances: true });
    const reportTxReceipt = (await reportTx!.wait()) as ContractTransactionReceipt;

    const { amountOfETHLocked, sharesBurntAmount } = getWithdrawalParams(reportTxReceipt);

    const lastProcessingRefSlotAfter = await accountingOracle.getLastProcessingRefSlot();
    expect(lastProcessingRefSlotBefore).to.be.lessThan(lastProcessingRefSlotAfter);

    const totalELRewardsCollectedAfter = await lido.getTotalELRewardsCollected();
    expect(totalELRewardsCollectedBefore).to.equal(totalELRewardsCollectedAfter);

    const totalPooledEtherAfter = await lido.getTotalPooledEther();
    expect(totalPooledEtherBefore).to.equal(totalPooledEtherAfter + amountOfETHLocked);

    const totalSharesAfter = await lido.getTotalShares();
    expect(totalSharesBefore).to.equal(totalSharesAfter + sharesBurntAmount);

    const tokenRebasedEvent = getEvents(reportTxReceipt, "TokenRebased");
    const { sharesRateBefore, sharesRateAfter } = shareRateFromEvent(tokenRebasedEvent[0]);
    expect(sharesRateBefore).to.be.lessThanOrEqual(sharesRateAfter);

    const postTotalSharesEvent = getEvents(reportTxReceipt, "PostTotalShares");
    expect(postTotalSharesEvent[0].args.preTotalPooledEther).to.equal(
      postTotalSharesEvent[0].args.postTotalPooledEther + amountOfETHLocked,
    );

    const ethBalanceAfter = await ethers.provider.getBalance(lido.address);
    expect(ethBalanceBefore).to.equal(ethBalanceAfter + amountOfETHLocked);
  });

  it("Should account correctly with negative CL rebase", async () => {
    const { lido, accountingOracle } = ctx.contracts;

    const REBASE_AMOUNT = ether("-1000");

    const lastProcessingRefSlotBefore = await accountingOracle.getLastProcessingRefSlot();
    const totalELRewardsCollectedBefore = await lido.getTotalELRewardsCollected();
    const totalPooledEtherBefore = await lido.getTotalPooledEther();
    const totalSharesBefore = await lido.getTotalShares();

    // Report
    const { reportTx } = await report(ctx, { clDiff: REBASE_AMOUNT, excludeVaultsBalances: true });
    const reportTxReceipt = (await reportTx!.wait()) as ContractTransactionReceipt;

    const { amountOfETHLocked, sharesBurntAmount } = getWithdrawalParams(reportTxReceipt);

    const lastProcessingRefSlotAfter = await accountingOracle.getLastProcessingRefSlot();
    expect(lastProcessingRefSlotBefore).to.be.lessThan(lastProcessingRefSlotAfter);

    const totalELRewardsCollectedAfter = await lido.getTotalELRewardsCollected();
    expect(totalELRewardsCollectedBefore).to.equal(totalELRewardsCollectedAfter);

    const totalPooledEtherAfter = await lido.getTotalPooledEther();
    expect(totalPooledEtherBefore + REBASE_AMOUNT).to.equal(totalPooledEtherAfter + amountOfETHLocked);

    const totalSharesAfter = await lido.getTotalShares();
    expect(totalSharesBefore).to.equal(totalSharesAfter + sharesBurntAmount);

    const tokenRebasedEvent = getEvents(reportTxReceipt, "TokenRebased");
    const { sharesRateBefore, sharesRateAfter } = shareRateFromEvent(tokenRebasedEvent[0]);
    expect(sharesRateAfter).to.be.lessThan(sharesRateBefore);

    const ethDistributedEvent = getEvents(reportTxReceipt, "ETHDistributed");
    expect(ethDistributedEvent[0].args.preCLBalance + REBASE_AMOUNT).to.equal(
      ethDistributedEvent[0].args.postCLBalance,
    );

    const postTotalSharesEvent = getEvents(reportTxReceipt, "PostTotalShares");
    expect(postTotalSharesEvent[0].args.preTotalPooledEther + REBASE_AMOUNT).to.equal(
      postTotalSharesEvent[0].args.postTotalPooledEther + amountOfETHLocked,
    );
  });

  it("Should account correctly with positive CL rebase close to the limits", async () => {
    const { lido, accountingOracle, oracleReportSanityChecker, stakingRouter } = ctx.contracts;

    const annualIncreaseLimit = (await oracleReportSanityChecker.getOracleReportLimits())[2];
    const preCLBalance = (await lido.getBeaconStat()).slice(-1)[0];

    let rebaseAmount = (preCLBalance * annualIncreaseLimit * (ONE_DAY + 1n)) / (365n * ONE_DAY) / MAX_BASIS_POINTS;
    rebaseAmount = roundToGwei(rebaseAmount);

    const lastProcessingRefSlotBefore = await accountingOracle.getLastProcessingRefSlot();
    const totalELRewardsCollectedBefore = await lido.getTotalELRewardsCollected();
    const totalPooledEtherBefore = await lido.getTotalPooledEther();
    const totalSharesBefore = await lido.getTotalShares();

    // Report
    const { reportTx } = await report(ctx, { clDiff: rebaseAmount, excludeVaultsBalances: true });
    const reportTxReceipt = (await reportTx!.wait()) as ContractTransactionReceipt;

    const { amountOfETHLocked, sharesBurntAmount } = getWithdrawalParams(reportTxReceipt);

    const lastProcessingRefSlotAfter = await accountingOracle.getLastProcessingRefSlot();
    expect(lastProcessingRefSlotBefore).to.be.lessThan(lastProcessingRefSlotAfter);

    const totalELRewardsCollectedAfter = await lido.getTotalELRewardsCollected();
    expect(totalELRewardsCollectedBefore).to.equal(totalELRewardsCollectedAfter);

    const totalPooledEtherAfter = await lido.getTotalPooledEther();
    expect(totalPooledEtherBefore + rebaseAmount).to.equal(totalPooledEtherAfter + amountOfETHLocked);

    const sharesAsFeesList = getEvents(reportTxReceipt, "TransferShares").map((e) => e.args.sharesValue);
    let mintedSharesSum = 0n;

    if (amountOfETHLocked == 0) {
      expect(sharesAsFeesList.length).to.equal(3);

      const simpleDVTStats = await stakingRouter.getStakingModule(2);
      const simpleDVTTreasuryFee =
        (((sharesAsFeesList[1] * 10000n) / simpleDVTStats.stakingModuleFee) * simpleDVTStats.treasuryFee) / 10000n;
      expect(sharesAsFeesList[0] + simpleDVTTreasuryFee).to.approximately(sharesAsFeesList[2], 100);

      mintedSharesSum = sharesAsFeesList[0] + sharesAsFeesList[1] + sharesAsFeesList[2];
    } else {
      const stakingModulesCount = await stakingRouter.getStakingModulesCount();
      expect(sharesAsFeesList.length).to.equal(2n + stakingModulesCount);

      const simpleDVTStats = await stakingRouter.getStakingModule(2);
      const simpleDVTTreasuryFee =
        (((sharesAsFeesList[2] * 10000n) / simpleDVTStats.stakingModuleFee) * simpleDVTStats.treasuryFee) / 10000n;
      expect(sharesAsFeesList[1] + simpleDVTTreasuryFee).to.approximately(
        sharesAsFeesList[Number(stakingModulesCount) + 1],
        100,
      );

      mintedSharesSum = sharesAsFeesList[1] + sharesAsFeesList[2] + sharesAsFeesList[Number(stakingModulesCount) + 1];
    }

    const tokenRebasedEvent = getEvents(reportTxReceipt, "TokenRebased");
    expect(tokenRebasedEvent[0].args.sharesMintedAsFees).to.equal(mintedSharesSum);

    const totalSharesAfter = await lido.getTotalShares();
    expect(totalSharesBefore + mintedSharesSum).to.equal(totalSharesAfter + sharesBurntAmount);

    const { sharesRateBefore, sharesRateAfter } = shareRateFromEvent(tokenRebasedEvent[0]);
    expect(sharesRateAfter).to.be.greaterThan(sharesRateBefore);

    const ethDistributedEvent = getEvents(reportTxReceipt, "ETHDistributed");
    expect(ethDistributedEvent[0].args.preCLBalance + rebaseAmount).to.equal(ethDistributedEvent[0].args.postCLBalance);

    const postTotalSharesEvent = getEvents(reportTxReceipt, "PostTotalShares");
    expect(postTotalSharesEvent[0].args.preTotalPooledEther + rebaseAmount).to.equal(
      postTotalSharesEvent[0].args.postTotalPooledEther + amountOfETHLocked,
    );
  });

  it("Should reverts report on sanity checks", async () => {
    const { lido, oracleReportSanityChecker } = ctx.contracts;

    const maxCLRebaseViaLimiter = await rebaseLimitWei();
    const annualIncreaseLimit = (await oracleReportSanityChecker.getOracleReportLimits()).annualBalanceIncreaseBPLimit;
    const preCLBalance = (await lido.getBeaconStat()).slice(-1)[0];

    const rebaseAmount =
      (((annualIncreaseLimit + 1n) * ONE_DAY + 1n) * preCLBalance) / (365n * ONE_DAY) / MAX_BASIS_POINTS;

    expect(maxCLRebaseViaLimiter).to.be.greaterThan(rebaseAmount);

    await expect(report(ctx, { clDiff: rebaseAmount, excludeVaultsBalances: true }))
      .to.be.revertedWithCustomError(oracleReportSanityChecker, "IncorrectCLBalanceIncrease(uint256)")
      .withArgs(1001);
  });

  it("Should account correctly if no EL rewards", async () => {
    const { lido, accountingOracle } = ctx.contracts;

    const lastProcessingRefSlotBefore = await accountingOracle.getLastProcessingRefSlot();
    const totalELRewardsCollectedBefore = await lido.getTotalELRewardsCollected();
    const totalPooledEtherBefore = await lido.getTotalPooledEther();
    const totalSharesBefore = await lido.getTotalShares();
    const ethBalanceBefore = await ethers.provider.getBalance(lido.address);

    const { reportTx } = await report(ctx, { clDiff: 0n, excludeVaultsBalances: true });
    const reportTxReceipt = (await reportTx!.wait()) as ContractTransactionReceipt;

    const { amountOfETHLocked, sharesBurntAmount } = getWithdrawalParams(reportTxReceipt);

    const lastProcessingRefSlotAfter = await accountingOracle.getLastProcessingRefSlot();
    expect(lastProcessingRefSlotBefore).to.be.lessThan(lastProcessingRefSlotAfter);

    const totalELRewardsCollectedAfter = await lido.getTotalELRewardsCollected();
    expect(totalELRewardsCollectedBefore).to.equal(totalELRewardsCollectedAfter);

    const totalPooledEtherAfter = await lido.getTotalPooledEther();
    expect(totalPooledEtherBefore).to.equal(totalPooledEtherAfter + amountOfETHLocked);

    const totalSharesAfter = await lido.getTotalShares();
    expect(totalSharesBefore).to.equal(totalSharesAfter + sharesBurntAmount);

    const ethBalanceAfter = await ethers.provider.getBalance(lido.address);
    expect(ethBalanceBefore).to.equal(ethBalanceAfter + amountOfETHLocked);

    expect(getEvents(reportTxReceipt, "WithdrawalsReceived")).to.be.empty;
    expect(getEvents(reportTxReceipt, "ELRewardsReceived")).to.be.empty;
  });

  it("Should account correctly normal EL rewards", async () => {
    const { lido, accountingOracle, elRewardsVault } = ctx.contracts;

    await updateBalance(elRewardsVault.address, ether("1"));

    const elRewards = await ethers.provider.getBalance(elRewardsVault.address);
    expect(elRewards).to.be.greaterThan(0);

    const lastProcessingRefSlotBefore = await accountingOracle.getLastProcessingRefSlot();
    const totalELRewardsCollectedBefore = await lido.getTotalELRewardsCollected();
    const totalPooledEtherBefore = await lido.getTotalPooledEther();
    const totalSharesBefore = await lido.getTotalShares();
    const lidoBalanceBefore = await ethers.provider.getBalance(lido.address);

    const { reportTx } = await report(ctx, { clDiff: 0n, reportElVault: true, reportWithdrawalsVault: false });

    const reportTxReceipt = (await reportTx!.wait()) as ContractTransactionReceipt;

    const { amountOfETHLocked, sharesBurntAmount } = getWithdrawalParams(reportTxReceipt);

    const lastProcessingRefSlotAfter = await accountingOracle.getLastProcessingRefSlot();
    expect(lastProcessingRefSlotBefore).to.be.lessThan(lastProcessingRefSlotAfter);

    const totalELRewardsCollectedAfter = await lido.getTotalELRewardsCollected();
    expect(totalELRewardsCollectedBefore + elRewards).to.equal(totalELRewardsCollectedAfter);

    const elRewardsReceivedEvent = await getEvents(reportTxReceipt, "ELRewardsReceived")[0];
    expect(elRewardsReceivedEvent.args.amount).to.equal(elRewards);

    const totalPooledEtherAfter = await lido.getTotalPooledEther();
    expect(totalPooledEtherBefore + elRewards).to.equal(totalPooledEtherAfter + amountOfETHLocked);

    const totalSharesAfter = await lido.getTotalShares();
    expect(totalSharesBefore).to.equal(totalSharesAfter + sharesBurntAmount);

    const lidoBalanceAfter = await ethers.provider.getBalance(lido.address);
    expect(lidoBalanceBefore + elRewards).to.equal(lidoBalanceAfter + amountOfETHLocked);

    const elVaultBalanceAfter = await ethers.provider.getBalance(elRewardsVault.address);
    expect(elVaultBalanceAfter).to.equal(0);
  });

  it("Should account correctly EL rewards at limits", async () => {
    const { lido, accountingOracle, elRewardsVault } = ctx.contracts;

    const elRewards = await rebaseLimitWei();

    await impersonate(elRewardsVault.address, elRewards);

    const lastProcessingRefSlotBefore = await accountingOracle.getLastProcessingRefSlot();
    const totalELRewardsCollectedBefore = await lido.getTotalELRewardsCollected();
    const totalPooledEtherBefore = await lido.getTotalPooledEther();
    const totalSharesBefore = await lido.getTotalShares();
    const lidoBalanceBefore = await ethers.provider.getBalance(lido.address);

    const { reportTx } = await report(ctx, { clDiff: 0n, reportElVault: true, reportWithdrawalsVault: false });

    const reportTxReceipt = (await reportTx!.wait()) as ContractTransactionReceipt;

    const { amountOfETHLocked, sharesBurntAmount } = getWithdrawalParams(reportTxReceipt);

    const lastProcessingRefSlotAfter = await accountingOracle.getLastProcessingRefSlot();
    expect(lastProcessingRefSlotBefore).to.be.lessThan(lastProcessingRefSlotAfter);

    const totalELRewardsCollectedAfter = await lido.getTotalELRewardsCollected();
    expect(totalELRewardsCollectedBefore + elRewards).to.equal(totalELRewardsCollectedAfter);

    const elRewardsReceivedEvent = await getEvents(reportTxReceipt, "ELRewardsReceived")[0];
    expect(elRewardsReceivedEvent.args.amount).to.equal(elRewards);

    const totalPooledEtherAfter = await lido.getTotalPooledEther();
    expect(totalPooledEtherBefore + elRewards).to.equal(totalPooledEtherAfter + amountOfETHLocked);

    const totalSharesAfter = await lido.getTotalShares();
    expect(totalSharesBefore).to.equal(totalSharesAfter + sharesBurntAmount);

    const lidoBalanceAfter = await ethers.provider.getBalance(lido.address);
    expect(lidoBalanceBefore + elRewards).to.equal(lidoBalanceAfter + amountOfETHLocked);

    const elVaultBalanceAfter = await ethers.provider.getBalance(elRewardsVault.address);
    expect(elVaultBalanceAfter).to.equal(0);
  });

  it("Should account correctly EL rewards above limits", async () => {
    const { lido, accountingOracle, elRewardsVault } = ctx.contracts;

    const rewardsExcess = ether("10");
    const expectedRewards = await rebaseLimitWei();
    const elRewards = expectedRewards + rewardsExcess;

    await impersonate(elRewardsVault.address, elRewards);

    const lastProcessingRefSlotBefore = await accountingOracle.getLastProcessingRefSlot();
    const totalELRewardsCollectedBefore = await lido.getTotalELRewardsCollected();
    const totalPooledEtherBefore = await lido.getTotalPooledEther();
    const totalSharesBefore = await lido.getTotalShares();
    const lidoBalanceBefore = await ethers.provider.getBalance(lido.address);

    const { reportTx } = await report(ctx, { clDiff: 0n, reportElVault: true, reportWithdrawalsVault: false });

    const reportTxReceipt = (await reportTx!.wait()) as ContractTransactionReceipt;

    const { amountOfETHLocked, sharesBurntAmount } = getWithdrawalParams(reportTxReceipt);

    const lastProcessingRefSlotAfter = await accountingOracle.getLastProcessingRefSlot();
    expect(lastProcessingRefSlotBefore).to.be.lessThan(lastProcessingRefSlotAfter);

    const totalELRewardsCollectedAfter = await lido.getTotalELRewardsCollected();
    expect(totalELRewardsCollectedBefore + expectedRewards).to.equal(totalELRewardsCollectedAfter);

    const elRewardsReceivedEvent = await getEvents(reportTxReceipt, "ELRewardsReceived")[0];
    expect(elRewardsReceivedEvent.args.amount).to.equal(expectedRewards);

    const totalPooledEtherAfter = await lido.getTotalPooledEther();
    expect(totalPooledEtherBefore + expectedRewards).to.equal(totalPooledEtherAfter + amountOfETHLocked);

    const totalSharesAfter = await lido.getTotalShares();
    expect(totalSharesBefore).to.equal(totalSharesAfter + sharesBurntAmount);

    const lidoBalanceAfter = await ethers.provider.getBalance(lido.address);
    expect(lidoBalanceBefore + expectedRewards).equal(lidoBalanceAfter + amountOfETHLocked);

    const elVaultBalanceAfter = await ethers.provider.getBalance(elRewardsVault.address);
    expect(elVaultBalanceAfter).to.equal(rewardsExcess);
  });

  it("Should account correctly with no withdrawals", async () => {
    const { lido, accountingOracle } = ctx.contracts;

    const lastProcessingRefSlotBefore = await accountingOracle.getLastProcessingRefSlot();
    const totalELRewardsCollectedBefore = await lido.getTotalELRewardsCollected();
    const totalPooledEtherBefore = await lido.getTotalPooledEther();
    const totalSharesBefore = await lido.getTotalShares();
    const lidoBalanceBefore = await ethers.provider.getBalance(lido.address);

    const { reportTx } = await report(ctx, { clDiff: 0n, excludeVaultsBalances: true });

    const reportTxReceipt = (await reportTx!.wait()) as ContractTransactionReceipt;

    const { amountOfETHLocked, sharesBurntAmount } = getWithdrawalParams(reportTxReceipt);

    const lastProcessingRefSlotAfter = await accountingOracle.getLastProcessingRefSlot();
    expect(lastProcessingRefSlotBefore).to.be.lessThan(lastProcessingRefSlotAfter);

    const totalELRewardsCollectedAfter = await lido.getTotalELRewardsCollected();
    expect(totalELRewardsCollectedBefore).to.equal(totalELRewardsCollectedAfter);

    const totalPooledEtherAfter = await lido.getTotalPooledEther();
    expect(totalPooledEtherBefore).to.equal(totalPooledEtherAfter + amountOfETHLocked);

    const totalSharesAfter = await lido.getTotalShares();
    expect(totalSharesBefore).to.equal(totalSharesAfter + sharesBurntAmount);

    const lidoBalanceAfter = await ethers.provider.getBalance(lido.address);
    expect(lidoBalanceBefore).to.equal(lidoBalanceAfter + amountOfETHLocked);

    expect(getEvents(reportTxReceipt, "WithdrawalsReceived").length).be.equal(0);
    expect(getEvents(reportTxReceipt, "ELRewardsReceived").length).be.equal(0);
  });

  it("Should account correctly with withdrawals at limits", async () => {
    const { lido, accountingOracle, withdrawalVault, stakingRouter } = ctx.contracts;

    const withdrawals = await rebaseLimitWei();
    await impersonate(withdrawalVault.address, withdrawals);

    const lastProcessingRefSlotBefore = await accountingOracle.getLastProcessingRefSlot();
    const totalELRewardsCollectedBefore = await lido.getTotalELRewardsCollected();
    const totalPooledEtherBefore = await lido.getTotalPooledEther();
    const totalSharesBefore = await lido.getTotalShares();

    const { reportTx } = await report(ctx, { clDiff: 0n, reportElVault: false, reportWithdrawalsVault: true });

    const reportTxReceipt = (await reportTx!.wait()) as ContractTransactionReceipt;

    const { amountOfETHLocked, sharesBurntAmount } = getWithdrawalParams(reportTxReceipt);

    const lastProcessingRefSlotAfter = await accountingOracle.getLastProcessingRefSlot();
    expect(lastProcessingRefSlotBefore).to.be.lessThan(lastProcessingRefSlotAfter);

    const totalELRewardsCollectedAfter = await lido.getTotalELRewardsCollected();
    expect(totalELRewardsCollectedBefore).to.equal(totalELRewardsCollectedAfter);

    const totalPooledEtherAfter = await lido.getTotalPooledEther();
    expect(totalPooledEtherBefore + withdrawals).to.equal(totalPooledEtherAfter + amountOfETHLocked);

    const sharesAsFeesList = (await getEvents(reportTxReceipt, "TransferShares")).map((e) => e.args.sharesValue);

    let mintedSharesSum = 0n;

    if (amountOfETHLocked == 0) {
      // no withdrawals processed
      // Expected transfer of shares to NodeOperatorsRegistry, sDVT and DAO
      expect(sharesAsFeesList.length).to.equal(3);

      const simpleDVTStats = await stakingRouter.getStakingModule(2);
      const simpleDVTTreasuryFee =
        (((sharesAsFeesList[1] * 10000n) / simpleDVTStats.stakingModuleFee) * simpleDVTStats.treasuryFee) / 10000n;

      // Shares minted to DAO and NodeOperatorsRegistry mismatch
      expect(sharesAsFeesList[0] + simpleDVTTreasuryFee).to.approximately(sharesAsFeesList[2], 100);

      mintedSharesSum = sharesAsFeesList[0] + sharesAsFeesList[1] + sharesAsFeesList[2];
    } else {
      const stakingModulesCount = await stakingRouter.getStakingModulesCount();

      // Expected transfer of shares to NodeOperatorsRegistry and DAO
      expect(sharesAsFeesList.length).to.equal(2n + stakingModulesCount);

      const simpleDVTStats = await stakingRouter.getStakingModule(2);
      const simpleDVTTreasuryFee =
        (((sharesAsFeesList[2] * 10000n) / simpleDVTStats.stakingModuleFee) * simpleDVTStats.treasuryFee) / 10000n;

      // Shares minted to DAO and NodeOperatorsRegistry mismatch
      expect(sharesAsFeesList[1] + simpleDVTTreasuryFee).to.approximately(
        sharesAsFeesList[Number(stakingModulesCount) + 1],
        100,
      );

      mintedSharesSum = sharesAsFeesList[1] + sharesAsFeesList[2] + sharesAsFeesList[3];
    }

    const tokenRebasedEvent = getFirstEvent(reportTxReceipt, "TokenRebased");
    expect(tokenRebasedEvent.args.sharesMintedAsFees).to.equal(mintedSharesSum);

    const totalSharesAfter = await lido.getTotalShares();
    expect(totalSharesBefore + mintedSharesSum).to.equal(totalSharesAfter + sharesBurntAmount);

    const [sharesRateBefore, sharesRateAfter] = sharesRateFromEvent(reportTxReceipt);
    expect(sharesRateAfter).to.be.greaterThan(sharesRateBefore);

    const withdrawalsReceivedEvent = getEvents(reportTxReceipt, "WithdrawalsReceived")[0];
    expect(withdrawalsReceivedEvent.args.amount).to.equal(withdrawals);

    const withdrawalVaultBalanceAfter = await ethers.provider.getBalance(withdrawalVault.address);
    expect(withdrawalVaultBalanceAfter).to.equal(0);
  });

  it("Should account correctly with withdrawals above limits", async () => {
    const { lido, accountingOracle, withdrawalVault, stakingRouter } = ctx.contracts;

    const expectedWithdrawals = await rebaseLimitWei();
    const withdrawalsExcess = ether("10");
    const withdrawals = expectedWithdrawals + withdrawalsExcess;
    await impersonate(withdrawalVault.address, withdrawals);

    const lastProcessingRefSlotBefore = await accountingOracle.getLastProcessingRefSlot();
    const totalELRewardsCollectedBefore = await lido.getTotalELRewardsCollected();
    const totalPooledEtherBefore = await lido.getTotalPooledEther();
    const totalSharesBefore = await lido.getTotalShares();

    const { reportTx } = await report(ctx, { clDiff: 0n, reportElVault: false, reportWithdrawalsVault: true });

    const reportTxReceipt = (await reportTx!.wait()) as ContractTransactionReceipt;

    const { amountOfETHLocked, sharesBurntAmount } = getWithdrawalParams(reportTxReceipt);

    const lastProcessingRefSlotAfter = await accountingOracle.getLastProcessingRefSlot();
    expect(lastProcessingRefSlotBefore).to.be.lessThan(lastProcessingRefSlotAfter);

    const totalELRewardsCollectedAfter = await lido.getTotalELRewardsCollected();
    expect(totalELRewardsCollectedBefore).to.equal(totalELRewardsCollectedAfter);

    const totalPooledEtherAfter = await lido.getTotalPooledEther();
    expect(totalPooledEtherBefore + expectedWithdrawals).to.equal(totalPooledEtherAfter + amountOfETHLocked);

    const sharesAsFeesList = (await getEvents(reportTxReceipt, "TransferShares")).map((e) => e.args.sharesValue);

    let mintedSharesSum = 0n;

    if (amountOfETHLocked == 0) {
      // no withdrawals processed
      // Expected transfer of shares to NodeOperatorsRegistry, sDVT and DAO
      expect(sharesAsFeesList.length).to.equal(3);

      const simpleDVTStats = await stakingRouter.getStakingModule(2);
      const simpleDVTTreasuryFee =
        (((sharesAsFeesList[1] * 10000n) / simpleDVTStats.stakingModuleFee) * simpleDVTStats.treasuryFee) / 10000n;

      // Shares minted to DAO and NodeOperatorsRegistry mismatch
      expect(sharesAsFeesList[0] + simpleDVTTreasuryFee).to.approximately(sharesAsFeesList[2], 100);

      mintedSharesSum = sharesAsFeesList[0] + sharesAsFeesList[1] + sharesAsFeesList[2];
    } else {
      const stakingModulesCount = await stakingRouter.getStakingModulesCount();

      // Expected transfer of shares to NodeOperatorsRegistry and DAO
      expect(sharesAsFeesList.length).to.equal(2n + stakingModulesCount);

      // transfer recipients:
      // 0 - burner
      // 1 - staking_modules[0] : node operators registry
      // 2 - staking_modules[1] : simple DVT
      // 3 - treasury

      // the staking modules ids starts from 1, so SDVT has id = 2
      const simpleDVTStats = await stakingRouter.getStakingModule(2);
      const simpleDVTTreasuryFee =
        (((sharesAsFeesList[2] * 10000n) / simpleDVTStats.stakingModuleFee) * simpleDVTStats.treasuryFee) / 10000n;

      // Shares minted to DAO and NodeOperatorsRegistry mismatch
      expect(sharesAsFeesList[1] + simpleDVTTreasuryFee).to.approximately(
        sharesAsFeesList[Number(stakingModulesCount) + 1],
        100,
      );

      mintedSharesSum = sharesAsFeesList[1] + sharesAsFeesList[2] + sharesAsFeesList[3];
    }

    const tokenRebasedEvent = getFirstEvent(reportTxReceipt, "TokenRebased");
    expect(tokenRebasedEvent.args.sharesMintedAsFees).to.equal(mintedSharesSum);

    const totalSharesAfter = await lido.getTotalShares();
    expect(totalSharesBefore + mintedSharesSum).to.equal(totalSharesAfter + sharesBurntAmount);

    const [sharesRateBefore, sharesRateAfter] = sharesRateFromEvent(reportTxReceipt);
    expect(sharesRateAfter).to.be.greaterThan(sharesRateBefore);

    const withdrawalsReceivedEvent = getFirstEvent(reportTxReceipt, "WithdrawalsReceived");
    expect(withdrawalsReceivedEvent.args.amount).to.equal(expectedWithdrawals);

    const withdrawalVaultBalanceAfter = await ethers.provider.getBalance(withdrawalVault.address);
    expect(withdrawalVaultBalanceAfter).to.equal(withdrawalsExcess);
  });

  it("Should account correctly shares burn at limits", async () => {
    const { lido, burner, wstETH } = ctx.contracts;

    const sharesLimit = await sharesBurnLimitNoPooledEtherChanges();
    const initialBurnerBalance = await lido.sharesOf(burner.address);
    expect(await lido.sharesOf(wstETH.address)).to.be.greaterThan(sharesLimit);

    const stethOfShares = await lido.getPooledEthByShares(sharesLimit);
    const wstEthSigner = await impersonate(wstETH.address, ether("1"));
    await lido.connect(wstEthSigner).approve(burner.address, stethOfShares);

    const coverShares = sharesLimit / 3n;
    const noCoverShares = sharesLimit - sharesLimit / 3n;

    const lidoSigner = await impersonate(lido.address);

    const tx1 = await burner.connect(lidoSigner).requestBurnShares(wstETH.address, noCoverShares);
    const tx1Receipt = (await tx1.wait()) as ContractTransactionReceipt;
    const sharesBurntRequestEvent1 = getFirstEvent(tx1Receipt, "StETHBurnRequested");
    expect(sharesBurntRequestEvent1.args.amountOfShares).to.equal(noCoverShares);
    expect(sharesBurntRequestEvent1.args.isCover).to.be.false;
    expect(await lido.sharesOf(burner.address)).to.equal(noCoverShares + initialBurnerBalance);

    const tx2 = await burner.connect(lidoSigner).requestBurnSharesForCover(wstETH.address, coverShares);
    const tx2Receipt = (await tx2.wait()) as ContractTransactionReceipt;
    const sharesBurntRequestEvent2 = getFirstEvent(tx2Receipt, "StETHBurnRequested");
    expect(sharesBurntRequestEvent2.args.amountOfShares).to.equal(coverShares);
    expect(sharesBurntRequestEvent2.args.isCover).to.be.true;
    expect(await lido.sharesOf(burner.address)).to.equal(sharesLimit + initialBurnerBalance);

    const totalSharesBefore = await lido.getTotalShares();

    const { reportTx } = await report(ctx, { clDiff: 0n, excludeVaultsBalances: true });

    const reportTxReceipt = (await reportTx!.wait()) as ContractTransactionReceipt;

    const { sharesBurntAmount, sharesToBurn } = getWithdrawalParams(reportTxReceipt);

    const burntDueToWithdrawals = sharesToBurn - (await lido.sharesOf(burner.address)) + initialBurnerBalance;
    expect(burntDueToWithdrawals).to.be.greaterThan(0);

    expect(sharesBurntAmount - burntDueToWithdrawals).to.equal(sharesLimit);
    const [sharesRateBefore, sharesRateAfter] = sharesRateFromEvent(reportTxReceipt);

    expect(sharesRateAfter).to.be.greaterThan(sharesRateBefore);

    expect(totalSharesBefore - sharesLimit).to.equal((await lido.getTotalShares()) + burntDueToWithdrawals);
  });

  it("Should account correctly shares burn above limits", async () => {
    const { lido, burner, wstETH, withdrawalQueue } = ctx.contracts;

    const [ethWhale] = await ethers.getSigners();

    while ((await withdrawalQueue.getLastRequestId()) != (await withdrawalQueue.getLastFinalizedRequestId())) {
      await report(ctx);
      await lido.connect(ethWhale).submit(ZeroAddress, { value: ether("10000") });
    }

    const sharesLimit = await sharesBurnLimitNoPooledEtherChanges();
    const excessAmount = 42n;

    const initialBurnerBalance = await lido.sharesOf(burner.address);
    expect(initialBurnerBalance).to.equal(0);

    expect(await lido.sharesOf(wstETH.address)).to.be.greaterThan(sharesLimit + excessAmount);
    const stethOfShares = await lido.getPooledEthByShares(sharesLimit + excessAmount);

    const wstEthSigner = await impersonate(wstETH.address, ether("1"));
    await lido.connect(wstEthSigner).approve(burner.address, stethOfShares);

    const coverShares = sharesLimit / 3n;
    const noCoverShares = sharesLimit - sharesLimit / 3n + excessAmount;

    const lidoSigner = await impersonate(lido.address);

    const tx1 = await burner.connect(lidoSigner).requestBurnShares(wstETH.address, noCoverShares);
    const tx1Receipt = (await tx1.wait()) as ContractTransactionReceipt;
    const sharesBurntRequestEvent1 = getFirstEvent(tx1Receipt, "StETHBurnRequested");
    expect(sharesBurntRequestEvent1.args.amountOfShares).to.equal(noCoverShares);
    expect(sharesBurntRequestEvent1.args.isCover).to.be.false;
    expect(await lido.sharesOf(burner.address)).to.equal(noCoverShares + initialBurnerBalance);

    const tx2 = await burner.connect(lidoSigner).requestBurnSharesForCover(wstETH.address, coverShares);
    const tx2Receipt = (await tx2.wait()) as ContractTransactionReceipt;
    const sharesBurntRequestEvent2 = getFirstEvent(tx2Receipt, "StETHBurnRequested");
    expect(sharesBurntRequestEvent2.args.amountOfShares).to.equal(coverShares);
    expect(sharesBurntRequestEvent2.args.isCover).to.be.true;
    expect(await lido.sharesOf(burner.address)).to.equal(sharesLimit + excessAmount + initialBurnerBalance);

    const totalSharesBefore = await lido.getTotalShares();

    const { reportTx } = await report(ctx, { clDiff: 0n, excludeVaultsBalances: true });
    const reportTxReceipt = (await reportTx!.wait()) as ContractTransactionReceipt;

    const { sharesBurntAmount, sharesToBurn } = getWithdrawalParams(reportTxReceipt);

    const burntDueToWithdrawals =
      sharesToBurn - (await lido.sharesOf(burner.address)) + initialBurnerBalance + excessAmount;
    expect(burntDueToWithdrawals).to.be.greaterThanOrEqual(0);

    expect(sharesBurntAmount - burntDueToWithdrawals).to.equal(sharesLimit);
    const [sharesRateBefore, sharesRateAfter] = sharesRateFromEvent(reportTxReceipt);

    expect(sharesRateAfter).to.be.greaterThan(sharesRateBefore);

    expect(totalSharesBefore - sharesLimit).to.equal((await lido.getTotalShares()) + burntDueToWithdrawals);

    const extraShares = await lido.sharesOf(burner.address);
    expect(extraShares).to.be.greaterThanOrEqual(excessAmount);

    const report2 = await report(ctx, { clDiff: 0n, excludeVaultsBalances: true });
    const reportTxReceipt2 = (await report2.reportTx!.wait()) as ContractTransactionReceipt;

    const params2 = getWithdrawalParams(reportTxReceipt2);
    expect(params2.sharesBurntAmount).to.equal(extraShares);
    expect(await lido.sharesOf(burner.address)).to.equal(0);
  });

  it("Should account correctly overfill both vaults", async () => {
    const { lido, withdrawalQueue, withdrawalVault, elRewardsVault } = ctx.contracts;

    const [ethWhale] = await ethers.getSigners();

    while ((await withdrawalQueue.getLastRequestId()) != (await withdrawalQueue.getLastFinalizedRequestId())) {
      await report(ctx);
      await lido.connect(ethWhale).submit(ZeroAddress, { value: ether("10000") });
    }

    const limit = await rebaseLimitWei();
    const excess = ether("10");

    await setBalance(withdrawalVault.address, limit + excess);
    await setBalance(elRewardsVault.address, limit + excess);

    const totalELRewardsCollectedBefore = await lido.getTotalELRewardsCollected();
    const totalPooledEtherBefore = await lido.getTotalPooledEther();
    const ethBalanceBefore = await ethers.provider.getBalance(lido.address);

    let elVaultExcess = 0n;
    let amountOfETHLocked = 0n;
    let updatedLimit = 0n;
    {
      const { reportTx } = await report(ctx, { clDiff: 0n, reportElVault: true, reportWithdrawalsVault: true });
      const reportTxReceipt = (await reportTx!.wait()) as ContractTransactionReceipt;

      updatedLimit = await rebaseLimitWei();
      elVaultExcess = limit + excess - (updatedLimit - excess);

      amountOfETHLocked = getWithdrawalParams(reportTxReceipt).amountOfETHLocked;

      expect(await ethers.provider.getBalance(withdrawalVault.address)).to.equal(excess);
      const withdrawalsReceivedEvent = getFirstEvent(reportTxReceipt, "WithdrawalsReceived");
      expect(withdrawalsReceivedEvent.args.amount).to.equal(limit);

      expect(await ethers.provider.getBalance(elRewardsVault.address)).to.equal(limit + excess);
    }
    {
      const { reportTx } = await report(ctx, { clDiff: 0n, reportElVault: true, reportWithdrawalsVault: true });
      const reportTxReceipt = (await reportTx!.wait()) as ContractTransactionReceipt;

      expect(await ethers.provider.getBalance(withdrawalVault.address)).to.equal(0);
      const withdrawalsReceivedEvent = getFirstEvent(reportTxReceipt, "WithdrawalsReceived");
      expect(withdrawalsReceivedEvent.args.amount).to.equal(excess);

      expect(await ethers.provider.getBalance(elRewardsVault.address)).to.equal(elVaultExcess);
      const elRewardsEvent = getFirstEvent(reportTxReceipt, "ELRewardsReceived");
      expect(elRewardsEvent.args.amount).to.equal(updatedLimit - excess);
    }
    {
      const { reportTx } = await report(ctx, { clDiff: 0n, reportElVault: true, reportWithdrawalsVault: true });
      const reportTxReceipt = (await reportTx!.wait()) as ContractTransactionReceipt;

      expect(getEvents(reportTxReceipt, "WithdrawalsReceived")).to.be.empty;
      expect(await ethers.provider.getBalance(elRewardsVault.address)).to.equal(0);
      const rewardsEvent = getFirstEvent(reportTxReceipt, "ELRewardsReceived");
      expect(rewardsEvent.args.amount).to.equal(elVaultExcess);

      expect(totalELRewardsCollectedBefore + limit + excess).to.equal(await lido.getTotalELRewardsCollected());
      const totalPooledEtherAfter = await lido.getTotalPooledEther();
      console.log(totalPooledEtherBefore, limit, excess, totalPooledEtherAfter, amountOfETHLocked);
      // expect(totalPooledEtherBefore + (limit + excess) * 2n).to.equal(await lido.getTotalPooledEther() + amountOfETHLocked);
      expect(ethBalanceBefore + (limit + excess) * 2n).to.equal(
        (await ethers.provider.getBalance(lido.address)) + amountOfETHLocked,
      );
    }
  });
});
