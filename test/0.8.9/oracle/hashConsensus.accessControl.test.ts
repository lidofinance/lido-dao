import { expect } from "chai";
import { keccak256, MaxUint256, Signer, toUtf8Bytes } from "ethers";
import { ethers } from "hardhat";

import { HashConsensus, MockReportProcessor } from "typechain-types";

import { CONSENSUS_VERSION, EPOCHS_PER_FRAME } from "lib";

import { deployHashConsensus, DeployHashConsensusParams, ZERO_HASH } from "test/deploy";
import { Snapshot } from "test/suite";

describe("HashConsensus:AccessControl", function () {
  let consensus: HashConsensus;
  let reportProcessor: MockReportProcessor;
  let reportProcessor2: MockReportProcessor;

  let snapshot: string;

  const manageMembersAndQuorumRoleKeccak256 = keccak256(toUtf8Bytes("MANAGE_MEMBERS_AND_QUORUM_ROLE"));
  const disableConsensusRoleKeccak256 = keccak256(toUtf8Bytes("DISABLE_CONSENSUS_ROLE"));
  const manageFrameConfigRoleKeccak256 = keccak256(toUtf8Bytes("MANAGE_FRAME_CONFIG_ROLE"));
  const manageReportProcessorRoleKeccak256 = keccak256(toUtf8Bytes("MANAGE_REPORT_PROCESSOR_ROLE"));
  const manageFastLineConfigRoleKeccak256 = keccak256(toUtf8Bytes("MANAGE_FAST_LANE_CONFIG_ROLE"));

  let admin: Signer;
  let account1: Signer;
  let account2: Signer;
  let member1: Signer;
  let member2: Signer;

  const deploy = async (options: DeployHashConsensusParams | undefined) => {
    [admin, account1, account2, member1, member2] = await ethers.getSigners();
    const deployed = await deployHashConsensus(await admin.getAddress(), options);
    consensus = deployed.consensus;
    reportProcessor = deployed.reportProcessor;

    const mockReportProcessorFactory = await ethers.getContractFactory("MockReportProcessor");
    reportProcessor2 = await mockReportProcessorFactory.deploy(CONSENSUS_VERSION);

    return await Snapshot.take();
  };

  context("DEFAULT_ADMIN_ROLE", () => {
    let snapshot: string;

    const DEFAULT_ADMIN_ROLE = ZERO_HASH;

    beforeEach(async () => {
      snapshot = await deploy({ initialEpoch: null });
    });

    afterEach(async () => {
      await Snapshot.restore(snapshot);
    });

    context("updateInitialEpoch", () => {
      it("reverts when called without DEFAULT_ADMIN_ROLE", async () => {
        await expect(consensus.connect(account1).updateInitialEpoch(10)).to.be.revertedWith(
          `AccessControl: account ${(await account1.getAddress()).toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`,
        );
        await consensus.connect(admin).grantRole(manageFrameConfigRoleKeccak256, await account2.getAddress());
        await expect(consensus.connect(account2).updateInitialEpoch(10)).to.be.revertedWith(
          `AccessControl: account ${(await account2.getAddress()).toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`,
        );
      });

      it("allows calling from a possessor of DEFAULT_ADMIN_ROLE role", async () => {
        await consensus.connect(admin).grantRole(DEFAULT_ADMIN_ROLE, await account2.getAddress());
        await consensus.connect(account2).updateInitialEpoch(10);
        expect((await consensus.getFrameConfig()).initialEpoch).to.equal(10);
      });
    });
  });

  context("deploying", () => {
    before(async () => (snapshot = await deploy({})));

    it("deploying hash consensus", async () => {
      expect(consensus).to.be.not.undefined;
      expect(reportProcessor).to.be.not.undefined;
    });
  });

  beforeEach(async () => {
    snapshot = await deploy({});
  });

  afterEach(async () => await Snapshot.restore(snapshot));

  context("MANAGE_MEMBERS_AND_QUORUM_ROLE", () => {
    context("addMember", function () {
      it("should revert without MANAGE_MEMBERS_AND_QUORUM_ROLE role", async () => {
        await expect(consensus.connect(account1).addMember(await member1.getAddress(), 2)).to.be.revertedWith(
          `AccessControl: account ${(await account1.getAddress()).toLowerCase()} is missing role ${manageMembersAndQuorumRoleKeccak256}`,
        );
        expect(await consensus.getIsMember(await member1.getAddress())).to.be.false;
        expect(await consensus.getQuorum()).to.equal(0);
      });

      it("should allow calling from a possessor of MANAGE_MEMBERS_AND_QUORUM_ROLE role", async () => {
        await consensus.connect(admin).grantRole(manageMembersAndQuorumRoleKeccak256, await account2.getAddress());
        await consensus.connect(account2).addMember(await member2.getAddress(), 1);
        expect(await consensus.getIsMember(await member2.getAddress())).to.be.true;
        expect(await consensus.getQuorum()).to.equal(1);
      });
    });

    context("removeMember", function () {
      it("should revert without MANAGE_MEMBERS_AND_QUORUM_ROLE role", async () => {
        await expect(consensus.connect(account1).removeMember(await member1.getAddress(), 2)).to.be.revertedWith(
          `AccessControl: account ${(await account1.getAddress()).toLowerCase()} is missing role ${manageMembersAndQuorumRoleKeccak256}`,
        );
        expect(await consensus.getIsMember(await member1.getAddress())).to.be.false;
        expect(await consensus.getQuorum()).to.equal(0);
      });

      it("should allow calling from a possessor of MANAGE_MEMBERS_AND_QUORUM_ROLE role", async () => {
        await consensus.connect(admin).grantRole(manageMembersAndQuorumRoleKeccak256, await account2.getAddress());
        await consensus.connect(account2).addMember(await member2.getAddress(), 2);
        expect(await consensus.getIsMember(await member2.getAddress())).to.be.true;
        expect(await consensus.getQuorum()).to.equal(2);

        await consensus.connect(account2).removeMember(await member2.getAddress(), 1);
        expect(await consensus.getIsMember(await member2.getAddress())).to.be.false;
        expect(await consensus.getQuorum()).to.equal(1);
      });
    });

    context("setQuorum", () => {
      it("should revert without MANAGE_MEMBERS_AND_QUORUM_ROLE role", async () => {
        await expect(consensus.connect(account1).setQuorum(1)).to.be.revertedWith(
          `AccessControl: account ${(await account1.getAddress()).toLowerCase()} is missing role ${manageMembersAndQuorumRoleKeccak256}`,
        );
        expect(await consensus.getQuorum()).to.equal(0);
      });

      it("should allow calling from a possessor of MANAGE_MEMBERS_AND_QUORUM_ROLE role", async () => {
        await consensus.connect(admin).grantRole(manageMembersAndQuorumRoleKeccak256, await account2.getAddress());
        await consensus.connect(account2).setQuorum(1);
        expect(await consensus.getQuorum()).to.equal(1);
      });
    });

    context("disableConsensus", () => {
      it("should revert without DISABLE_CONSENSUS_ROLE role", async () => {
        await expect(consensus.connect(account1).disableConsensus()).to.be.revertedWith(
          `AccessControl: account ${(await account1.getAddress()).toLowerCase()} is missing role ${disableConsensusRoleKeccak256}`,
        );
        expect(await consensus.getQuorum()).to.equal(0);
      });
    });
  });

  context("DISABLE_CONSENSUS_ROLE", () => {
    context("setQuorum", () => {
      it("should revert without DISABLE_CONSENSUS_ROLE role", async () => {
        await expect(consensus.connect(account1).setQuorum(MaxUint256)).to.be.revertedWith(
          `AccessControl: account ${(await account1.getAddress()).toLowerCase()} is missing role ${disableConsensusRoleKeccak256}`,
        );
        expect(await consensus.getQuorum()).to.equal(0);
      });

      it("should allow calling from a possessor of DISABLE_CONSENSUS_ROLE role", async () => {
        await consensus.connect(admin).grantRole(disableConsensusRoleKeccak256, await account2.getAddress());
        await consensus.connect(account2).setQuorum(MaxUint256);
        expect(await consensus.getQuorum()).to.equal(MaxUint256);
      });
    });

    context("disableConsensus", () => {
      it("should revert without DISABLE_CONSENSUS_ROLE role", async () => {
        await expect(consensus.connect(account1).disableConsensus()).to.be.revertedWith(
          `AccessControl: account ${(await account1.getAddress()).toLowerCase()} is missing role ${disableConsensusRoleKeccak256}`,
        );
        expect(await consensus.getQuorum()).to.equal(0);
      });

      it("should allow calling from a possessor of DISABLE_CONSENSUS_ROLE role", async () => {
        await consensus.connect(admin).grantRole(disableConsensusRoleKeccak256, await account2.getAddress());
        await consensus.connect(account2).disableConsensus();
        expect(await consensus.getQuorum()).to.equal(MaxUint256);
      });
    });
  });

  context("MANAGE_FRAME_CONFIG_ROLE", () => {
    context("setFrameConfig", () => {
      it("should revert without MANAGE_FRAME_CONFIG_ROLE role", async () => {
        await expect(consensus.connect(account1).setFrameConfig(5, 0)).to.be.revertedWith(
          `AccessControl: account ${(await account1.getAddress()).toLowerCase()} is missing role ${manageFrameConfigRoleKeccak256}`,
        );
        expect((await consensus.getFrameConfig()).epochsPerFrame).to.equal(EPOCHS_PER_FRAME);
      });

      it("should allow calling from a possessor of MANAGE_FRAME_CONFIG_ROLE role", async () => {
        await consensus.connect(admin).grantRole(manageFrameConfigRoleKeccak256, await account2.getAddress());
        await consensus.connect(account2).setFrameConfig(5, 0);
        expect((await consensus.getFrameConfig()).epochsPerFrame).to.equal(5);
      });
    });
  });

  context("MANAGE_REPORT_PROCESSOR_ROLE", () => {
    context("setReportProcessor", () => {
      it("should revert without MANAGE_REPORT_PROCESSOR_ROLE role", async () => {
        await expect(
          consensus.connect(account1).setReportProcessor(await reportProcessor2.getAddress()),
        ).to.be.revertedWith(
          `AccessControl: account ${(await account1.getAddress()).toLowerCase()} is missing role ${manageReportProcessorRoleKeccak256}`,
        );
      });

      it("should allow calling from a possessor of MANAGE_REPORT_PROCESSOR_ROLE role", async () => {
        await consensus.connect(admin).grantRole(manageReportProcessorRoleKeccak256, await account2.getAddress());
        await consensus.connect(account2).setReportProcessor(await reportProcessor2.getAddress());
        expect(await consensus.getReportProcessor()).to.equal(await reportProcessor2.getAddress());
      });
    });
  });

  context("MANAGE_FAST_LANE_CONFIG_ROLE", () => {
    context("setFastLaneLengthSlots", () => {
      it("should revert without MANAGE_FAST_LANE_CONFIG_ROLE role", async () => {
        await expect(consensus.connect(account1).setFastLaneLengthSlots(5)).to.be.revertedWith(
          `AccessControl: account ${(await account1.getAddress()).toLowerCase()} is missing role ${manageFastLineConfigRoleKeccak256}`,
        );
      });

      it("should allow calling from a possessor of MANAGE_FAST_LANE_CONFIG_ROLE role", async () => {
        await consensus.connect(admin).grantRole(manageFastLineConfigRoleKeccak256, await account2.getAddress());
        await consensus.connect(account2).setFastLaneLengthSlots(64);
        expect((await consensus.getFrameConfig()).fastLaneLengthSlots).to.equal(64);
      });
    });
  });
});
