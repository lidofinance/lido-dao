import { expect } from "chai";
import { LogDescription, TransactionReceipt, ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { batch, ether, impersonate, log, trace } from "lib";

import { Snapshot } from "test/suite";
import {
  AccountingOracleService,
  Contracts,
  getLidoProtocol,
  LidoProtocol,
  PauseService,
  SimpleDVTService
} from "test/suite/protocol";

describe("Protocol: All-round happy path", () => {
  let protocol: LidoProtocol;
  let contracts: Contracts;

  let snapshot: string;
  let pause: PauseService;
  let accounting: AccountingOracleService;
  let sdvt: SimpleDVTService;

  let ethHolder: HardhatEthersSigner;
  let stEthHolder: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  const amount = ether("100");

  before(async () => {
    protocol = await getLidoProtocol();
    ({ contracts, pause, accounting, sdvt } = protocol);

    await pause.unpauseStaking();
    await pause.unpauseWithdrawalQueue();

    const signers = await ethers.getSigners();

    ethHolder = await impersonate(signers[0].address, ether("1000000"));
    stEthHolder = await impersonate(signers[1].address, ether("1000000"));
    stranger = await impersonate(signers[2].address, ether("1000000"));

    // Fund the Lido contract with ETH
    const tx = await stEthHolder.sendTransaction({ to: contracts.lido.address, value: ether("10000") });
    await trace("stEthHolder.sendTransaction", tx);

    snapshot = await Snapshot.take();
  });

  after(async () => await Snapshot.restore(snapshot));

  const getWQRequestIds = async () =>
    Promise.all([contracts.withdrawalQueue.getLastFinalizedRequestId(), contracts.withdrawalQueue.getLastRequestId()]);

  const submitStake = async (amount: bigint) => {
    const tx = await contracts.lido.submit(ZeroAddress, { value: amount, from: ethHolder });
    await trace("lido.submit", tx);
  };

  it("works correctly", async () => {
    const { lido, withdrawalQueue } = contracts;

    expect(await lido.isStakingPaused()).to.be.false;
    expect(await withdrawalQueue.isPaused()).to.be.false;

    log.done("validates that the protocol is unpaused");

    let [lastFinalizedRequestId, lastRequestId] = await getWQRequestIds();

    while (lastFinalizedRequestId != lastRequestId) {
      await accounting.oracleReport();

      [lastFinalizedRequestId, lastRequestId] = await getWQRequestIds();

      log.debug("Withdrawal queue", {
        "Last finalized request ID": lastFinalizedRequestId,
        "Last request ID": lastRequestId
      });

      await submitStake(ether("10000"));
    }

    await submitStake(ether("10000"));

    log.done("finalizes the withdrawal queue");

    const getStrangerBalances = async (stranger: HardhatEthersSigner) =>
      batch({
        ETH: ethers.provider.getBalance(stranger),
        stETH: lido.balanceOf(stranger)
      });

    // const uncountedStETHShares = await lido.sharesOf(contracts.withdrawalQueue.address);
    const approveTx = await lido.connect(stEthHolder).approve(contracts.withdrawalQueue.address, 1000n);
    await trace("lido.approve", approveTx);

    const requestWithdrawalsTx = await withdrawalQueue.connect(stEthHolder).requestWithdrawals([1000n], stEthHolder);
    await trace("withdrawalQueue.requestWithdrawals", requestWithdrawalsTx);

    const balancesBeforeSubmit = await getStrangerBalances(stranger);

    log.debug("Stranger before submit", {
      address: stranger,
      ETH: ethers.formatEther(balancesBeforeSubmit.ETH),
      stETH: ethers.formatEther(balancesBeforeSubmit.stETH)
    });

    expect(balancesBeforeSubmit.stETH).to.be.equal(0n, "stETH balance before submit");
    expect(balancesBeforeSubmit.ETH).to.be.equal(ether("1000000"), "ETH balance before submit");

    log.done("allows to submit eth by stranger");

    await sdvt.fillOpsVettedKeys(3n, 5n);

    log.done("ensures Simple DVT has some keys to deposit");

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
      "Staking limit": ethers.formatEther(stakingLimitBeforeSubmit)
    });

    const tx = await lido.connect(stranger).submit(ZeroAddress, { value: amount });
    const receipt = await trace("lido.submit", tx) as TransactionReceipt;

    expect(receipt).not.to.be.null;

    const balancesAfterSubmit = await getStrangerBalances(stranger);

    log.debug("Stranger after submit", {
      address: stranger,
      ETH: ethers.formatEther(balancesAfterSubmit.ETH),
      stETH: ethers.formatEther(balancesAfterSubmit.stETH)
    });

    const spendEth = amount + receipt.cumulativeGasUsed;

    expect(balancesAfterSubmit.stETH).to.be.approximately(balancesBeforeSubmit.stETH + amount, 10n, "stETH balance after submit");
    expect(balancesAfterSubmit.ETH).to.be.approximately(balancesBeforeSubmit.ETH - spendEth, 10n, "ETH balance after submit");

    const logs = receipt.logs.map(l => lido.interface.parseLog(l)) as LogDescription[];

    const submittedEvent = logs.find(l => l.name === "Submitted");
    const transferSharesEvent = logs.find(l => l.name === "TransferShares");
    const sharesToBeMinted = await lido.getSharesByPooledEth(amount);
    const mintedShares = await lido.sharesOf(stranger);

    expect(submittedEvent).not.to.be.undefined;
    expect(transferSharesEvent).not.to.be.undefined;

    expect(submittedEvent!.args[0]).to.be.equal(stranger, "Submitted event sender");
    expect(submittedEvent!.args[1]).to.be.equal(amount, "Submitted event amount");
    expect(submittedEvent!.args[2]).to.be.equal(ZeroAddress, "Submitted event referral");

    expect(transferSharesEvent!.args[0]).to.be.equal(ZeroAddress, "TransferShares event sender");
    expect(transferSharesEvent!.args[1]).to.be.equal(stranger, "TransferShares event recipient");
    expect(transferSharesEvent!.args[2]).to.be.approximately(sharesToBeMinted, 10n, "TransferShares event amount");

    expect(mintedShares).to.be.equal(sharesToBeMinted, "Minted shares");

    const totalSupplyAfterSubmit = await lido.totalSupply();
    const bufferedEtherAfterSubmit = await lido.getBufferedEther();
    const stakingLimitAfterSubmit = await lido.getCurrentStakeLimit();

    expect(totalSupplyAfterSubmit).to.be.equal(totalSupplyBeforeSubmit + amount, "Total supply after submit");
    expect(bufferedEtherAfterSubmit).to.be.equal(bufferedEtherBeforeSubmit + amount, "Buffered ether after submit");

    if (stakingLimitBeforeSubmit >= stakeLimitInfoBefore.maxStakeLimit - growthPerBlock) {
      expect(stakingLimitAfterSubmit).to.be.equal(stakingLimitBeforeSubmit - amount, "Staking limit after submit without growth");
    } else {
      expect(stakingLimitAfterSubmit).to.be.equal(stakingLimitBeforeSubmit - amount + growthPerBlock, "Staking limit after submit");
    }

    log.done("submits eth to the Lido contract");
  });
});
