import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { BaseOracleTimeTravellable, MockConsensusContract } from "typechain-types";

import { Snapshot } from "lib";

import {
  computeDeadlineFromRefSlot,
  computeEpochFirstSlotAt,
  CONSENSUS_VERSION,
  deployBaseOracle,
  EPOCHS_PER_FRAME,
  GENESIS_TIME,
  HASH_1,
  HASH_2,
  SECONDS_PER_SLOT,
  SLOTS_PER_EPOCH,
} from "./baseOracleAccessControl.test";

describe("BaseOracle.sol", () => {
  let admin: HardhatEthersSigner;
  let member: HardhatEthersSigner;
  let notMember: HardhatEthersSigner;
  let consensus: MockConsensusContract;
  let originalState: string;
  let baseOracle: BaseOracleTimeTravellable;
  let initialRefSlot: number;

  before(async () => {
    [admin, member, notMember] = await ethers.getSigners();
  });

  const deployContract = async () => {
    const deployed = await deployBaseOracle(admin, { initialEpoch: 1, mockMember: member });
    consensus = deployed.consensusContract;
    baseOracle = deployed.oracle;
    await baseOracle.grantRole(await baseOracle.MANAGE_CONSENSUS_CONTRACT_ROLE(), admin);
    await baseOracle.grantRole(await baseOracle.MANAGE_CONSENSUS_VERSION_ROLE(), admin);
    const time = Number(await baseOracle.getTime());
    initialRefSlot = computeEpochFirstSlotAt(time);
    originalState = await Snapshot.take();
  };
  const rollback = async () => {
    await Snapshot.restore(originalState);
  };

  describe("setConsensusContract safely changes used consensus contract", () => {
    before(deployContract);
    after(rollback);

    it("reverts on zero address", async () => {
      await expect(baseOracle.setConsensusContract(ZeroAddress)).to.be.revertedWithCustomError(
        baseOracle,
        "AddressCannotBeZero",
      );
    });

    it("reverts on same contract", async () => {
      await expect(baseOracle.setConsensusContract(await consensus.getAddress())).to.be.revertedWithCustomError(
        baseOracle,
        "AddressCannotBeSame",
      );
    });

    it("reverts on invalid contract", async () => {
      await expect(baseOracle.setConsensusContract(member.address)).to.be.revertedWithoutReason();
    });

    it("reverts on mismatched config", async () => {
      const wrongConsensusContract = await ethers.deployContract("MockConsensusContract", [
        SLOTS_PER_EPOCH,
        SECONDS_PER_SLOT + 1,
        GENESIS_TIME + 1,
        EPOCHS_PER_FRAME,
        1,
        0,
        admin.address,
      ]);
      await expect(
        baseOracle.setConsensusContract(await wrongConsensusContract.getAddress()),
      ).to.be.revertedWithCustomError(baseOracle, "UnexpectedChainConfig");
    });

    it("reverts on consensus initial ref slot behind currently processing", async () => {
      const processingRefSlot = 100;

      await consensus.submitReportAsConsensus(HASH_1, processingRefSlot, Number(await baseOracle.getTime()) + 1);
      await baseOracle.startProcessing();

      const wrongConsensusContract = await ethers.deployContract("MockConsensusContract", [
        SLOTS_PER_EPOCH,
        SECONDS_PER_SLOT,
        GENESIS_TIME,
        EPOCHS_PER_FRAME,
        1,
        0,
        admin.address,
      ]);

      await wrongConsensusContract.setInitialRefSlot(processingRefSlot - 1);

      await expect(baseOracle.setConsensusContract(await wrongConsensusContract.getAddress()))
        .to.be.revertedWithCustomError(baseOracle, "InitialRefSlotCannotBeLessThanProcessingOne")
        .withArgs(processingRefSlot - 1, processingRefSlot);
    });

    it("successfully sets new consensus contract", async () => {
      const newConsensusContract = await ethers.deployContract("MockConsensusContract", [
        SLOTS_PER_EPOCH,
        SECONDS_PER_SLOT,
        GENESIS_TIME,
        EPOCHS_PER_FRAME,
        1,
        0,
        admin.address,
      ]);
      await newConsensusContract.setInitialRefSlot(initialRefSlot);
      const tx = await baseOracle.setConsensusContract(await newConsensusContract.getAddress());
      await expect(tx)
        .to.emit(baseOracle, "ConsensusHashContractSet")
        .withArgs(await newConsensusContract.getAddress(), await consensus.getAddress());
      expect(await baseOracle.getConsensusContract()).to.be.equal(await newConsensusContract.getAddress());
    });
  });

  describe("setConsensusVersion updates contract state", () => {
    before(deployContract);
    after(rollback);

    it("reverts on same version", async () => {
      await expect(baseOracle.setConsensusVersion(CONSENSUS_VERSION)).to.be.revertedWithCustomError(
        baseOracle,
        "VersionCannotBeSame",
      );
    });

    it("sets updated version", async () => {
      const tx = await baseOracle.setConsensusVersion(2);
      await expect(tx).to.emit(baseOracle, "ConsensusVersionSet").withArgs(2, CONSENSUS_VERSION);
      const versionInState = await baseOracle.getConsensusVersion();
      expect(versionInState).to.equal(2);
    });
  });

  describe("_checkConsensusData checks provided data against internal state", () => {
    before(deployContract);
    after(rollback);
    let deadline: number;

    it("report is submitted", async () => {
      deadline = computeDeadlineFromRefSlot(initialRefSlot);
      await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, deadline);
    });

    it("reverts on mismatched slot", async () => {
      await expect(baseOracle.checkConsensusData(initialRefSlot + 1, CONSENSUS_VERSION, HASH_1))
        .to.be.revertedWithCustomError(baseOracle, "UnexpectedRefSlot")
        .withArgs(initialRefSlot, initialRefSlot + 1);
    });

    it("reverts on mismatched consensus version", async () => {
      await expect(baseOracle.checkConsensusData(initialRefSlot, CONSENSUS_VERSION + 1, HASH_1))
        .to.be.revertedWithCustomError(baseOracle, "UnexpectedConsensusVersion")
        .withArgs(CONSENSUS_VERSION, CONSENSUS_VERSION + 1);
    });

    it("reverts on mismatched hash", async () => {
      await expect(baseOracle.checkConsensusData(initialRefSlot, CONSENSUS_VERSION, HASH_2))
        .to.be.revertedWithCustomError(baseOracle, "UnexpectedDataHash")
        .withArgs(HASH_1, HASH_2);
    });

    it("check succeeds", async () => {
      await baseOracle.checkConsensusData(initialRefSlot, CONSENSUS_VERSION, HASH_1);
    });
  });

  describe("_checkProcessingDeadline checks report processing deadline", () => {
    before(deployContract);
    after(rollback);
    let deadline: number;

    it("report is submitted", async () => {
      deadline = computeDeadlineFromRefSlot(initialRefSlot);
      await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, deadline);
    });

    it("reverts if deadline is missed", async () => {
      await baseOracle.setTime(deadline + 10);
      await expect(baseOracle.checkProcessingDeadline())
        .to.be.revertedWithCustomError(baseOracle, "ProcessingDeadlineMissed")
        .withArgs(deadline);
    });
  });

  describe("_isConsensusMember correctly check address for consensus membership trough consensus contract", () => {
    before(deployContract);
    after(rollback);

    it("returns false on non member", async () => {
      const r = await baseOracle.isConsensusMember(notMember);
      expect(r).to.be.false;
    });

    it("returns true on member", async () => {
      const r = await baseOracle.isConsensusMember(member);
      expect(r).to.be.true;
    });
  });

  describe("_getCurrentRefSlot correctly gets refSlot trough consensus contract", () => {
    before(deployContract);
    after(rollback);

    it("refSlot matches", async () => {
      const oracle_slot = await baseOracle.getCurrentRefSlot();
      const consensus_slot = (await consensus.getCurrentFrame()).refSlot;
      expect(oracle_slot).to.be.equal(consensus_slot);
    });
  });
});
