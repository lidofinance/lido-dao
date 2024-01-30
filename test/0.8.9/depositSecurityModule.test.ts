import { describe } from "mocha";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import { DepositSecurityModule } from "../../typechain-types";
import { Snapshot, randomAddress } from "../../lib";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const MAX_DEPOSITS_PER_BLOCK = 100;
const MIN_DEPOSIT_BLOCK_DISTANCE = 14;
const PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS = 10;

type Params = {
  lido: string;
  depositContract: string;
  stakingRouter: string;
  maxDepositsPerBlock: number;
  minDepositBlockDistance: number;
  pauseIntentValidityPeriodBlocks: number;
};

function initialParams(): Params {
  return {
    lido: randomAddress(),
    depositContract: randomAddress(),
    stakingRouter: randomAddress(),
    maxDepositsPerBlock: MAX_DEPOSITS_PER_BLOCK,
    minDepositBlockDistance: MIN_DEPOSIT_BLOCK_DISTANCE,
    pauseIntentValidityPeriodBlocks: PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS,
  } as Params;
}

describe("DepositSecurityModule.sol", function () {
  const config = initialParams();
  let dsm: DepositSecurityModule;

  let admin: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let guardian1: HardhatEthersSigner;
  let guardian2: HardhatEthersSigner;
  let guardian3: HardhatEthersSigner;

  let originalState: string;

  this.beforeAll(async function () {
    [admin, stranger, guardian1, guardian2, guardian3] = await ethers.getSigners();
    dsm = await ethers.deployContract("DepositSecurityModule", Object.values(config), { from: admin });

    originalState = await Snapshot.take();
  });

  this.afterAll(async function () {
    await Snapshot.restore(originalState);
  });

  context("constructor", function () {
    it("Reverts if the `lido` is zero address", async function () {
      const config = initialParams();
      config["lido"] = ZeroAddress;
      await expect(ethers.deployContract("DepositSecurityModule", Object.values(config))).to.be.revertedWithCustomError(
        dsm,
        "ZeroAddress",
      );
    });

    it("Reverts if the `depositContract` is zero address", async function () {
      const config = initialParams();
      config["depositContract"] = ZeroAddress;
      await expect(ethers.deployContract("DepositSecurityModule", Object.values(config))).to.be.revertedWithCustomError(
        dsm,
        "ZeroAddress",
      );
    });

    it("Reverts if the `stakingRouter` is zero address", async function () {
      const config = initialParams();
      config["stakingRouter"] = ZeroAddress;
      await expect(ethers.deployContract("DepositSecurityModule", Object.values(config))).to.be.revertedWithCustomError(
        dsm,
        "ZeroAddress",
      );
    });
  });

  context("Owner", function () {
    context("Function `getOwner`", function () {
      it("Returns the current owner ot the contract", async function () {
        expect(await dsm.getOwner()).to.equal(admin.address);
      });
    });

    context("Function `setOwner`", function () {
      let originalState: string;

      this.beforeAll(async function () {
        originalState = await Snapshot.take();
      });

      this.afterAll(async function () {
        await Snapshot.restore(originalState);
      });

      it("Reverts if the `newValue` is zero address", async function () {
        await expect(dsm.setOwner(ZeroAddress)).to.be.revertedWithCustomError(dsm, "ZeroAddress");
      });

      it("Reverts if the `setOwner` called by not an owner", async function () {
        await expect(dsm.connect(stranger).setOwner(randomAddress())).to.be.revertedWithCustomError(dsm, "NotAnOwner");
      });

      it("Set a new owner and fires `OwnerChanged` event", async function () {
        const newOwner = randomAddress();

        await expect(dsm.setOwner(newOwner)).to.emit(dsm, "OwnerChanged").withArgs(newOwner);

        expect(await dsm.getOwner()).to.equal(newOwner);
      });
    });
  });

  context("Pause intent validity period blocks", function () {
    context("Function `getPauseIntentValidityPeriodBlocks`", function () {
      it("Returns current `pauseIntentValidityPeriodBlocks` contract parameter", async function () {
        expect(await dsm.getPauseIntentValidityPeriodBlocks()).to.equal(config.pauseIntentValidityPeriodBlocks);
      });
    });

    context("Function `setPauseIntentValidityPeriodBlocks`", function () {
      let originalState: string;

      this.beforeAll(async function () {
        originalState = await Snapshot.take();
      });

      this.afterAll(async function () {
        await Snapshot.restore(originalState);
      });

      it("Reverts if the `newValue` is zero parameter", async function () {
        await expect(dsm.setPauseIntentValidityPeriodBlocks(0)).to.be.revertedWithCustomError(dsm, "ZeroParameter");
      });

      it("Reverts if the `setPauseIntentValidityPeriodBlocks` called by not an owner", async function () {
        await expect(
          dsm.connect(stranger).setPauseIntentValidityPeriodBlocks(config.pauseIntentValidityPeriodBlocks),
        ).to.be.revertedWithCustomError(dsm, "NotAnOwner");
      });

      it("Sets `pauseIntentValidityPeriodBlocks` and fires `PauseIntentValidityPeriodBlocksChanged` event", async function () {
        const newValue = config.pauseIntentValidityPeriodBlocks + 1;

        await expect(dsm.setPauseIntentValidityPeriodBlocks(newValue))
          .to.emit(dsm, "PauseIntentValidityPeriodBlocksChanged")
          .withArgs(newValue);

        expect(await dsm.getPauseIntentValidityPeriodBlocks()).to.equal(newValue);
      });
    });
  });

  context("Max deposits", function () {
    context("Function `getMaxDeposits`", function () {
      it("Returns `maxDepositsPerBlock`", async function () {
        expect(await dsm.getMaxDeposits()).to.equal(config.maxDepositsPerBlock);
      });
    });

    context("Function `setMaxDeposits`", function () {
      let originalState: string;

      this.beforeAll(async function () {
        originalState = await Snapshot.take();
      });

      this.afterAll(async function () {
        await Snapshot.restore(originalState);
      });

      it("Reverts if the `setMaxDeposits` called by not an owner", async function () {
        await expect(
          dsm.connect(stranger).setMaxDeposits(config.maxDepositsPerBlock + 1),
        ).to.be.revertedWithCustomError(dsm, "NotAnOwner");
      });

      it("Sets `setMaxDeposits` and fires `MaxDepositsChanged` event", async function () {
        const newValue = config.maxDepositsPerBlock + 1;

        await expect(dsm.setMaxDeposits(newValue)).to.emit(dsm, "MaxDepositsChanged").withArgs(newValue);

        expect(await dsm.getMaxDeposits()).to.equal(newValue);
      });
    });
  });

  context("Min deposit block distance", function () {
    context("Function `getMinDepositBlockDistance`", function () {
      it("Returns `getMinDepositBlockDistance`", async function () {
        expect(await dsm.getMinDepositBlockDistance()).to.equal(config.minDepositBlockDistance);
      });
    });

    context("Function `setMinDepositBlockDistance`", function () {
      let originalState: string;

      this.beforeAll(async function () {
        originalState = await Snapshot.take();
      });

      this.afterAll(async function () {
        await Snapshot.restore(originalState);
      });

      it("Reverts if the `setMinDepositBlockDistance` called by not an owner", async function () {
        await expect(
          dsm.connect(stranger).setMinDepositBlockDistance(config.minDepositBlockDistance + 1),
        ).to.be.revertedWithCustomError(dsm, "NotAnOwner");
      });

      it("Reverts if the `newValue` is zero parameter", async function () {
        await expect(dsm.setMinDepositBlockDistance(0)).to.be.revertedWithCustomError(dsm, "ZeroParameter");
      });

      it("Sets the equal `newValue` as previous one and NOT fires `MinDepositBlockDistanceChanged` event", async function () {
        await expect(dsm.setMinDepositBlockDistance(config.minDepositBlockDistance)).to.not.emit(
          dsm,
          "MinDepositBlockDistanceChanged",
        );

        expect(await dsm.getMinDepositBlockDistance()).to.equal(config.minDepositBlockDistance);
      });

      it("Sets the `newValue` and fires `MinDepositBlockDistanceChanged` event", async function () {
        const newValue = config.minDepositBlockDistance + 1;

        await expect(dsm.setMinDepositBlockDistance(newValue))
          .to.emit(dsm, "MinDepositBlockDistanceChanged")
          .withArgs(newValue);

        expect(await dsm.getMinDepositBlockDistance()).to.equal(newValue);
      });
    });
  });

  context("Guardians", function () {
    context("Function `getGuardianQuorum`", function () {
      it("Returns number of valid guardian signatures required to vet", async function () {
        expect(await dsm.getGuardianQuorum()).to.equal(0);
      });
    });

    context("Function `setGuardianQuorum`", function () {
      let originalState: string;
      const guardianQuorum = 1;

      this.beforeAll(async function () {
        originalState = await Snapshot.take();
      });

      this.afterAll(async function () {
        await Snapshot.restore(originalState);
      });

      it("Reverts if the `setGuardianQuorum` called by not an owner", async function () {
        await expect(dsm.connect(stranger).setGuardianQuorum(guardianQuorum)).to.be.revertedWithCustomError(
          dsm,
          "NotAnOwner",
        );
      });

      it("Sets the `newValue` and fires `GuardianQuorumChanged` event", async function () {
        await expect(dsm.setGuardianQuorum(guardianQuorum))
          .to.emit(dsm, "GuardianQuorumChanged")
          .withArgs(guardianQuorum);

        expect(await dsm.getGuardianQuorum()).to.equal(guardianQuorum);
      });

      it("Sets the equal `newValue` as previous one and NOT fires `GuardianQuorumChanged` event", async function () {
        await expect(dsm.setGuardianQuorum(guardianQuorum)).to.not.emit(dsm, "GuardianQuorumChanged");

        expect(await dsm.getGuardianQuorum()).to.equal(guardianQuorum);
      });
    });

    context("Function `getGuardians`", function () {
      it("Returns empty list of guardians initially", async function () {
        expect((await dsm.getGuardians()).length).to.equal(0);
      });
    });

    context("Function `isGuardian`", function () {
      let originalState: string;

      this.beforeEach(async function () {
        originalState = await Snapshot.take();
      });

      this.afterEach(async function () {
        await Snapshot.restore(originalState);
      });

      it("Returns false if list of guardians is empty", async function () {
        expect(await dsm.isGuardian(guardian1)).to.equal(false);
      });

      it("Returns false for non-guardian", async function () {
        await dsm.addGuardian(guardian1, 0);
        await dsm.addGuardian(guardian2, 0);

        expect((await dsm.getGuardians()).length).to.equal(2);
        expect(await dsm.isGuardian(guardian3)).to.equal(false);
      });

      it("Returns true non-guardian", async function () {
        await dsm.addGuardian(guardian1, 0);
        await dsm.addGuardian(guardian2, 0);

        expect((await dsm.getGuardians()).length).to.equal(2);
        expect(await dsm.isGuardian(guardian1)).to.equal(true);
        expect(await dsm.isGuardian(guardian2)).to.equal(true);
      });
    });

    context("Function `getGuardianIndex`", function () {
      let originalState: string;

      this.beforeEach(async function () {
        originalState = await Snapshot.take();
      });

      this.afterEach(async function () {
        await Snapshot.restore(originalState);
      });

      it("Returns -1 if list of guardians is empty", async function () {
        expect(await dsm.getGuardianIndex(guardian1)).to.equal(-1);
      });

      it("Returns -1 if the address is not a guardian", async function () {
        await dsm.addGuardian(guardian1, 0);
        await dsm.addGuardian(guardian2, 0);

        expect((await dsm.getGuardians()).length).to.equal(2);
        expect(await dsm.getGuardianIndex(guardian3)).to.equal(-1);
      });

      it("Returns index of the guardian", async function () {
        await dsm.addGuardian(guardian1, 0);
        await dsm.addGuardian(guardian2, 0);

        expect((await dsm.getGuardians()).length).to.equal(2);
        expect(await dsm.getGuardianIndex(guardian2)).to.equal(1);
      });
    });

    context("Function `addGuardian`", function () {
      let originalState: string;

      this.beforeEach(async function () {
        originalState = await Snapshot.take();
      });

      this.afterEach(async function () {
        await Snapshot.restore(originalState);
      });

      it("Reverts if the `addGuardian` called by not an owner", async function () {
        await expect(dsm.connect(stranger).addGuardian(guardian1, 0)).to.be.revertedWithCustomError(dsm, "NotAnOwner");
      });

      it("Reverts if added zero address", async function () {
        await expect(dsm.addGuardian(ZeroAddress, 0)).to.be.revertedWithCustomError(dsm, "ZeroAddress");
      });

      it("Reverts if added duplicate address", async function () {
        await dsm.addGuardian(guardian1, 0);

        await expect(dsm.addGuardian(guardian1, 0)).to.be.revertedWithCustomError(dsm, "DuplicateAddress");
      });

      it("Adds a guardian address sets a new quorum value, fires `GuardianAdded` and `GuardianQuorumChanged` events", async function () {
        const newQuorum = 1;
        const tx1 = await dsm.addGuardian(guardian1, newQuorum);
        expect((await dsm.getGuardians()).length).to.equal(1);
        expect(await dsm.getGuardianQuorum()).to.equal(newQuorum);

        await expect(tx1).to.emit(dsm, "GuardianAdded").withArgs(guardian1.address);

        await expect(tx1).to.emit(dsm, "GuardianQuorumChanged").withArgs(newQuorum);
      });

      it("Adds a guardian address sets the same quorum value, fires `GuardianAdded` and NOT `GuardianQuorumChanged` events", async function () {
        const newQuorum = 0;
        const tx1 = await dsm.addGuardian(guardian1, newQuorum);
        expect((await dsm.getGuardians()).length).to.equal(1);
        expect(await dsm.getGuardianQuorum()).to.equal(newQuorum);

        await expect(tx1).to.emit(dsm, "GuardianAdded").withArgs(guardian1.address);

        await expect(tx1).to.not.emit(dsm, "GuardianQuorumChanged");
      });

      it("Re-adds deleted guardian", async function () {
        await dsm.addGuardian(guardian1, 0);
        await dsm.addGuardian(guardian2, 0);
        expect((await dsm.getGuardians()).length).to.equal(2);

        await dsm.removeGuardian(guardian1, 0);
        expect((await dsm.getGuardians()).length).to.equal(1);

        await dsm.addGuardian(guardian1, 0);

        expect((await dsm.getGuardians()).length).to.equal(2);
        expect(await dsm.isGuardian(guardian1)).to.equal(true);
        expect(await dsm.getGuardians()).to.include(guardian1.address);
      });
    });

    context("Function `addGuardians`", function () {
      let originalState: string;

      this.beforeEach(async function () {
        originalState = await Snapshot.take();
      });

      this.afterEach(async function () {
        await Snapshot.restore(originalState);
      });

      it("Reverts if the `addGuardians` called by not an owner", async function () {
        await expect(dsm.connect(stranger).addGuardians([guardian1, guardian2], 0)).to.be.revertedWithCustomError(
          dsm,
          "NotAnOwner",
        );
      });

      it("Reverts if added zero address", async function () {
        await expect(dsm.addGuardians([guardian1, ZeroAddress, guardian2], 0)).to.be.revertedWithCustomError(
          dsm,
          "ZeroAddress",
        );
      });

      it("Reverts if added duplicate address", async function () {
        await dsm.addGuardian(guardian1, 0);

        await expect(dsm.addGuardians([guardian1, guardian2, guardian1], 0)).to.be.revertedWithCustomError(
          dsm,
          "DuplicateAddress",
        );
      });

      it("Re-adds deleted guardian", async function () {
        await dsm.addGuardians([guardian1, guardian2], 0);
        expect((await dsm.getGuardians()).length).to.equal(2);

        await dsm.removeGuardian(guardian1, 0);
        expect((await dsm.getGuardians()).length).to.equal(1);

        await dsm.addGuardians([guardian1], 0);

        expect((await dsm.getGuardians()).length).to.equal(2);
        expect(await dsm.isGuardian(guardian1)).to.equal(true);
        expect(await dsm.getGuardians()).to.include(guardian1.address);
      });
    });

    context("Function `removeGuardian`", function () {
      let originalState: string;

      this.beforeEach(async function () {
        originalState = await Snapshot.take();
      });

      this.afterEach(async function () {
        await Snapshot.restore(originalState);
      });

      it("Reverts if the `removeGuardian` called by not an owner", async function () {
        await expect(dsm.connect(stranger).removeGuardian(guardian1, 0)).to.be.revertedWithCustomError(
          dsm,
          "NotAnOwner",
        );
      });

      it("Reverts if the `addr` is non-guardian address", async function () {
        await dsm.addGuardian(guardian1, 0);
        await expect(dsm.removeGuardian(guardian2, 0)).to.be.revertedWithCustomError(dsm, "NotAGuardian");
      });

      it("Sets a new quorum on `removeGuardian` and fires `GuardianRemoved` and `GuardianQuorumChanged` event", async function () {
        const newQuorum = 2;

        await dsm.addGuardian(guardian1, 0);
        await dsm.addGuardian(guardian2, 1);
        const tx1 = await dsm.removeGuardian(guardian1, newQuorum);

        await expect(tx1).to.emit(dsm, "GuardianRemoved").withArgs(guardian1.address);

        await expect(tx1).to.emit(dsm, "GuardianQuorumChanged").withArgs(newQuorum);
      });

      it("Can be used to remove all guardians going from head", async function () {
        await dsm.addGuardians([guardian1, guardian2, guardian3], 0);

        await dsm.removeGuardian(guardian1, 0);
        expect(await dsm.getGuardians()).to.deep.equal([guardian3.address, guardian2.address]);
        expect(await dsm.getGuardianIndex(guardian1)).to.equal(-1);
        expect(await dsm.getGuardianIndex(guardian2)).to.equal(1);
        expect(await dsm.getGuardianIndex(guardian3)).to.equal(0);

        await dsm.removeGuardian(guardian3, 0);
        expect(await dsm.getGuardians()).to.deep.equal([guardian2.address]);
        expect(await dsm.getGuardianIndex(guardian1)).to.equal(-1);
        expect(await dsm.getGuardianIndex(guardian2)).to.equal(0);
        expect(await dsm.getGuardianIndex(guardian3)).to.equal(-1);

        await dsm.removeGuardian(guardian2, 0);
        expect(await dsm.getGuardians()).to.deep.equal([]);
        expect(await dsm.getGuardianIndex(guardian1)).to.equal(-1);
        expect(await dsm.getGuardianIndex(guardian2)).to.equal(-1);
        expect(await dsm.getGuardianIndex(guardian3)).to.equal(-1);
      });

      it("Can be used to remove all guardians going from tail", async function () {
        await dsm.addGuardians([guardian1, guardian2, guardian3], 0);

        await dsm.removeGuardian(guardian3, 0);
        expect(await dsm.getGuardians()).to.deep.equal([guardian1.address, guardian2.address]);
        expect(await dsm.getGuardianIndex(guardian1)).to.equal(0);
        expect(await dsm.getGuardianIndex(guardian2)).to.equal(1);
        expect(await dsm.getGuardianIndex(guardian3)).to.equal(-1);

        await dsm.removeGuardian(guardian2, 0);
        expect(await dsm.getGuardians()).to.deep.equal([guardian1.address]);
        expect(await dsm.getGuardianIndex(guardian1)).to.equal(0);
        expect(await dsm.getGuardianIndex(guardian2)).to.equal(-1);
        expect(await dsm.getGuardianIndex(guardian3)).to.equal(-1);

        await dsm.removeGuardian(guardian1, 0);
        expect(await dsm.getGuardians()).to.deep.equal([]);
        expect(await dsm.getGuardianIndex(guardian1)).to.equal(-1);
        expect(await dsm.getGuardianIndex(guardian2)).to.equal(-1);
        expect(await dsm.getGuardianIndex(guardian3)).to.equal(-1);
      });

      it("Can be used to remove all guardians going from the middle", async function () {
        await dsm.addGuardians([guardian1, guardian2, guardian3], 0);

        await dsm.removeGuardian(guardian2, 0);
        expect(await dsm.getGuardians()).to.deep.equal([guardian1.address, guardian3.address]);
        expect(await dsm.getGuardianIndex(guardian1)).to.equal(0);
        expect(await dsm.getGuardianIndex(guardian2)).to.equal(-1);
        expect(await dsm.getGuardianIndex(guardian3)).to.equal(1);
      });
    });
  });
});
