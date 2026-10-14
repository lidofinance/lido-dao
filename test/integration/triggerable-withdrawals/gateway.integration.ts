import { expect } from "chai";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { TriggerableWithdrawalsBus, TriggerableWithdrawalsGateway, WithdrawalVault } from "typechain-types";

import { ether, impersonate, readWithdrawalRequests } from "lib";
import { randomValidatorPubkey } from "lib/pdg";
import { getProtocolContext, ProtocolContext } from "lib/protocol";
import {
  drainWithdrawalRequestsQueue,
  ensureRoleFromAgent,
  setTriggerableWithdrawalsGatewayLimit,
} from "lib/protocol/helpers";

import { encodeEIP7002Payload } from "test/0.8.9/withdrawalVault/eip7002Mock";
import { Snapshot } from "test/suite";

const GWEI_PER_ETH = 10n ** 9n;
const FULL_WITHDRAWAL_WEIGHT_GWEI = 2048n * GWEI_PER_ETH;

/**
 * Modules withdrawals flow of LIP-38 on the deployed protocol: a role holder (a staking module ejector)
 * calls TriggerableWithdrawalsGateway directly and shares its withdrawal limit with the bus.
 */
describe("Integration: TriggerableWithdrawalsGateway module path", () => {
  let ctx: ProtocolContext;

  let gateway: TriggerableWithdrawalsGateway;
  let bus: TriggerableWithdrawalsBus;
  let withdrawalVault: WithdrawalVault;

  let requester: HardhatEthersSigner;
  let executor: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  let globalSnapshot: string;
  let testSnapshot: string;

  before(async () => {
    ctx = await getProtocolContext();
    globalSnapshot = await Snapshot.take();

    gateway = ctx.contracts.triggerableWithdrawalsGateway;
    bus = ctx.contracts.triggerableWithdrawalsBus;
    withdrawalVault = ctx.contracts.withdrawalVault;

    [, requester, executor, stranger] = await ethers.getSigners();
    await ensureRoleFromAgent(ctx, gateway, await gateway.ADD_WITHDRAWAL_REQUEST_ROLE(), requester);
  });

  beforeEach(async () => {
    testSnapshot = await Snapshot.take();
    await drainWithdrawalRequestsQueue();
  });

  afterEach(async () => await Snapshot.restore(testSnapshot));

  after(async () => await Snapshot.restore(globalSnapshot));

  const currentLimit = async () => (await gateway.getWithdrawalLimitFullInfo()).currentWithdrawalLimitGwei;

  it("rejects callers without ADD_WITHDRAWAL_REQUEST_ROLE", async () => {
    const fee = await withdrawalVault.getWithdrawalRequestFee();

    await expect(
      gateway
        .connect(stranger)
        .triggerWithdrawals([{ amount: 0n, pubkey: randomValidatorPubkey() }], stranger.address, { value: fee }),
    )
      .to.be.revertedWithCustomError(gateway, "AccessControlUnauthorizedAccount")
      .withArgs(stranger.address, await gateway.ADD_WITHDRAWAL_REQUEST_ROLE());
  });

  it("submits full and partial withdrawals and consumes their weight", async () => {
    await setTriggerableWithdrawalsGatewayLimit(ctx, 10_000n * GWEI_PER_ETH);

    const intents = [
      { amount: 0n, pubkey: randomValidatorPubkey() },
      { amount: 5n * GWEI_PER_ETH, pubkey: randomValidatorPubkey() },
    ];
    const weightGwei = FULL_WITHDRAWAL_WEIGHT_GWEI + 5n * GWEI_PER_ETH;
    const limitBefore = await currentLimit();
    const fee = await withdrawalVault.getWithdrawalRequestFee();

    const tx = gateway.connect(requester).triggerWithdrawals(intents, requester.address, {
      value: fee * BigInt(intents.length),
    });

    await expect(tx).to.emit(gateway, "WithdrawalsTriggered").withArgs(requester.address, intents.length, weightGwei);
    for (const intent of intents) {
      await expect(tx)
        .to.emit(withdrawalVault, "WithdrawalRequestAdded")
        .withArgs(encodeEIP7002Payload(intent.pubkey, intent.amount));
    }

    expect(await currentLimit()).to.equal(limitBefore - weightGwei);

    const requests = await readWithdrawalRequests();
    expect(requests.map(({ pubkey, amount }) => ({ pubkey, amount }))).to.deep.equal(intents);
  });

  it("shares the withdrawal limit with the bus", async () => {
    await setTriggerableWithdrawalsGatewayLimit(ctx, 3_000n * GWEI_PER_ETH);
    const fee = await withdrawalVault.getWithdrawalRequestFee();

    await gateway
      .connect(requester)
      .triggerWithdrawals([{ amount: 0n, pubkey: randomValidatorPubkey() }], requester.address, { value: fee });
    const remaining = await currentLimit();
    expect(remaining).to.equal(3_000n * GWEI_PER_ETH - FULL_WITHDRAWAL_WEIGHT_GWEI);

    const oracle = await impersonate(await ctx.contracts.validatorsExitBusOracle.getAddress(), ether("10"));
    await bus.connect(oracle).addWithdrawalIntents([{ amount: 0n, pubkey: randomValidatorPubkey() }]);

    await expect(bus.connect(executor).processWithdrawalIntents(1, executor.address, { value: fee }))
      .to.be.revertedWithCustomError(gateway, "WithdrawalLimitExceeded")
      .withArgs(FULL_WITHDRAWAL_WEIGHT_GWEI, remaining);
  });

  it("stops both paths while paused", async () => {
    const agent = await ctx.getSigner("agent");
    await ensureRoleFromAgent(ctx, gateway, await gateway.PAUSE_ROLE(), agent);
    await gateway.connect(agent).pauseFor(3600n);

    const fee = await withdrawalVault.getWithdrawalRequestFee();

    await expect(
      gateway
        .connect(requester)
        .triggerWithdrawals([{ amount: 0n, pubkey: randomValidatorPubkey() }], requester.address, { value: fee }),
    ).to.be.revertedWithCustomError(gateway, "ResumedExpected");

    const oracle = await impersonate(await ctx.contracts.validatorsExitBusOracle.getAddress(), ether("10"));
    await bus.connect(oracle).addWithdrawalIntents([{ amount: 0n, pubkey: randomValidatorPubkey() }]);

    await expect(
      bus.connect(executor).processWithdrawalIntents(1, executor.address, { value: fee }),
    ).to.be.revertedWithCustomError(gateway, "ResumedExpected");
  });
});
