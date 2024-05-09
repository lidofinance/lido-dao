import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { AccountingOracle__Mock, LegacyOracle, LidoLocator, MockConsensusContract } from "typechain-types";

import {
  certainAddress,
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

  let oracle: LegacyOracle;

  let locator: LidoLocator;
  let consensusContract: MockConsensusContract;
  let accountingOracle: AccountingOracle__Mock;

  let lido: string;

  let originalState: string;

  before(async () => {
    [admin] = await ethers.getSigners();

    const impl = await ethers.deployContract("LegacyOracle");
    [oracle] = await proxify({ impl, admin });

    lido = certainAddress("legacy-oracle:lido");

    consensusContract = await ethers.deployContract("MockConsensusContract", [
      SLOTS_PER_EPOCH,
      SECONDS_PER_SLOT,
      GENESIS_TIME,
      EPOCHS_PER_FRAME,
      INITIAL_EPOCH,
      INITIAL_FAST_LANE_LENGTH_SLOTS,
      admin,
    ]);

    accountingOracle = await ethers.deployContract("AccountingOracle__Mock", [
      lido,
      consensusContract,
      SECONDS_PER_SLOT,
    ]);

    locator = await dummyLocator({ legacyOracle: oracle, accountingOracle, lido });
  });

  beforeEach(async () => (originalState = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(originalState));

  context("initialize", () => {
    context("Reverts", () => {
      it("Reverts if locator is zero address", async () => {
        await expect(oracle.initialize(ZeroAddress, ZeroAddress)).to.revertedWith("ZERO_LOCATOR_ADDRESS");
      });

      it("Reverts if accountingOracle is zero address", async () => {
        const badLocator = await dummyLocator({ legacyOracle: oracle, accountingOracle: ZeroAddress }, admin, false);

        await expect(oracle.initialize(badLocator, ZeroAddress)).to.revertedWith("ZERO_ACCOUNTING_ORACLE_ADDRESS");
      });

      it("Reverts if already initialized", async () => {
        await oracle.initialize(locator, consensusContract);

        await expect(oracle.initialize(locator, consensusContract)).to.be.revertedWith("INIT_ALREADY_INITIALIZED");
      });

      // @dev test for slotsPerEpoch cannot be performed because it causes panic code 0x11
      // (Arithmetic operation overflowed outside of an unchecked block)

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

        const badAccountingOracle = await ethers.deployContract("AccountingOracle__Mock", [
          lido,
          badConsensusContract,
          SECONDS_PER_SLOT,
        ]);

        const badLocator = await dummyLocator(
          {
            legacyOracle: oracle,
            accountingOracle: badAccountingOracle,
            lido,
          },
          admin,
          false,
        );

        return { badLocator, badConsensusContract };
      }

      it("Reverts if chain spec SECONDS_PER_SLOT is 0", async () => {
        const { badLocator, badConsensusContract } = await getSpoiledChainSpecMocks(0n, GENESIS_TIME, EPOCHS_PER_FRAME);
        await expect(oracle.initialize(badLocator, badConsensusContract)).to.be.revertedWith("BAD_SECONDS_PER_SLOT");
      });

      it("Reverts if chain spec GENESIS_TIME is 0", async () => {
        const { badLocator, badConsensusContract } = await getSpoiledChainSpecMocks(
          SECONDS_PER_SLOT,
          0n,
          EPOCHS_PER_FRAME,
        );
        await expect(oracle.initialize(badLocator, badConsensusContract)).to.be.revertedWith("BAD_GENESIS_TIME");
      });

      it("Reverts if chain spec EPOCHS_PER_FRAME is 0", async () => {
        const { badLocator, badConsensusContract } = await getSpoiledChainSpecMocks(SECONDS_PER_SLOT, GENESIS_TIME, 0n);
        await expect(oracle.initialize(badLocator, badConsensusContract)).to.be.revertedWith("BAD_EPOCHS_PER_FRAME");
      });
    });

    it("Initializes correctly", async () => {
      await oracle.initialize(locator, consensusContract);

      expect(await oracle.getVersion()).to.equal(4);
      expect(await oracle.getAccountingOracle()).to.equal(accountingOracle);
      expect(await oracle.getLido()).to.equal(lido);

      const spec = await oracle.getBeaconSpec();

      expect(spec.epochsPerFrame).to.equal(EPOCHS_PER_FRAME);
      expect(spec.slotsPerEpoch).to.equal(SLOTS_PER_EPOCH);
      expect(spec.secondsPerSlot).to.equal(SECONDS_PER_SLOT);
      expect(spec.genesisTime).to.equal(GENESIS_TIME);

      expect(await oracle.getLastCompletedEpochId()).to.equal(0);
    });
  });
});
