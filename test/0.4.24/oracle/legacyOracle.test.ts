import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import {
  AccountingOracle__MockForLegacyOracle,
  HashConsensus__MockForLegacyOracle,
  LegacyOracle__Harness,
  LidoLocator,
  ReportProcessor__MockForLegacyOracle,
} from "typechain-types";

import {
  certainAddress,
  CONSENSUS_VERSION,
  dummyLocator,
  EPOCHS_PER_FRAME,
  proxify,
  randomAddress,
  SECONDS_PER_SLOT,
  SLOTS_PER_EPOCH,
  Snapshot,
} from "lib";

import { GENESIS_TIME, INITIAL_EPOCH, INITIAL_FAST_LANE_LENGTH_SLOTS } from "test/deploy";

describe("LegacyOracle.sol", () => {
  let admin: HardhatEthersSigner;

  let legacyOracle: LegacyOracle__Harness;

  let locator: LidoLocator;
  let reportProcessor: ReportProcessor__MockForLegacyOracle;
  let consensusContract: HashConsensus__MockForLegacyOracle;
  let accountingOracle: AccountingOracle__MockForLegacyOracle;

  let lido: string;

  let originalState: string;

  before(async () => {
    [admin] = await ethers.getSigners();

    const impl = await ethers.deployContract("LegacyOracle__Harness");
    [legacyOracle] = await proxify({ impl, admin });

    lido = certainAddress("legacy-oracle:lido");

    reportProcessor = await ethers.deployContract("ReportProcessor__MockForLegacyOracle", [CONSENSUS_VERSION]);

    consensusContract = await ethers.deployContract("HashConsensus__MockForLegacyOracle", [
      SLOTS_PER_EPOCH,
      SECONDS_PER_SLOT,
      GENESIS_TIME,
      EPOCHS_PER_FRAME,
      INITIAL_FAST_LANE_LENGTH_SLOTS,
      admin,
      reportProcessor,
    ]);

    accountingOracle = await ethers.deployContract("AccountingOracle__MockForLegacyOracle", [
      lido,
      consensusContract,
      SECONDS_PER_SLOT,
    ]);

    locator = await dummyLocator({ legacyOracle, accountingOracle, lido });
  });

  beforeEach(async () => (originalState = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(originalState));

  context("initialize", () => {
    context("Reverts", () => {
      it("if locator is zero address", async () => {
        await expect(legacyOracle.initialize(ZeroAddress, ZeroAddress)).to.revertedWith("ZERO_LOCATOR_ADDRESS");
      });

      it("if accountingOracle is zero address", async () => {
        const badLocator = await dummyLocator(
          {
            legacyOracle: legacyOracle,
            accountingOracle: ZeroAddress,
          },
          admin,
          false,
        );

        await expect(legacyOracle.initialize(badLocator, ZeroAddress)).to.revertedWith(
          "ZERO_ACCOUNTING_ORACLE_ADDRESS",
        );
      });

      it("if already initialized", async () => {
        await legacyOracle.initialize(locator, consensusContract);

        await expect(legacyOracle.initialize(locator, consensusContract)).to.be.revertedWith(
          "INIT_ALREADY_INITIALIZED",
        );
      });

      async function getSpoiledChainSpecMocks(secondsPerSlot: bigint, genesisTime: bigint, epochsPerFrame: bigint) {
        const badConsensusContract = await ethers.deployContract("MockConsensusContract", [
          SLOTS_PER_EPOCH,
          secondsPerSlot,
          genesisTime,
          epochsPerFrame,
          INITIAL_EPOCH,
          INITIAL_FAST_LANE_LENGTH_SLOTS,
          randomAddress(),
        ]);

        const accountingOracle = await ethers.deployContract("AccountingOracle__MockForLegacyOracle", [
          lido,
          badConsensusContract,
          SECONDS_PER_SLOT,
        ]);

        const locatorConfig = { legacyOracle, accountingOracle, lido };
        const badLocator = await dummyLocator(locatorConfig, admin, false);

        return { badLocator, badConsensusContract };
      }

      // @dev test for slotsPerEpoch cannot be performed because it causes panic code 0x11
      // (Arithmetic operation overflowed outside of an unchecked block)

      it("if chain spec SECONDS_PER_SLOT is 0", async () => {
        const { badLocator, badConsensusContract } = await getSpoiledChainSpecMocks(0n, GENESIS_TIME, EPOCHS_PER_FRAME);

        await expect(legacyOracle.initialize(badLocator, badConsensusContract)).to.be.revertedWith(
          "BAD_SECONDS_PER_SLOT",
        );
      });

      it("if chain spec GENESIS_TIME is 0", async () => {
        const { badLocator, badConsensusContract } = await getSpoiledChainSpecMocks(
          SECONDS_PER_SLOT,
          0n,
          EPOCHS_PER_FRAME,
        );

        await expect(legacyOracle.initialize(badLocator, badConsensusContract)).to.be.revertedWith("BAD_GENESIS_TIME");
      });

      it("if chain spec EPOCHS_PER_FRAME is 0", async () => {
        const { badLocator, badConsensusContract } = await getSpoiledChainSpecMocks(SECONDS_PER_SLOT, GENESIS_TIME, 0n);

        await expect(legacyOracle.initialize(badLocator, badConsensusContract)).to.be.revertedWith(
          "BAD_EPOCHS_PER_FRAME",
        );
      });

      it("if wrong base version us used", async () => {
        await legacyOracle.harness__setContractDeprecatedVersion(3);

        await expect(legacyOracle.initialize(locator, consensusContract)).to.be.revertedWith("WRONG_BASE_VERSION");
      });
    });

    it("Initializes correctly", async () => {
      await legacyOracle.initialize(locator, consensusContract);

      expect(await legacyOracle.getVersion()).to.equal(4);
      expect(await legacyOracle.getAccountingOracle()).to.equal(accountingOracle);
      expect(await legacyOracle.getLido()).to.equal(lido);

      const spec = await legacyOracle.getBeaconSpec();

      expect(spec.epochsPerFrame).to.equal(EPOCHS_PER_FRAME);
      expect(spec.slotsPerEpoch).to.equal(SLOTS_PER_EPOCH);
      expect(spec.secondsPerSlot).to.equal(SECONDS_PER_SLOT);
      expect(spec.genesisTime).to.equal(GENESIS_TIME);

      expect(await legacyOracle.getLastCompletedEpochId()).to.equal(0);
    });
  });

  context("getLido", () => {
    it("Returns lido address", async () => {
      await legacyOracle.initialize(locator, consensusContract);

      expect(await legacyOracle.getLido()).to.equal(lido);
    });
  });

  context("getAccountingOracle", () => {
    it("Returns accountingOracle address", async () => {
      await legacyOracle.initialize(locator, consensusContract);

      expect(await legacyOracle.getAccountingOracle()).to.equal(accountingOracle);
    });
  });

  context("getVersion", () => {
    it("Returns version", async () => {
      await legacyOracle.initialize(locator, consensusContract);

      expect(await legacyOracle.getVersion()).to.equal(4);
    });
  });

  // getBeaconSpec
  context("getBeaconSpec", () => {
    it("Returns beacon spec", async () => {
      await legacyOracle.initialize(locator, consensusContract);

      const spec = await legacyOracle.getBeaconSpec();

      expect(spec.epochsPerFrame).to.equal(EPOCHS_PER_FRAME);
      expect(spec.slotsPerEpoch).to.equal(SLOTS_PER_EPOCH);
      expect(spec.secondsPerSlot).to.equal(SECONDS_PER_SLOT);
      expect(spec.genesisTime).to.equal(GENESIS_TIME);
    });
  });

  // getCurrentEpochId
  context("getCurrentEpochId", () => {
    it("Returns current epoch id", async () => {
      await legacyOracle.initialize(locator, consensusContract);

      for (let index = 0; index < 20; index++) {
        const consensusTime = await consensusContract.getTime();
        const oracleEpochId = await legacyOracle.getCurrentEpochId();

        const consensusEpochId = (consensusTime - GENESIS_TIME) / (SLOTS_PER_EPOCH * SECONDS_PER_SLOT);

        expect(oracleEpochId).to.be.equal(consensusEpochId);

        await consensusContract.advanceTimeByEpochs(1);
      }
    });
  });

  // getCurrentFrame

  // getLastCompletedEpochId

  // getLastCompletedReportDelta

  // handlePostTokenRebase

  // handleConsensusLayerReport

  context("finalizeUpgrade_v4 (deprecated)", () => {
    context("Reverts", () => {
      it("if not upgradeable", async () => {
        await legacyOracle.initialize(locator, consensusContract);

        await expect(legacyOracle.finalizeUpgrade_v4(accountingOracle)).to.be.revertedWith("WRONG_BASE_VERSION");
      });

      it("if chain is not set", async () => {
        await legacyOracle.harness__setContractDeprecatedVersion(3);

        await expect(legacyOracle.finalizeUpgrade_v4(accountingOracle)).to.be.revertedWith("UNEXPECTED_CHAIN_SPEC");
      });
    });

    it("Finalizes upgrade correctly", async () => {
      await legacyOracle.harness__setContractDeprecatedVersion(3);
      await legacyOracle.harness__updateChainSpec(consensusContract);

      await legacyOracle.finalizeUpgrade_v4(accountingOracle);

      expect(await legacyOracle.getVersion()).to.equal(4);
    });
  });
});
