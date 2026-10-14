import { expect } from "chai";
import { ethers } from "hardhat";

import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { TriggerableWithdrawalsBus, TriggerableWithdrawalsGateway, WithdrawalVault } from "typechain-types";

import { ether, impersonate, readWithdrawalRequests } from "lib";
import { randomValidatorPubkey } from "lib/pdg";
import { getProtocolContext, ProtocolContext } from "lib/protocol";
import { drainWithdrawalRequestsQueue, setTriggerableWithdrawalsGatewayLimit } from "lib/protocol/helpers";

import { encodeEIP7002Payload } from "test/0.8.9/withdrawalVault/eip7002Mock";
import { Snapshot } from "test/suite";

const GWEI_PER_ETH = 10n ** 9n;
const FULL_WITHDRAWAL_WEIGHT_GWEI = 2048n * GWEI_PER_ETH;

/**
 * Oracle withdrawals flow of LIP-38 on the deployed protocol:
 * ValidatorsExitBusOracle -> TriggerableWithdrawalsBus -> TriggerableWithdrawalsGateway -> WithdrawalVault -> EIP-7002.
 */
describe("Integration: TriggerableWithdrawalsBus flow", () => {
  let ctx: ProtocolContext;

  let bus: TriggerableWithdrawalsBus;
  let gateway: TriggerableWithdrawalsGateway;
  let withdrawalVault: WithdrawalVault;

  let oracle: HardhatEthersSigner;
  let executor: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  let globalSnapshot: string;
  let testSnapshot: string;

  before(async () => {
    ctx = await getProtocolContext();
    globalSnapshot = await Snapshot.take();

    bus = ctx.contracts.triggerableWithdrawalsBus;
    gateway = ctx.contracts.triggerableWithdrawalsGateway;
    withdrawalVault = ctx.contracts.withdrawalVault;

    [, executor, stranger] = await ethers.getSigners();
    oracle = await impersonate(await ctx.contracts.validatorsExitBusOracle.getAddress(), ether("10"));
  });

  beforeEach(async () => {
    testSnapshot = await Snapshot.take();
    await drainWithdrawalRequestsQueue();
  });

  afterEach(async () => await Snapshot.restore(testSnapshot));

  after(async () => await Snapshot.restore(globalSnapshot));

  const fullWithdrawal = () => ({ amount: 0n, pubkey: randomValidatorPubkey() });
  const partialWithdrawal = (amount: bigint) => ({ amount, pubkey: randomValidatorPubkey() });

  it("is wired into the protocol", async () => {
    expect(await ctx.contracts.locator.triggerableWithdrawalsBus()).to.equal(await bus.getAddress());
    expect(await bus.LOCATOR()).to.equal(await ctx.contracts.locator.getAddress());
    expect(await withdrawalVault.TRIGGERABLE_WITHDRAWALS_GATEWAY()).to.equal(await gateway.getAddress());
    expect(await gateway.hasRole(await gateway.ADD_WITHDRAWAL_REQUEST_ROLE(), await bus.getAddress())).to.be.true;

    const publisherRole = await bus.ADD_WITHDRAWAL_INTENTS_ROLE();
    expect(await bus.getRoleMemberCount(publisherRole)).to.equal(1);
    expect(await bus.hasRole(publisherRole, oracle.address)).to.be.true;
  });

  it("accepts intents only from the oracle", async () => {
    await expect(bus.connect(stranger).addWithdrawalIntents([fullWithdrawal()]))
      .to.be.revertedWithCustomError(bus, "AccessControlUnauthorizedAccount")
      .withArgs(stranger.address, await bus.ADD_WITHDRAWAL_INTENTS_ROLE());
  });

  it("queues the oracle's intents and executes them as EIP-7002 requests", async () => {
    const intents = [
      fullWithdrawal(),
      partialWithdrawal(2n * GWEI_PER_ETH),
      partialWithdrawal(32n * GWEI_PER_ETH + 1n),
    ];
    const queuedBefore = await bus.unprocessedIntentsCount();

    await expect(bus.connect(oracle).addWithdrawalIntents(intents))
      .to.emit(bus, "WithdrawalIntentsAdded")
      .withArgs(anyValue, intents.length);
    expect(await bus.unprocessedIntentsCount()).to.equal(queuedBefore + BigInt(intents.length));

    // Process anything queued before this test first, so the batch below is exactly `intents`
    const fee = await withdrawalVault.getWithdrawalRequestFee();
    if (queuedBefore > 0n) {
      await bus
        .connect(executor)
        .processWithdrawalIntents(queuedBefore, executor.address, { value: fee * queuedBefore });
      await drainWithdrawalRequestsQueue();
    }

    const totalFee = fee * BigInt(intents.length);
    const tx = bus.connect(executor).processWithdrawalIntents(intents.length, ethers.ZeroAddress, {
      value: totalFee + ether("0.01"),
    });

    await expect(tx).to.emit(bus, "WithdrawalIntentsProcessed").withArgs(anyValue, intents.length);
    // 2048 ETH for the full withdrawal, partial ones weigh their amounts
    await expect(tx)
      .to.emit(gateway, "WithdrawalsTriggered")
      .withArgs(await bus.getAddress(), intents.length, FULL_WITHDRAWAL_WEIGHT_GWEI + 34n * GWEI_PER_ETH + 1n);
    for (const intent of intents) {
      await expect(tx)
        .to.emit(withdrawalVault, "WithdrawalRequestAdded")
        .withArgs(encodeEIP7002Payload(intent.pubkey, intent.amount));
    }
    // The excess fee is refunded to the caller
    await expect(tx).to.changeEtherBalance(executor, -totalFee);

    expect(await bus.unprocessedIntentsCount()).to.equal(0);

    const vaultAddress = (await withdrawalVault.getAddress()).toLowerCase();
    const requests = await readWithdrawalRequests();
    expect(
      requests.map(({ address, pubkey, amount }) => ({ address: address.toLowerCase(), pubkey, amount })),
    ).to.deep.equal(intents.map(({ pubkey, amount }) => ({ address: vaultAddress, pubkey, amount })));
  });

  it("keeps the head of the queue until the gateway limit allows it", async () => {
    await setTriggerableWithdrawalsGatewayLimit(ctx, FULL_WITHDRAWAL_WEIGHT_GWEI);

    const intents = [fullWithdrawal(), fullWithdrawal()];
    const queuedBefore = await bus.unprocessedIntentsCount();
    expect(queuedBefore).to.equal(0);

    await bus.connect(oracle).addWithdrawalIntents(intents);
    const fee = await withdrawalVault.getWithdrawalRequestFee();

    await expect(bus.connect(executor).processWithdrawalIntents(2, executor.address, { value: fee * 2n }))
      .to.be.revertedWithCustomError(gateway, "WithdrawalLimitExceeded")
      .withArgs(2n * FULL_WITHDRAWAL_WEIGHT_GWEI, FULL_WITHDRAWAL_WEIGHT_GWEI);
    expect(await bus.unprocessedIntentsCount()).to.equal(2);

    await expect(bus.connect(executor).processWithdrawalIntents(1, executor.address, { value: fee }))
      .to.emit(gateway, "WithdrawalsTriggered")
      .withArgs(await bus.getAddress(), 1, FULL_WITHDRAWAL_WEIGHT_GWEI);

    expect(await bus.unprocessedIntentsCount()).to.equal(1);
    expect((await bus.getWithdrawalIntents(0, 1))[0].pubkey).to.equal(intents[1].pubkey);
  });
});
