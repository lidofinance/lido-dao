import { expect } from "chai";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { BaseOracleTimeTravellable, MockConsensusContract } from "typechain-types";

import { Snapshot } from "lib";

const SLOTS_PER_EPOCH = 32;
const SECONDS_PER_SLOT = 12;
const GENESIS_TIME = 100;
const EPOCHS_PER_FRAME = 225; // one day
const INITIAL_EPOCH = 1;
const INITIAL_FAST_LANE_LENGTH_SLOTS = 0;

const SECONDS_PER_EPOCH = SLOTS_PER_EPOCH * SECONDS_PER_SLOT;
const SECONDS_PER_FRAME = SECONDS_PER_EPOCH * EPOCHS_PER_FRAME;
const SLOTS_PER_FRAME = EPOCHS_PER_FRAME * SLOTS_PER_EPOCH;

const computeSlotAt = (time: number) => Math.floor((time - GENESIS_TIME) / SECONDS_PER_SLOT);
const computeEpochAt = (time: number) => Math.floor(computeSlotAt(time) / SLOTS_PER_EPOCH);
const computeEpochFirstSlot = (epoch: number) => epoch * SLOTS_PER_EPOCH;
const computeEpochFirstSlotAt = (time: number) => computeEpochFirstSlot(computeEpochAt(time));
const computeTimestampAtEpoch = (epoch: number) => GENESIS_TIME + epoch * SECONDS_PER_EPOCH;
const computeTimestampAtSlot = (slot: number) => GENESIS_TIME + slot * SECONDS_PER_SLOT;
const computeDeadlineFromRefSlot = (slot: number) => computeTimestampAtSlot(+slot + SLOTS_PER_FRAME);
const computeNextRefSlotFromRefSlot = (slot: number) => +slot + SLOTS_PER_FRAME;

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

const HASH_1 = "0x1111111111111111111111111111111111111111111111111111111111111111";
const HASH_2 = "0x2222222222222222222222222222222222222222222222222222222222222222";
const HASH_3 = "0x3333333333333333333333333333333333333333333333333333333333333333";
const HASH_4 = "0x4444444444444444444444444444444444444444444444444444444444444444";
const HASH_5 = "0x5555555555555555555555555555555555555555555555555555555555555555";

const UNREACHABLE_QUORUM = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

const CONSENSUS_VERSION = 1;

async function deployBaseOracle(
  admin: HardhatEthersSigner,
  {
    secondsPerSlot = SECONDS_PER_SLOT,
    genesisTime = GENESIS_TIME,
    slotsPerEpoch = SLOTS_PER_EPOCH,
    consensusContract = null as MockConsensusContract | null,
    epochsPerFrame = EPOCHS_PER_FRAME,
    fastLaneLengthSlots = INITIAL_FAST_LANE_LENGTH_SLOTS,
    initialEpoch = INITIAL_EPOCH,
    mockMember = admin,
  } = {},
) {
  if (!consensusContract) {
    consensusContract = await ethers.deployContract("MockConsensusContract", [
      slotsPerEpoch,
      secondsPerSlot,
      genesisTime,
      epochsPerFrame,
      initialEpoch,
      fastLaneLengthSlots,
      mockMember,
    ]);
  }

  const oracle = await ethers.deployContract("BaseOracleTimeTravellable", [secondsPerSlot, genesisTime, admin]);

  await oracle.initialize(await consensusContract.getAddress(), CONSENSUS_VERSION, 0);

  await consensusContract.setAsyncProcessor(await oracle.getAddress());

  return { oracle, consensusContract };
}

export {
  INITIAL_FAST_LANE_LENGTH_SLOTS,
  INITIAL_EPOCH,
  SLOTS_PER_EPOCH,
  SECONDS_PER_SLOT,
  GENESIS_TIME,
  EPOCHS_PER_FRAME,
  SECONDS_PER_EPOCH,
  SECONDS_PER_FRAME,
  SLOTS_PER_FRAME,
  computeSlotAt,
  computeEpochAt,
  computeEpochFirstSlot,
  computeEpochFirstSlotAt,
  computeTimestampAtSlot,
  computeTimestampAtEpoch,
  computeNextRefSlotFromRefSlot,
  computeDeadlineFromRefSlot,
  ZERO_HASH,
  HASH_1,
  HASH_2,
  HASH_3,
  HASH_4,
  HASH_5,
  CONSENSUS_VERSION,
  UNREACHABLE_QUORUM,
  deployBaseOracle,
};

describe("BaseOracle.sol", async () => {
  let admin: HardhatEthersSigner;
  let account1: HardhatEthersSigner;
  let account2: HardhatEthersSigner;
  let member1: HardhatEthersSigner;
  let oracle: BaseOracleTimeTravellable;
  let consensus: MockConsensusContract;
  let originalState: string;

  before(async () => {
    [admin, account1, account2, member1] = await ethers.getSigners();
  });

  const deploy = async (options = undefined) => {
    const deployed = await deployBaseOracle(admin, options);
    oracle = deployed.oracle;
    consensus = deployed.consensusContract;
    originalState = await Snapshot.take();
  };

  const rollback = async () => {
    await Snapshot.restore(originalState);
  };

  context("AccountingOracle deployment and initial configuration", () => {
    before(deploy);
    after(rollback);

    it("deploying oracle", async () => {
      expect(oracle).to.be.ok;
      expect(consensus).to.be.ok;
    });

    it("reverts when slotsPerSecond is zero", async () => {
      await expect(deployBaseOracle(admin, { secondsPerSlot: 0 })).to.be.revertedWithCustomError(
        oracle,
        "SecondsPerSlotCannotBeZero",
      );
    });
  });

  context("MANAGE_CONSENSUS_CONTRACT_ROLE", () => {
    beforeEach(deploy);
    afterEach(rollback);

    context("setConsensusContract", () => {
      it("should revert without MANAGE_CONSENSUS_CONTRACT_ROLE role", async () => {
        const role = await oracle.MANAGE_CONSENSUS_CONTRACT_ROLE();
        await expect(oracle.setConsensusContract(member1)).to.be.revertedWithOZAccessControlError(admin.address, role);

        expect(await oracle.getConsensusContract()).to.be.equal(await consensus.getAddress());
      });

      it("should allow calling from a possessor of MANAGE_CONSENSUS_CONTRACT_ROLE role", async () => {
        const consensusContract2 = await ethers.deployContract("MockConsensusContract", [
          SECONDS_PER_EPOCH,
          SECONDS_PER_SLOT,
          GENESIS_TIME,
          EPOCHS_PER_FRAME,
          INITIAL_EPOCH,
          INITIAL_FAST_LANE_LENGTH_SLOTS,
          admin,
        ]);

        const role = await oracle.MANAGE_CONSENSUS_CONTRACT_ROLE();

        await oracle.grantRole(role, account2);
        await oracle.connect(account2).setConsensusContract(await consensusContract2.getAddress());
        expect(await oracle.getConsensusContract()).to.be.equal(await consensusContract2.getAddress());
      });
    });
  });

  context("MANAGE_CONSENSUS_VERSION_ROLE", () => {
    beforeEach(deploy);
    afterEach(rollback);

    context("setConsensusVersion", () => {
      it("should revert without MANAGE_CONSENSUS_VERSION_ROLE role", async () => {
        const role = await oracle.MANAGE_CONSENSUS_VERSION_ROLE();

        await expect(oracle.connect(account1).setConsensusVersion(1)).to.be.revertedWithOZAccessControlError(
          account1.address,
          role,
        );
        expect(await oracle.getConsensusVersion()).to.be.equal(CONSENSUS_VERSION);
      });

      it("should allow calling from a possessor of MANAGE_CONSENSUS_VERSION_ROLE role", async () => {
        const role = await oracle.MANAGE_CONSENSUS_VERSION_ROLE();
        await oracle.grantRole(role, account2);
        await oracle.connect(account2).setConsensusVersion(2);

        expect(await oracle.getConsensusVersion()).to.be.equal(2);
      });
    });
  });

  context("CONSENSUS_CONTRACT", () => {
    beforeEach(deploy);
    afterEach(rollback);

    context("submitConsensusReport", async () => {
      const initialRefSlot = Number(await oracle.getTime());

      it("should revert from not a consensus contract", async () => {
        await expect(
          oracle.connect(account1).submitConsensusReport(HASH_1, initialRefSlot, initialRefSlot),
        ).to.be.revertedWithCustomError(oracle, "SenderIsNotTheConsensusContract");

        expect((await oracle.getConsensusReportLastCall()).callCount).to.be.equal(0);
      });

      it("should allow calling from a consensus contract", async () => {
        await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, initialRefSlot + SLOTS_PER_FRAME);

        expect((await oracle.getConsensusReportLastCall()).callCount).to.be.equal(1);
      });
    });
  });

  context("submitConsensusReport", () => {
    let initialRefSlot: number;

    before(async () => {
      initialRefSlot = Number(await oracle.getTime());
    });

    beforeEach(deploy);
    afterEach(rollback);

    it("should revert from not a consensus contract", async () => {
      await expect(
        oracle.connect(account1).submitConsensusReport(HASH_1, initialRefSlot, initialRefSlot),
      ).to.be.revertedWithCustomError(oracle, "SenderIsNotTheConsensusContract");

      expect((await oracle.getConsensusReportLastCall()).callCount).to.be.equal(0);
    });

    it("should allow calling from a consensus contract", async () => {
      await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, initialRefSlot + SLOTS_PER_FRAME);

      expect((await oracle.getConsensusReportLastCall()).callCount).to.be.equal(1);
    });

    it("should allow to discard report from a consensus contract", async () => {
      await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, initialRefSlot + SLOTS_PER_FRAME);
      expect((await oracle.getConsensusReportLastCall()).callCount).to.be.equal(1);
      await consensus.discardReportAsConsensus(initialRefSlot);
    });

    it("should revert on discard from stranger", async () => {
      await expect(oracle.discardConsensusReport(initialRefSlot)).to.be.revertedWithCustomError(
        oracle,
        "SenderIsNotTheConsensusContract",
      );
    });
  });
});
