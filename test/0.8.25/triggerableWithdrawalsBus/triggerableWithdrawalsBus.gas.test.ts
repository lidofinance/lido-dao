import { expect } from "chai";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { TriggerableWithdrawalsBus } from "typechain-types";

import {
  certainAddress,
  deployEIP7002WithdrawalRequestContract,
  EIP7002_ADDRESS,
  EIP7251_ADDRESS,
  log,
  proxify,
} from "lib";

import { deployLidoLocator, updateLidoLocatorImplementation } from "test/deploy";
import { FUSAKA_TX_GAS_LIMIT, Snapshot } from "test/suite";

import { GWEI_PER_ETH, partialWithdrawal } from "../triggerable-withdrawals-helpers";

// Full stack with the real EIP-7002 predeploy: bus -> gateway -> WithdrawalVault -> EIP-7002
describe("TriggerableWithdrawalsBus.sol: gas", () => {
  let bus: TriggerableWithdrawalsBus;
  let admin: HardhatEthersSigner;
  let publisher: HardhatEthersSigner;
  let executor: HardhatEthersSigner;

  let originalState: string;

  const intents = (count: number) => Array.from({ length: count }, (_, i) => partialWithdrawal(i, 32n * GWEI_PER_ETH));

  const addGas = async (count: number) => {
    const receipt = await (await bus.connect(publisher).addWithdrawalIntents(intents(count))).wait();
    return receipt!.gasUsed;
  };

  const processGas = async (count: number) => {
    await bus.connect(publisher).addWithdrawalIntents(intents(count));
    const tx = await bus
      .connect(executor)
      .processWithdrawalIntents(count, executor.address, { value: ethers.parseEther("1") });
    return (await tx.wait())!.gasUsed;
  };

  before(async () => {
    [admin, publisher, executor] = await ethers.getSigners();

    await deployEIP7002WithdrawalRequestContract();

    const locator = await deployLidoLocator();
    const locatorAddress = await locator.getAddress();

    const gateway = await ethers.deployContract("TriggerableWithdrawalsGateway", [
      admin.address,
      locatorAddress,
      1_000_000n * GWEI_PER_ETH,
      1_000_000n * GWEI_PER_ETH,
      1n,
    ]);
    const vault = await ethers.deployContract("WithdrawalVault", [
      certainAddress("gas:lido"),
      certainAddress("gas:treasury"),
      await gateway.getAddress(),
      certainAddress("gas:consolidationGateway"),
      EIP7002_ADDRESS,
      EIP7251_ADDRESS,
    ]);

    const impl = await ethers.deployContract("TriggerableWithdrawalsBus", [locatorAddress]);
    [bus] = await proxify({ impl, admin });
    await bus.initialize(admin.address);

    await updateLidoLocatorImplementation(locatorAddress, {
      withdrawalVault: await vault.getAddress(),
      triggerableWithdrawalsGateway: await gateway.getAddress(),
    });

    await gateway.connect(admin).grantRole(await gateway.ADD_WITHDRAWAL_REQUEST_ROLE(), await bus.getAddress());
    await bus.connect(admin).grantRole(await bus.ADD_WITHDRAWAL_INTENTS_ROLE(), publisher.address);
  });

  beforeEach(async () => (originalState = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(originalState));

  // Measured ~46.6k gas per added intent and ~82.3k per processed one; the bounds catch regressions
  it("keeps gas per intent within bounds", async () => {
    const sizes = [1, 50, 100, 150];
    const add: bigint[] = [];
    const process: bigint[] = [];

    for (const size of sizes) {
      const snapshot = await Snapshot.take();
      add.push(await addGas(size));
      await Snapshot.restore(snapshot);

      const snapshot2 = await Snapshot.take();
      process.push(await processGas(size));
      await Snapshot.restore(snapshot2);
    }

    const last = sizes.length - 1;
    const addPerIntent = (add[last] - add[0]) / BigInt(sizes[last] - sizes[0]);
    const processPerIntent = (process[last] - process[0]) / BigInt(sizes[last] - sizes[0]);

    for (let i = 0; i < sizes.length; ++i) {
      log(`intents=${sizes[i]} add=${add[i]} process=${process[i]}`);
    }
    log(`add per intent=${addPerIntent}, max intents per tx=${(FUSAKA_TX_GAS_LIMIT - add[0]) / addPerIntent + 1n}`);
    log(
      `process per intent=${processPerIntent}, max intents per tx=${(FUSAKA_TX_GAS_LIMIT - process[0]) / processPerIntent + 1n}`,
    );

    expect(addPerIntent).to.be.lte(50_000n);
    expect(processPerIntent).to.be.lte(90_000n);
  });
});
