import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";

import { StETHMock, WithdrawalQueueERC721 } from "typechain-types";

import {
  deployWithdrawalQueue,
  ERC4906_INTERFACE_ID,
  ether,
  MOCK_NFT_DESCRIPTOR_BASE_URI,
  ONE_ETHER,
  QUEUE_NAME,
  QUEUE_SYMBOL,
  shareRate,
  shares,
  Snapshot,
  WITHDRAWAL_MANAGE_TOKEN_URI_ROLE,
} from "lib";

describe("unstETH ERC-721 Metadata Compliance", () => {
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

  let MANAGE_TOKEN_URI_ROLE: string;

  before(async () => {
    [owner, stranger, daoAgent, user, tokenUriManager] = await ethers.getSigners();
    const deployed = await deployWithdrawalQueue({
      stEthSettings: { initialStEth: ONE_ETHER, owner },
      queueAdmin: daoAgent,
      queuePauser: daoAgent,
      queueResumer: daoAgent,
      queueFinalizer: daoAgent,
    });

    ({ queue, queueAddress, stEth, nftDescriptorAddress } = deployed);

    MANAGE_TOKEN_URI_ROLE = await queue.MANAGE_TOKEN_URI_ROLE();

    await deployed.stEth.setTotalPooledEther(ether("600.00"));
    // we need 1 ETH additionally to pay gas on finalization because coverage ignores gasPrice=0
    await setBalance(deployed.stEthAddress, ether("601.00"));

    await stEth.mintShares(user, shares(1n));
    await stEth.connect(user).approve(queueAddress, ether("300.00"));

    await queue.connect(daoAgent).grantRole(MANAGE_TOKEN_URI_ROLE, tokenUriManager);
  });

  beforeEach(async () => (originalState = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(originalState));

  context("Constants", () => {
    it("Returns the MANAGE_TOKEN_URI_ROLE variable", async () => {
      expect(await queue.MANAGE_TOKEN_URI_ROLE()).to.equal(WITHDRAWAL_MANAGE_TOKEN_URI_ROLE);
    });
  });

  context("supportsInterface", () => {
    // NB! This is a test for ERC4906, that is Metadata Update Extension https://eips.ethereum.org/EIPS/eip-4906
    it("Returns true for ERC4906 interface", async () => {
      expect(await queue.supportsInterface(ERC4906_INTERFACE_ID)).to.be.true;
    });
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

  context("Base URI", () => {
    context("setBaseURI", () => {
      const baseTokenUri = "https://example.com";

      // REVIEW: Do we need this? Need custom error?
      it("Reverts when called by non-manager", async () => {
        await expect(queue.connect(stranger).setBaseURI(baseTokenUri)).to.be.revertedWithOZAccessControlError(
          stranger.address,
          MANAGE_TOKEN_URI_ROLE,
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
  });

  context("NFT Descriptor", () => {
    context("setNFTDescriptorAddress", () => {
      it("Reverts when called by non-manager", async () => {
        await expect(
          queue.connect(stranger).setNFTDescriptorAddress(nftDescriptorAddress),
        ).to.be.revertedWithOZAccessControlError(stranger.address, MANAGE_TOKEN_URI_ROLE);
      });

      it("Sets the correct NFTDescriptorAddress and fires `NftDescriptorAddressSet`", async () => {
        expect(await queue.connect(tokenUriManager).setNFTDescriptorAddress(nftDescriptorAddress))
          .to.emit(queue, "NftDescriptorAddressSet")
          .withArgs(nftDescriptorAddress);

        expect(await queue.getNFTDescriptorAddress()).to.equal(nftDescriptorAddress);
      });
    });

    context("getNFTDescriptorAddress", () => {
      it("Returns zero address when not set", async () => {
        expect(await queue.getNFTDescriptorAddress()).to.equal(ZeroAddress);
      });

      it("Returns correct NFTDescriptorAddress when set by token manager", async () => {
        await queue.connect(tokenUriManager).setNFTDescriptorAddress(nftDescriptorAddress);

        expect(await queue.getNFTDescriptorAddress()).to.equal(nftDescriptorAddress);
      });
    });
  });

  context("tokenURI", () => {
    const requestId = 1;
    const baseTokenUri = "https://example.com";

    beforeEach(async () => {
      await queue.connect(user).requestWithdrawals([ether("25.00"), ether("25.00")], user);
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
      const params = new URLSearchParams({
        requested: ether("25.00").toString(),
        created_at: createdAt.toString(),
      });

      expect(await queue.tokenURI(requestId)).to.equal(`${baseTokenUri}/${requestId}?${params.toString()}`);
    });

    it("Returns correct tokenURI with nftDescriptor", async () => {
      await expect(queue.connect(tokenUriManager).setNFTDescriptorAddress(nftDescriptorAddress))
        .to.emit(queue, "NftDescriptorAddressSet")
        .withArgs(nftDescriptorAddress);

      expect(await queue.tokenURI(requestId)).to.equal(`${MOCK_NFT_DESCRIPTOR_BASE_URI}${requestId}`);
    });

    it("Returns correct tokenURI after finalization", async () => {
      await expect(queue.connect(tokenUriManager).setBaseURI(baseTokenUri))
        .to.emit(queue, "BaseURISet")
        .withArgs(baseTokenUri);

      await queue.connect(daoAgent).finalize(1, shareRate(300n));

      const createdAt = (await queue.getWithdrawalStatus([requestId]))[0].timestamp;
      const finalizedEth = (await queue.getClaimableEther([1], [1]))[0];

      const params = new URLSearchParams({
        requested: ether("25.00").toString(),
        created_at: createdAt.toString(),
        finalized: finalizedEth.toString(),
      });

      expect(await queue.tokenURI(requestId)).to.equal(`${baseTokenUri}/${requestId}?${params.toString()}`);
    });

    it("Returns correct tokenURI after finalization with discount", async () => {
      await expect(queue.connect(tokenUriManager).setBaseURI(baseTokenUri))
        .to.emit(queue, "BaseURISet")
        .withArgs(baseTokenUri);

      const batch = await queue.prefinalize([1], shareRate(1n));
      await queue.connect(daoAgent).finalize(1, shareRate(1n), { value: batch.ethToLock });

      const createdAt = (await queue.getWithdrawalStatus([requestId]))[0].timestamp;
      const finalized = batch.sharesToBurn;

      const params = new URLSearchParams({
        requested: ether("25.00").toString(),
        created_at: createdAt.toString(),
        finalized: finalized.toString(),
      });

      expect(await queue.tokenURI(requestId)).to.equal(`${baseTokenUri}/${requestId}?${params.toString()}`);
    });

    it("Returns correct tokenURI after token ownership transfer", async () => {
      const currentURI = await queue.tokenURI(requestId);
      await queue.connect(user).transferFrom(user.address, stranger.address, requestId);
      expect(await queue.tokenURI(requestId)).to.equal(currentURI);
    });

    it("Returns correct tokenURI after NFT Descriptor update", async () => {
      const NEW_NFT_URL = "https://example.com/";
      const newNFTDescriptor = await ethers.deployContract("NFTDescriptorMock", [NEW_NFT_URL]);
      const newNFTDescriptorAddress = await newNFTDescriptor.getAddress();

      await expect(queue.connect(tokenUriManager).setNFTDescriptorAddress(newNFTDescriptorAddress))
        .to.emit(queue, "NftDescriptorAddressSet")
        .withArgs(newNFTDescriptorAddress);

      expect(await queue.tokenURI(requestId)).to.equal(`${NEW_NFT_URL}${requestId}`);

      await queue.connect(tokenUriManager).setNFTDescriptorAddress(ZeroAddress);

      expect(await queue.tokenURI(requestId)).to.equal("");
    });
  });
});
