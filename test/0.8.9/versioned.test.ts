import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { describe } from "mocha";
import { MAX_UINT256, proxify, streccak } from "../../lib";
import { VersionedConsumerMock } from "../../typechain-types";

describe("Versioned.sol", function () {
  let admin: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  let impl: VersionedConsumerMock;
  let consumer: VersionedConsumerMock;

  const initialVersion = 0n;
  const petrifiedVersion = MAX_UINT256;

  this.beforeEach(async function () {
    [admin, user] = await ethers.getSigners();

    impl = await ethers.deployContract("VersionedConsumerMock");
    [consumer] = await proxify<VersionedConsumerMock>({
      impl,
      admin,
      caller: user,
    });
  });

  context("constructor", function () {
    it("Petrifies the implementation", async function () {
      expect(await impl.getContractVersion()).to.equal(petrifiedVersion);
    });
  });

  context("getContractVersionPosition", function () {
    it("Returns the storage slot position of the contract version", async function () {
      expect(await consumer.getContractVersionPosition()).to.equal(streccak("lido.Versioned.contractVersion"));
    });
  });

  context("getPetrifiedVersionMark", function () {
    it("Returns the petrification version which should be max uint256", async function () {
      expect(await consumer.getPetrifiedVersionMark()).to.equal(petrifiedVersion);
    });
  });

  context("checkContractVersion", function () {
    it("Passes if the current and expected versions match", async function () {
      const expectedVersion = initialVersion;
      await consumer.checkContractVersion(expectedVersion);
    });

    it("Reverts if the current and expected versions do not match", async function () {
      const expectedVersion = 1n;
      await expect(consumer.checkContractVersion(expectedVersion)).to.be.reverted;
    });
  });

  context("initializeContractVersionTo", function () {
    it("Initializes the version from 0 to the specified version", async function () {
      const initVersion = 1n;
      await consumer.initializeContractVersionTo(initVersion);
      expect(await consumer.getContractVersion()).to.equal(initVersion);
    });

    it("Reverts if the previous contract version is not 0", async function () {
      await consumer.updateContractVersion(1);

      await expect(consumer.initializeContractVersionTo(1)).to.be.reverted;
    });
  });

  context("updateContractVersion", function () {
    it("Updates the contract version incrementally", async function () {
      const newVersion = initialVersion + 1n;
      await consumer.updateContractVersion(newVersion);

      expect(await consumer.getContractVersion()).to.equal(newVersion);
    });

    it("Reverts if the new version is not incremental", async function () {
      const newVersion = initialVersion + 2n;
      await expect(consumer.updateContractVersion(newVersion)).to.be.reverted;
    });
  });
});
