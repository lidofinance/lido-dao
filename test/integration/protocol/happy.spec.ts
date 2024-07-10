import { expect } from "chai";
import { ZeroAddress } from "ethers";
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

  let balancesBeforeSubmit: { ETH: bigint; stETH: bigint };

  // const amount = ether("100");

  before(async () => {
    protocol = await getLidoProtocol();
    ({ contracts, pause, accounting, sdvt } = protocol);

    await pause.unpauseStaking();
    await pause.unpauseWithdrawalQueue();

    const signers = await ethers.getSigners();

    ethHolder = await impersonate(signers[0].address, ether("1000000"));
    stEthHolder = await impersonate(signers[1].address, ether("1000000"));
    stranger = await impersonate(signers[2].address);

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
    expect(await contracts.lido.isStakingPaused()).to.be.false;
    expect(await contracts.withdrawalQueue.isPaused()).to.be.false;

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
        ETH: ethers.provider.getBalance(stranger.address),
        stETH: contracts.lido.balanceOf(stranger.address)
      });

    // const uncountedStETHShares = await contracts.lido.sharesOf(contracts.withdrawalQueue.address);
    const approveTx = await contracts.lido.connect(stEthHolder).approve(contracts.withdrawalQueue.address, 1000n);
    await trace("lido.approve", approveTx);

    const requestWithdrawalsTx = await contracts.withdrawalQueue
      .connect(stEthHolder)
      .requestWithdrawals([1000n], stEthHolder);
    await trace("withdrawalQueue.requestWithdrawals", requestWithdrawalsTx);

    balancesBeforeSubmit = await getStrangerBalances(stranger);

    log.debug("Stranger before submit", {
      address: stranger.address,
      ETH: ethers.formatEther(balancesBeforeSubmit.ETH),
      stETH: ethers.formatEther(balancesBeforeSubmit.stETH)
    });

    expect(balancesBeforeSubmit.stETH).to.be.equal(0n);

    log.done("allows to submit eth by stranger");

    await sdvt.fillOpsVettedKeys(41n, 5n);

    log.done("ensures Simple DVT has some keys to deposit");

    // const stakeLimitInfoBefore = await contracts.lido.getStakeLimitFullInfo();
    //
    // const growthPerBlock = stakeLimitInfoBefore.maxStakeLimit;
    // const totalSupplyBeforeSubmit = await contracts.lido.totalSupply();
    // const bufferedEtherBeforeSubmit = await contracts.lido.getBufferedEther();
    // const stakingLimitBeforeSubmit = await contracts.lido.getCurrentStakeLimit();
    // const heightBeforeSubmit = await ethers.provider.getBlockNumber();
    //
    // log.debug("Before submit", {
    //   "Chain height": heightBeforeSubmit,
    //   "Growth per block": ethers.formatEther(growthPerBlock),
    //   "Total supply": ethers.formatEther(totalSupplyBeforeSubmit),
    //   "Buffered ether": ethers.formatEther(bufferedEtherBeforeSubmit),
    //   "Staking limit": ethers.formatEther(stakingLimitBeforeSubmit),
    // });

    // const tx = await contracts.lido.connect(stranger).submit(ZeroAddress, { value: amount, from: stranger });
    // const receipt = await tx.wait();
    //
    // const stEthBalanceAfterSubmit = await contracts.lido.balanceOf(stranger.address);
    // const strangerBalanceAfterSubmit = await ethers.provider.getBalance(stranger.address);
    //
    // log.debug("Stranger after submit", {
    //   ETH: ethers.formatEther(strangerBalanceAfterSubmit),
    //   stETH: ethers.formatEther(stEthBalanceAfterSubmit)
    // });
    //
    // const balanceChange = BigIntMath.abs(strangerBalanceAfterSubmit - balancesBeforeSubmit.ETH);
    // const gasUsed = receipt!.cumulativeGasUsed * receipt!.gasPrice!;
    // const balanceChangeDiff = BigIntMath.abs(balanceChange - amount - gasUsed);
    // expect(balanceChangeDiff).to.be.approximately(amount, 10n); // 0 <= x < 10
    //
    // const stEthBalanceChange = BigIntMath.abs(stEthBalanceAfterSubmit - balancesBeforeSubmit.stETH);
    // const stEthBalanceChangeDiff = BigIntMath.abs(stEthBalanceChange - amount);
    // expect(stEthBalanceChangeDiff).to.be.approximately(amount, 10n); // 0 <= x < 10
    //
    // log.debug("Balance changes", {
    //   "ETH (Wei)": balanceChange,
    //   "stETH (stWei)": stEthBalanceChange
    // });
    //
    // const stakeLimitInfoAfter = await contracts.lido.getStakeLimitFullInfo();
    // const growthPerBlockAfterSubmit = stakeLimitInfoAfter.maxStakeLimit;
    // const totalSupplyAfterSubmit = await contracts.lido.totalSupply();
    // const bufferedEtherAfterSubmit = await contracts.lido.getBufferedEther();
    // const stakingLimitAfterSubmit = await contracts.lido.getCurrentStakeLimit();
    //
    // const heightAfterSubmit = await ethers.provider.getBlockNumber();
    //
    // log.debug("After submit", {
    //   "Chain height": heightAfterSubmit,
    //   "Growth per block": ethers.formatEther(growthPerBlockAfterSubmit),
    //   "Total supply": ethers.formatEther(totalSupplyAfterSubmit),
    //   "Buffered ether": ethers.formatEther(bufferedEtherAfterSubmit),
    //   "Staking limit": ethers.formatEther(stakingLimitAfterSubmit)
    // });

    // const sharesToBeMinted = await contracts.lido.getSharesByPooledEth(amount);
  });
});
