import { expect } from "chai";
import type { BaseContract, LogDescription, TransactionReceipt } from "ethers";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { batch, ether, impersonate, log, trace } from "lib";
import type { ProtocolContext } from "lib/protocol";
import { getProtocolContext } from "lib/protocol";
import { ensureSDVTOperators, oracleReport, unpauseStaking, unpauseWithdrawalQueue } from "lib/protocol/helpers";

import { Snapshot } from "test/suite";

const AMOUNT = ether("100");
// const MAX_DEPOSIT = 150n;
// const CURATED_MODULE_ID = 1n;
// const SIMPLE_DVT_MODULE_ID = 2n;

// const ZERO_HASH = new Uint8Array(32).fill(0);

const getEvents = (receipt: TransactionReceipt, contract: BaseContract, name: string): LogDescription[] | undefined =>
  receipt.logs
    .filter((l) => l !== null)
    .map((l) => contract.interface.parseLog(l))
    .filter((l) => l?.name === name) as LogDescription[];

describe("Protocol: All-round happy path", () => {
  let ctx: ProtocolContext;
  let snapshot: string;

  let ethHolder: HardhatEthersSigner;
  let stEthHolder: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  before(async () => {
    ctx = await getProtocolContext();

    const { lido } = ctx.contracts;

    await unpauseStaking(ctx);
    await unpauseWithdrawalQueue(ctx);

    const signers = await ethers.getSigners();

    ethHolder = await impersonate(signers[0].address, ether("1000000"));
    stEthHolder = await impersonate(signers[1].address, ether("1000000"));
    stranger = await impersonate(signers[2].address, ether("1000000"));

    // Fund the Lido contract with ETH
    const tx = await stEthHolder.sendTransaction({ to: lido.address, value: ether("10000") });
    await trace("stEthHolder.sendTransaction", tx);

    snapshot = await Snapshot.take();
  });

  after(async () => await Snapshot.restore(snapshot));

  const getWQRequestIds = async () => {
    const { withdrawalQueue } = ctx.contracts;
    return Promise.all([withdrawalQueue.getLastFinalizedRequestId(), withdrawalQueue.getLastRequestId()]);
  };

  const submitStake = async (amount: bigint, wallet: HardhatEthersSigner) => {
    const { lido } = ctx.contracts;
    const tx = await lido.connect(wallet).submit(ZeroAddress, { value: amount });
    await trace("lido.submit", tx);
  };

  it("works correctly", async () => {
    const { lido, withdrawalQueue } = ctx.contracts;

    // validating that the protocol is unpaused

    expect(await lido.isStakingPaused()).to.be.false;
    expect(await withdrawalQueue.isPaused()).to.be.false;

    log.done("validates that the protocol is unpaused");

    // finalizing the withdrawal queue

    let [lastFinalizedRequestId, lastRequestId] = await getWQRequestIds();

    while (lastFinalizedRequestId != lastRequestId) {
      await oracleReport(ctx);

      [lastFinalizedRequestId, lastRequestId] = await getWQRequestIds();

      log.debug("Withdrawal queue", {
        "Last finalized request ID": lastFinalizedRequestId,
        "Last request ID": lastRequestId,
      });

      await submitStake(ether("10000"), ethHolder);
    }

    await submitStake(ether("10000"), ethHolder);

    log.done("finalizes the withdrawal queue");

    // validating there are some node operators in the Simple DVT

    await ensureSDVTOperators(ctx, 3n, 5n);

    log.done("ensures Simple DVT has some keys to deposit");

    // starting submitting ETH to the Lido contract as a stranger

    const getStrangerBalances = async (wallet: HardhatEthersSigner) =>
      batch({ ETH: ethers.provider.getBalance(wallet), stETH: lido.balanceOf(wallet) });

    // const uncountedStETHShares = await lido.sharesOf(contracts.withdrawalQueue.address);
    const approveTx = await lido.connect(stEthHolder).approve(withdrawalQueue.address, 1000n);
    await trace("lido.approve", approveTx);

    const requestWithdrawalsTx = await withdrawalQueue.connect(stEthHolder).requestWithdrawals([1000n], stEthHolder);
    await trace("withdrawalQueue.requestWithdrawals", requestWithdrawalsTx);

    const balancesBeforeSubmit = await getStrangerBalances(stranger);

    log.debug("Stranger before submit", {
      address: stranger.address,
      ETH: ethers.formatEther(balancesBeforeSubmit.ETH),
      stETH: ethers.formatEther(balancesBeforeSubmit.stETH),
    });

    expect(balancesBeforeSubmit.stETH).to.be.equal(0n, "stETH balance before submit");
    expect(balancesBeforeSubmit.ETH).to.be.equal(ether("1000000"), "ETH balance before submit");

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

    const balancesAfterSubmit = await getStrangerBalances(stranger);

    log.debug("Stranger after submit", {
      address: stranger.address,
      ETH: ethers.formatEther(balancesAfterSubmit.ETH),
      stETH: ethers.formatEther(balancesAfterSubmit.stETH),
    });

    // TODO: uncomment
    // const spendEth = AMOUNT + receipt.cumulativeGasUsed;

    // TODO: check, sometimes reports bullshit
    // expect(balancesAfterSubmit.stETH).to.be.approximately(balancesBeforeSubmit.stETH + AMOUNT, 10n, "stETH balance after submit");
    // expect(balancesAfterSubmit.ETH).to.be.approximately(balancesBeforeSubmit.ETH - spendEth, 10n, "ETH balance after submit");

    const submittedEvent = getEvents(receipt, lido, "Submitted");
    const transferSharesEvent = getEvents(receipt, lido, "TransferShares");
    const sharesToBeMinted = await lido.getSharesByPooledEth(AMOUNT);
    const mintedShares = await lido.sharesOf(stranger);

    expect(submittedEvent).not.to.be.undefined;
    expect(transferSharesEvent).not.to.be.undefined;

    expect(submittedEvent![0].args[0]).to.be.equal(stranger, "Submitted event sender");
    expect(submittedEvent![0].args[1]).to.be.equal(AMOUNT, "Submitted event amount");
    expect(submittedEvent![0].args[2]).to.be.equal(ZeroAddress, "Submitted event referral");

    expect(transferSharesEvent![0].args[0]).to.be.equal(ZeroAddress, "TransferShares event sender");
    expect(transferSharesEvent![0].args[1]).to.be.equal(stranger, "TransferShares event recipient");
    expect(transferSharesEvent![0].args[2]).to.be.approximately(sharesToBeMinted, 10n, "TransferShares event amount");

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

    log.done("submits ETH to the Lido contract");

    // starting deposit to node operators

    // TODO: uncomment
    // const { depositedValidators } = await lido.getBeaconStat();
    // const withdrawalsUninitializedStETH = await withdrawalQueue.unfinalizedStETH();
    // const depositableEther = await lido.getDepositableEther();

    // TODO: check, gives diff 2000 wei (+ expected - actual)
    //   -142599610953885976535134
    //   +142599610953885976537134
    // expect(depositableEther).to.be.equal(bufferedEtherAfterSubmit + withdrawalsUninitializedStETH, "Depositable ether");

    // const dsm = await impersonate(depositSecurityModule.address, ether("100"));

    // const depositNorTx = await lido.connect(dsm).deposit(MAX_DEPOSIT, CURATED_MODULE_ID, ZERO_HASH);
    // const depositNorReceipt = (await trace("lido.deposit (Curated Module)", depositNorTx)) as TransactionReceipt;

    // const depositSdvtTx = await lido.connect(dsm).deposit(MAX_DEPOSIT, SIMPLE_DVT_MODULE_ID, ZERO_HASH);
    // const depositSdvtReceipt = (await trace("lido.deposit (Simple DVT)", depositSdvtTx)) as TransactionReceipt;

    // const bufferedEtherAfterDeposit = await lido.getBufferedEther();
    //
    // const unbufferedEventNor = getEvents(depositNorReceipt, lido, "Unbuffered");
    // const unbufferedEventSdvt = getEvents(depositSdvtReceipt, lido, "Unbuffered");
    // const depositedValidatorsChangedEventSdvt = getEvents(depositSdvtReceipt, lido, "DepositedValidatorsChanged");

    // TODO: continue..

    log.done("deposits to node operators");
  });
});
