import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";
import { ExclusiveSuiteFunction, PendingSuiteFunction, describe } from "mocha";
import {
  ERC165_INTERFACE_ID,
  ERC721METADATA_INTERFACE_ID,
  ERC721_INTERFACE_ID,
  INVALID_INTERFACE_ID,
  resetState,
} from "lib";
import { ERC721, ERC721ReceiverMock } from "typechain-types";

interface ERC721Target {
  tokenName: string;
  deploy: () => Promise<{
    token: ERC721;
    name: string;
    symbol: string;
    holder: HardhatEthersSigner;
    holderTokenId: bigint;
  }>;
  suiteFunction?: ExclusiveSuiteFunction | PendingSuiteFunction;
}

/**
 * @function testERC20Compliance
 * @description This function provides a black-box test suite for verifying
 * the compliance of Ethereum contracts with the ERC-721 token standard.
 * Reference: https://eips.ethereum.org/EIPS/eip-721
 *
 *
 * Inside the suite, various test cases are defined to check the compliance of the token.
 * These include:
 * - Checking the token's name and symbol.
 * - Testing support for ERC-165 and ERC-721 interfaces.
 * - Verifying ownership and balance queries.
 * - Ensuring proper functioning of transfer mechanisms (`safeTransferFrom`, `transferFrom`).
 * - Testing approval functionalities (`approve`, `setApprovalForAll`, `getApproved`, `isApprovedForAll`).
 *
 * It is expected that the token contract being tested is compatible with the ERC721
 * interface and adheres to its standards.
 *
 * @param {ERC721Target} target setup for testing the ERC-721 token
 * @param {string} target.tokenName name of the token to use in the suite description
 * @param {Function} target.deploy async function that deploys the token and returns its
 * instance along with other necessary details.
 * @param {Function} [target.suiteFunction=describe] function that runs the suite, a temporary workaround for running
 * the suite exclusively or skipping the suite; see the todo below
 *
 * The `deploy` function should return an object containing:
 * - `token`: The ERC721 token instance.
 * - `name`: The expected name of the token.
 * - `symbol`: The expected symbol of the token.
 * - `holder`: A signer who holds the token.
 * - `holderTokenId`: The token ID held by the holder.
 *
 * @todo call safeTransferFrom directly instead of using signature
 * @todo use DRY when testing overloadable functions (calling without and with extra data)
 * @todo rewrite the function to support the same interface as `describe`, i.e.
 * instead of passing `suiteFunction`, we should be able to call the function like:
 * testERC20Compliance.only(target)
 * testERC20Compliance.skip(target)
 */
export function testERC721Compliance({ tokenName, deploy, suiteFunction = describe }: ERC721Target) {
  suiteFunction(`${tokenName} ERC-721 Compliance`, function () {
    let token: ERC721;
    let name: string;
    let symbol: string;
    let holder: HardhatEthersSigner;
    let holderTokenId: bigint;

    let spender: HardhatEthersSigner;
    let newSpender: HardhatEthersSigner;
    let eoaRecipient: HardhatEthersSigner;
    let contractRecipient: ERC721ReceiverMock;
    let stranger: HardhatEthersSigner;

    this.beforeEach(async function () {
      ({ token, name, symbol, holder, holderTokenId } = await deploy());
      [spender, newSpender, eoaRecipient, stranger] = await ethers.getSigners();

      contractRecipient = await ethers.deployContract("ERC721ReceiverMock");
    });

    context("name", function () {
      it("Returns the name of the token", async function () {
        expect(await token.name()).to.equal(name);
      });
    });

    context("symbol", function () {
      it("Returns the symbol of the token", async function () {
        expect(await token.symbol()).to.equal(symbol);
      });
    });

    context("supportsInterface", function () {
      it("Returns true for ERC-165 interface", async function () {
        expect(await token.supportsInterface(ERC165_INTERFACE_ID)).to.equal(true);
      });

      it("Returns true for ERC-721 interface", async function () {
        expect(await token.supportsInterface(ERC721_INTERFACE_ID)).to.equal(true);
      });

      it("Returns false for invalid interface", async function () {
        expect(await token.supportsInterface(INVALID_INTERFACE_ID)).to.equal(false);
      });

      it("[OPTIONAL] Returns true for ERC-721Metadata interface", async function () {
        expect(await token.supportsInterface(ERC721METADATA_INTERFACE_ID)).to.equal(true);
      });
    });

    context("balanceOf", function () {
      it("Returns the number of tokens owned by the holder", async function () {
        expect(await token.balanceOf(holder)).to.be.greaterThan(0n);
      });

      it("Returns zero if the user does not have tokens", async function () {
        expect(await token.balanceOf(stranger)).to.equal(0n);
      });

      it("Throws for queries about the zero address", async function () {
        await expect(token.balanceOf(ZeroAddress)).to.be.reverted;
      });
    });

    context("ownerOf", function () {
      it("Returns the address of the holder", async function () {
        expect(await token.ownerOf(holderTokenId)).to.equal(holder.address);
      });
    });

    context("safeTransferFrom", function () {
      this.beforeEach(async function () {
        await expect(token.connect(holder).approve(spender, holderTokenId))
          .to.emit(token, "Approval")
          .withArgs(holder.address, spender.address, holderTokenId);
      });

      it("Allows the spender to transfer the token to the recipient on behalf of the holder", async function () {
        await expect(
          token.connect(spender)["safeTransferFrom(address,address,uint256)"](holder, eoaRecipient, holderTokenId),
        )
          .to.emit(token, "Transfer")
          .withArgs(holder.address, await eoaRecipient.getAddress(), holderTokenId);

        expect(await token.ownerOf(holderTokenId)).to.equal(await eoaRecipient.getAddress());
      });

      it("Allows the spender to transfer the token to the recipient on behalf of the holder (with data)", async function () {
        await expect(
          token
            .connect(spender)
            ["safeTransferFrom(address,address,uint256,bytes)"](holder, eoaRecipient, holderTokenId, new Uint8Array()),
        )
          .to.emit(token, "Transfer")
          .withArgs(holder.address, await eoaRecipient.getAddress(), holderTokenId);

        expect(await token.ownerOf(holderTokenId)).to.equal(await eoaRecipient.getAddress());
      });

      it("Allows the holder to transfer the token to the recipient", async function () {
        await expect(
          token.connect(holder)["safeTransferFrom(address,address,uint256)"](holder, eoaRecipient, holderTokenId),
        )
          .to.emit(token, "Transfer")
          .withArgs(holder.address, await eoaRecipient.getAddress(), holderTokenId);

        expect(await token.ownerOf(holderTokenId)).to.equal(await eoaRecipient.getAddress());
      });

      it("Allows the holder to transfer the token to the recipient (with data)", async function () {
        await expect(
          token
            .connect(holder)
            ["safeTransferFrom(address,address,uint256,bytes)"](holder, eoaRecipient, holderTokenId, new Uint8Array()),
        )
          .to.emit(token, "Transfer")
          .withArgs(holder.address, await eoaRecipient.getAddress(), holderTokenId);

        expect(await token.ownerOf(holderTokenId)).to.equal(await eoaRecipient.getAddress());
      });

      it("Throws if the sender does not own the token", async function () {
        await expect(
          token.connect(spender)["safeTransferFrom(address,address,uint256)"](stranger, eoaRecipient, holderTokenId),
        ).to.be.reverted;
      });

      it("Throws if the sender does not own the token (with data)", async function () {
        await expect(
          token
            .connect(spender)
            ["safeTransferFrom(address,address,uint256,bytes)"](
              stranger,
              eoaRecipient,
              holderTokenId,
              new Uint8Array(),
            ),
        ).to.be.reverted;
      });

      it("Throws if the recipient is the zero address", async function () {
        await expect(
          token.connect(spender)["safeTransferFrom(address,address,uint256)"](holder, ZeroAddress, holderTokenId),
        ).to.be.reverted;
      });

      it("Throws if the recipient is the zero address (with data)", async function () {
        await expect(
          token
            .connect(spender)
            ["safeTransferFrom(address,address,uint256,bytes)"](holder, ZeroAddress, holderTokenId, new Uint8Array()),
        ).to.be.reverted;
      });

      it("Throws if the token id is invalid", async function () {
        await expect(
          token.connect(spender)["safeTransferFrom(address,address,uint256)"](holder, eoaRecipient, holderTokenId + 1n),
        ).to.be.reverted;
      });

      it("Throws if the token id is invalid (with data)", async function () {
        await expect(
          token
            .connect(spender)
            ["safeTransferFrom(address,address,uint256,bytes)"](
              holder,
              eoaRecipient,
              holderTokenId + 1n,
              new Uint8Array(),
            ),
        ).to.be.reverted;
      });

      it("Throws if the recipient's `onERC721Received` hook does not return the hook selector", async function () {
        await expect(
          token.connect(spender)["safeTransferFrom(address,address,uint256)"](holder, contractRecipient, holderTokenId),
        ).to.be.reverted;
      });

      it("Throws if the recipient's `onERC721Received` hook does not return the hook selector (with data)", async function () {
        await expect(
          token
            .connect(spender)
            ["safeTransferFrom(address,address,uint256,bytes)"](
              holder,
              contractRecipient,
              holderTokenId,
              new Uint8Array(),
            ),
        ).to.be.reverted;
      });
    });

    context("transferFrom", function () {
      this.beforeEach(async function () {
        await expect(token.connect(holder).approve(spender, holderTokenId))
          .to.emit(token, "Approval")
          .withArgs(holder.address, spender.address, holderTokenId);
      });

      it("Allows the spender to transfer the token to the recipient on behalf of the holder", async function () {
        await expect(token.connect(spender).transferFrom(holder, eoaRecipient, holderTokenId))
          .to.emit(token, "Transfer")
          .withArgs(holder.address, await eoaRecipient.getAddress(), holderTokenId);

        expect(await token.ownerOf(holderTokenId)).to.equal(await eoaRecipient.getAddress());
      });

      it("Allows the holder to transfer the token to the recipient", async function () {
        await expect(token.connect(holder).transferFrom(holder, eoaRecipient, holderTokenId))
          .to.emit(token, "Transfer")
          .withArgs(holder.address, await eoaRecipient.getAddress(), holderTokenId);

        expect(await token.ownerOf(holderTokenId)).to.equal(await eoaRecipient.getAddress());
      });

      it("Throws if the sender does not own the token", async function () {
        await expect(token.connect(spender).transferFrom(stranger, eoaRecipient, holderTokenId)).to.be.reverted;
      });

      it("Throws if the recipient is the zero address", async function () {
        await expect(token.connect(spender).transferFrom(holder, ZeroAddress, holderTokenId)).to.be.reverted;
      });

      it("Throws if the token id is invalid", async function () {
        await expect(token.connect(spender).transferFrom(holder, eoaRecipient, holderTokenId + 1n)).to.be.reverted;
      });
    });

    context("approve", function () {
      this.beforeEach(async function () {
        await expect(token.connect(holder).approve(spender, holderTokenId))
          .to.emit(token, "Approval")
          .withArgs(holder.address, spender.address, holderTokenId);
      });

      it("Changes the approved address for the token", async function () {
        expect(await token.getApproved(holderTokenId)).to.equal(spender.address);

        await expect(token.connect(holder).approve(newSpender, holderTokenId))
          .to.emit(token, "Approval")
          .withArgs(holder.address, newSpender.address, holderTokenId);

        expect(await token.getApproved(holderTokenId)).to.equal(newSpender.address);
      });

      it("Reaffirm the approved address for the token", async function () {
        expect(await token.getApproved(holderTokenId)).to.equal(spender.address);

        await expect(token.connect(holder).approve(spender, holderTokenId))
          .to.emit(token, "Approval")
          .withArgs(holder.address, spender.address, holderTokenId);

        expect(await token.getApproved(holderTokenId)).to.equal(spender.address);
      });

      it("Revoke the approval", async function () {
        expect(await token.getApproved(holderTokenId)).to.equal(spender.address);

        await expect(token.connect(holder).approve(ZeroAddress, holderTokenId))
          .to.emit(token, "Approval")
          .withArgs(holder.address, ZeroAddress, holderTokenId);

        expect(await token.getApproved(holderTokenId)).to.equal(ZeroAddress);
      });

      it("Throws if the sender is not the owner or the approved spender", async function () {
        await expect(token.connect(stranger).approve(newSpender, holderTokenId)).to.be.reverted;
      });
    });

    context("setApprovalForAll", function () {
      it("Enable approval for the spender to manage all of the holder's tokens", async function () {
        expect(await token.isApprovedForAll(holder, spender)).to.equal(false);

        await expect(token.connect(holder).setApprovalForAll(spender, true))
          .to.emit(token, "ApprovalForAll")
          .withArgs(holder.address, spender.address, true);

        expect(await token.isApprovedForAll(holder, spender)).to.equal(true);
      });

      it("Disable approval for the spender to manage all of the holder's tokens", async function () {
        expect(await token.isApprovedForAll(holder, spender)).to.equal(false);

        await expect(token.connect(holder).setApprovalForAll(spender, true))
          .to.emit(token, "ApprovalForAll")
          .withArgs(holder.address, spender.address, true);

        expect(await token.isApprovedForAll(holder, spender)).to.equal(true);

        await expect(token.connect(holder).setApprovalForAll(spender, false))
          .to.emit(token, "ApprovalForAll")
          .withArgs(holder.address, spender.address, false);

        expect(await token.isApprovedForAll(holder, spender)).to.equal(false);
      });

      it("MUST allow multiple operators per owner", async function () {
        expect(await token.isApprovedForAll(holder, spender)).to.equal(false);
        expect(await token.isApprovedForAll(holder, newSpender)).to.equal(false);

        await expect(token.connect(holder).setApprovalForAll(spender, true))
          .to.emit(token, "ApprovalForAll")
          .withArgs(holder.address, spender.address, true);

        await expect(token.connect(holder).setApprovalForAll(newSpender, true))
          .to.emit(token, "ApprovalForAll")
          .withArgs(holder.address, newSpender.address, true);

        expect(await token.isApprovedForAll(holder, spender)).to.equal(true);
        expect(await token.isApprovedForAll(holder, newSpender)).to.equal(true);
      });
    });

    context("getApproved", function () {
      it("Returns the approved address for the token", async function () {
        await expect(token.connect(holder).approve(spender, holderTokenId))
          .to.emit(token, "Approval")
          .withArgs(holder.address, spender.address, holderTokenId);

        expect(await token.getApproved(holderTokenId)).to.equal(spender.address);
      });

      it("Returns zero address if there are no approved addresses", async function () {
        expect(await token.getApproved(holderTokenId)).to.equal(ZeroAddress);
      });

      it("Throws if the token id is not valid", async function () {
        await expect(token.getApproved(holderTokenId + 1n)).to.be.reverted;
      });
    });

    context("isApprovedForAll`", function () {
      it("Returns false if the address is not approved for all holder's tokens", async function () {
        expect(await token.isApprovedForAll(holder, spender)).to.equal(false);
      });

      it("Returns true if the address is approved for all holder's tokens", async function () {
        await expect(token.connect(holder).setApprovalForAll(spender, true))
          .to.emit(token, "ApprovalForAll")
          .withArgs(holder.address, spender.address, true);

        expect(await token.isApprovedForAll(holder, spender)).to.equal(true);
      });
    });

    resetState(this);
  });
}
