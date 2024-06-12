import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { ether, impersonate } from "lib";

import { Snapshot } from "test/suite";
import { Contracts, Protocol } from "test/suite/protocol";

describe("Protocol all-round happy path", () => {
  let protocol: Protocol;
  let contracts: Contracts;

  let snapshot: string;

  before(async () => {
    protocol = new Protocol();
    contracts = await protocol.discover();
  });

  beforeEach(async () => (snapshot = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(snapshot));

  context("State", () => {
    it("staking is un-paused", async () => {
      await protocol.unpauseStaking();

      expect(await contracts.lido.isStakingPaused()).to.be.false;
    });

    it("withdrawal queue is un-paused", async () => {
      await protocol.unpauseWithdrawalQueue();

      expect(await contracts.withdrawalQueue.isPaused()).to.be.false;
    });
  });

  context("All-Round Happy Path", () => {
    // let uncountedStETHShares: bigint;
    let ethHolder: HardhatEthersSigner;
    let stEthHolder: HardhatEthersSigner;
    let stranger: HardhatEthersSigner;

    before(async () => {
      await protocol.unpauseStaking();
      await protocol.unpauseWithdrawalQueue();

      const signers = await ethers.getSigners();
      ethHolder = await impersonate(signers[0].address, ether("1000000"));
      stEthHolder = await impersonate(signers[1].address, ether("1000000"));
      stranger = await impersonate(signers[2].address);

      await stEthHolder.sendTransaction({ to: await contracts.lido.getAddress(), value: ether("10000") });
    });

    it("finalize all current requests", async () => {
      const withdrawalQueueAddress = await contracts.withdrawalQueue.getAddress();
      const lastFinalizedRequestId = await contracts.withdrawalQueue.getLastFinalizedRequestId();
      const lastRequestId = await contracts.withdrawalQueue.getLastRequestId();

      while (lastFinalizedRequestId != lastRequestId) {
        // report_tx = oracle_report()[0] // TODO: implement
        await contracts.lido.submit(ZeroAddress, { value: ether("10000"), from: ethHolder });
      }
      await contracts.lido.submit(ZeroAddress, { value: ether("10000"), from: ethHolder });

      // const uncountedStETHShares = await contracts.lido.balanceOf(withdrawalQueueAddress);
      await contracts.lido.connect(stEthHolder).approve(withdrawalQueueAddress, 1000n);
      await contracts.withdrawalQueue.connect(stEthHolder).requestWithdrawals([1000n], stEthHolder);

      const strangerAddress = stranger.address;
      const strangerBalance = await ethers.provider.getBalance(strangerAddress);

      console.log(`Stranger: ${strangerAddress} has ${ethers.formatEther(strangerBalance)} ETH`);
    });
  });
});
