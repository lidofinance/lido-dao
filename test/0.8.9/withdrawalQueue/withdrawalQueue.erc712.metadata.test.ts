import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";

import { StETHMock, WithdrawalQueueERC721 } from "typechain-types";

import {
  deployWithdrawalQueue,
  ether,
  MANAGE_TOKEN_URI_ROLE,
  NFT_DESCRIPTOR_BASE_URI,
  ONE_ETHER,
  QUEUE_NAME,
  QUEUE_SYMBOL,
  shareRate,
  shares,
  Snapshot,
} from "lib";

describe("WithdrawalQueueERC721 ERC-721 Metadata Compliance", () => {
  let owner: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let daoAgent: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let tokenUriManager: HardhatEthersSigner;

  let queue: WithdrawalQueueERC721;
  let queueAddress: string;
  let stEth: StETHMock;
  let nftDescriptorAddress: string;

  let originalState: string;

  before(async () => {
    [owner, stranger, daoAgent, user, tokenUriManager] = await ethers.getSigners();
    const deployed = await deployWithdrawalQueue({
      stEthSettings: { initialStEth: ONE_ETHER, owner },
      queueAdmin: daoAgent,
      queuePauser: daoAgent,
      queueResumer: daoAgent,
      queueFinalizer: daoAgent,
    });

    ({ queue, queue, queueAddress, stEth, nftDescriptorAddress } = deployed);

    await deployed.stEth.setTotalPooledEther(ether("600.00"));
    // we need 1 ETH additionally to pay gas on finalization because coverage ignores gasPrice=0
    await setBalance(deployed.stEthAddress, ether("601.00"));

    await stEth.mintShares(user, shares(1n));
    await stEth.connect(user).approve(queueAddress, ether("300.00"));

    await queue.connect(daoAgent).grantRole(MANAGE_TOKEN_URI_ROLE, tokenUriManager);

    originalState = await Snapshot.take();
  });

  context("name", () => {
    it("Returns the correct name", async () => {
      expect(await queue.name()).to.equal(QUEUE_NAME);
    });
  });

  context("symbol", () => {
    it("Returns the correct symbol", async () => {
      expect(await queue.symbol()).to.equal(QUEUE_SYMBOL);
    });
  });

  context("setBaseURI", () => {
    const baseTokenUri = "https://example.com";

    beforeEach(async () => {
      originalState = await Snapshot.take();
    });

    afterEach(async () => {
      await Snapshot.restore(originalState);
    });

    // REVIEW: Do we need this? Need custom error?
    it("Reverts when called by non-manager", async () => {
      await expect(queue.connect(stranger).setBaseURI(baseTokenUri)).to.be.revertedWith(
        /AccessControl.*?is missing role.*/,
      );
    });

    it("Sets the correct baseURI and fires `BaseURISet`", async () => {
      expect(await queue.connect(tokenUriManager).setBaseURI(baseTokenUri))
        .to.emit(queue, "BaseURISet")
        .withArgs(baseTokenUri);

      expect(await queue.getBaseURI()).to.equal(baseTokenUri);
    });
  });

  context("getBaseURI", () => {
    const baseTokenUri = "https://example.com";

    beforeEach(async () => {
      originalState = await Snapshot.take();
    });

    afterEach(async () => {
      await Snapshot.restore(originalState);
    });

    it("Returns empty string when not set", async () => {
      expect(await queue.getBaseURI()).to.equal("");
    });

    it("Returns correct tokenURI when set by token manager", async () => {
      expect(await queue.connect(tokenUriManager).setBaseURI(baseTokenUri))
        .to.emit(queue, "BaseURISet")
        .withArgs(baseTokenUri);

      expect(await queue.getBaseURI()).to.equal(baseTokenUri);
    });
  });

  context("setNFTDescriptorAddress", () => {
    beforeEach(async () => {
      originalState = await Snapshot.take();
    });

    afterEach(async () => {
      await Snapshot.restore(originalState);
    });

    it("Reverts when called by non-manager", async () => {
      await expect(queue.connect(stranger).setNFTDescriptorAddress(nftDescriptorAddress)).to.be.revertedWith(
        /AccessControl.*?is missing role.*/,
      );
    });

    it("Sets the correct NFTDescriptorAddress and fires `NftDescriptorAddressSet`", async () => {
      expect(await queue.connect(tokenUriManager).setNFTDescriptorAddress(nftDescriptorAddress))
        .to.emit(queue, "NftDescriptorAddressSet")
        .withArgs(nftDescriptorAddress);

      expect(await queue.getNFTDescriptorAddress()).to.equal(nftDescriptorAddress);
    });
  });

  context("getNFTDescriptorAddress", () => {
    beforeEach(async () => {
      originalState = await Snapshot.take();
    });

    afterEach(async () => {
      await Snapshot.restore(originalState);
    });

    it("Returns zero address when not set", async () => {
      expect(await queue.getNFTDescriptorAddress()).to.equal(ZeroAddress);
    });

    it("Returns correct NFTDescriptorAddress when set by token manager", async () => {
      await queue.connect(tokenUriManager).setNFTDescriptorAddress(nftDescriptorAddress);

      expect(await queue.getNFTDescriptorAddress()).to.equal(nftDescriptorAddress);
    });
  });

  context("tokenURI", () => {
    const requestId = 1;
    const baseTokenUri = "https://example.com";

    beforeEach(async () => {
      originalState = await Snapshot.take();
      await queue.connect(user).requestWithdrawals([ether("25.00"), ether("25.00")], user);
    });

    afterEach(async () => {
      await Snapshot.restore(originalState);
    });

    it("Reverts on invalid token id", async () => {
      await expect(queue.tokenURI(0)).to.be.revertedWithCustomError(queue, "InvalidRequestId");
    });

    it("Returns tokenURI without nftDescriptor and baseUri", async () => {
      expect(await queue.tokenURI(requestId)).to.be.equal("");
    });

    it("Returns correct tokenURI without nftDescriptor", async () => {
      await expect(queue.connect(tokenUriManager).setBaseURI(baseTokenUri))
        .to.emit(queue, "BaseURISet")
        .withArgs(baseTokenUri);

      const createdAt = (await queue.getWithdrawalStatus([requestId]))[0].timestamp;
      const expectedTokenUri = `${baseTokenUri}/${requestId}?requested=${ether("25.00")}&created_at=${createdAt}`;
      expect(await queue.tokenURI(requestId)).to.equal(expectedTokenUri);
    });

    it("Returns correct tokenURI with nftDescriptor", async () => {
      await expect(queue.connect(tokenUriManager).setNFTDescriptorAddress(nftDescriptorAddress))
        .to.emit(queue, "NftDescriptorAddressSet")
        .withArgs(nftDescriptorAddress);

      expect(await queue.tokenURI(requestId)).to.equal(`${NFT_DESCRIPTOR_BASE_URI}${requestId}`);
    });

    it("Returns correct tokenURI after finalization", async () => {
      await expect(queue.connect(tokenUriManager).setBaseURI(baseTokenUri))
        .to.emit(queue, "BaseURISet")
        .withArgs(baseTokenUri);

      await queue.connect(daoAgent).finalize(1, shareRate(300n));

      const createdAt = (await queue.getWithdrawalStatus([requestId]))[0].timestamp;
      const finalizedEth = (await queue.getClaimableEther([1], [1]))[0];

      const expectedTokenUri = `${baseTokenUri}/${requestId}?requested=${ether("25.00")}&created_at=${createdAt}&finalized=${finalizedEth}`;
      expect(await queue.tokenURI(requestId)).to.equal(expectedTokenUri);
    });

    it("Returns correct tokenURI after finalization with discount", async () => {
      await expect(queue.connect(tokenUriManager).setBaseURI(baseTokenUri))
        .to.emit(queue, "BaseURISet")
        .withArgs(baseTokenUri);

      const batch = await queue.prefinalize([1], shareRate(1n));
      await queue.connect(daoAgent).finalize(1, shareRate(1n), { value: batch.ethToLock });

      const createdAt = (await queue.getWithdrawalStatus([requestId]))[0].timestamp;
      const finalizedEth = batch.sharesToBurn;

      const expectedTokenUri = `${baseTokenUri}/${requestId}?requested=${ether("25.00")}&created_at=${createdAt}&finalized=${finalizedEth}`;
      expect(await queue.tokenURI(requestId)).to.equal(expectedTokenUri);
    });
  });
});
