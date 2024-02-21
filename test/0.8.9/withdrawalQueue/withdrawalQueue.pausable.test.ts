import { expect } from "chai";
import { ethers } from "hardhat";
import { afterEach } from "mocha";

import { HardhatEthersProvider } from "@nomicfoundation/hardhat-ethers/internal/hardhat-ethers-provider";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { WithdrawalQueueERC721 } from "typechain-types";

import {
  deployWithdrawalQueue,
  ONE_ETHER,
  Snapshot,
  WITHDRAWAL_PAUSE_INFINITELY,
  WITHDRAWAL_PAUSE_ROLE,
  WITHDRAWAL_RESUME_ROLE,
} from "lib";

const getBlockTimestamp = async (provider: HardhatEthersProvider) => {
  const block = await provider.getBlock("latest");
  return block!.timestamp;
};

describe("WithdrawalQueueERC721:Pausable", () => {
  let owner: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let daoAgent: HardhatEthersSigner;

  let queue: WithdrawalQueueERC721;

  let originalState: string;
  let provider: typeof ethers.provider;

  let PAUSE_ROLE: string;
  let RESUME_ROLE: string;

  before(async () => {
    ({ provider } = ethers);

    [owner, stranger, daoAgent] = await ethers.getSigners();

    const deployed = await deployWithdrawalQueue({
      stEthSettings: { initialStEth: ONE_ETHER, owner },
      queueAdmin: daoAgent,
      queuePauser: daoAgent,
      queueResumer: daoAgent,
      queueFinalizer: daoAgent,
    });

    ({ queue } = deployed);

    PAUSE_ROLE = await queue.PAUSE_ROLE();
    RESUME_ROLE = await queue.RESUME_ROLE();
  });

  beforeEach(async () => (originalState = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(originalState));

  context("Constants", () => {
    it("Returns the PAUSE_INFINITELY variable", async () => {
      expect(await queue.PAUSE_INFINITELY()).to.equal(WITHDRAWAL_PAUSE_INFINITELY);
    });

    it("Returns the PAUSE_ROLE variable", async () => {
      expect(await queue.PAUSE_ROLE()).to.equal(WITHDRAWAL_PAUSE_ROLE);
    });

    it("Returns the RESUME_ROLE variable", async () => {
      expect(await queue.RESUME_ROLE()).to.equal(WITHDRAWAL_RESUME_ROLE);
    });
  });

  context("pauseFor", () => {
    it("Reverts if the caller is unauthorised", async () => {
      await expect(queue.connect(stranger).pauseFor(1n)).to.be.revertedWithOZAccessControlError(
        stranger.address,
        PAUSE_ROLE,
      );
    });
  });

  context("pauseUntil", () => {
    it("Reverts if the caller is unauthorised", async () => {
      const blockTimestamp = await getBlockTimestamp(provider);

      await expect(queue.connect(stranger).pauseUntil(blockTimestamp + 1)).to.be.revertedWithOZAccessControlError(
        stranger.address,
        PAUSE_ROLE,
      );
    });
  });

  context("resume", () => {
    it("Reverts if the caller is unauthorised", async () => {
      await queue.connect(daoAgent).pauseFor(1000n);

      await expect(queue.connect(stranger).resume()).to.be.revertedWithOZAccessControlError(
        stranger.address,
        RESUME_ROLE,
      );
    });
  });
});
