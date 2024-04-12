import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { BaseOracleTimeTravellable, MockConsensusContract } from "typechain-types";

import { Snapshot } from "lib";

import {
  computeEpochFirstSlotAt,
  deployBaseOracle,
  EPOCHS_PER_FRAME,
  GENESIS_TIME,
  HASH_1,
  SECONDS_PER_SLOT,
  SLOTS_PER_EPOCH,
} from "./baseOracleAccessControl.test";

describe("BaseOracle.sol", () => {
  let admin: HardhatEthersSigner;
  let member: HardhatEthersSigner;
  // let notMember: HardhatEthersSigner;
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

  before(deployContract);

  describe("setConsensusContract safely changes used consensus contract", () => {
    before(rollback);

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
});
