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
} from "../../lib";
import { ERC721, ERC721ReceiverMock } from "../../typechain-types";

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

// TODO: description
// TODO: call safeTransferFrom directly instead of using signature
// TODO: use DRY when testing overloadable functions (calling without and with extra data)
export function testERC721Compliance({ tokenName, deploy, suiteFunction = describe }: ERC721Target) {
  suiteFunction(`${tokenName} ERC-721 Compliance`, function () {
    let token: ERC721;
    let name: string;
    let symbol: string;
    let holder: HardhatEthersSigner;
    let holderTokenId: bigint;

    let spender: HardhatEthersSigner;
    let eoaRecipient: HardhatEthersSigner;
    let contractRecipient: ERC721ReceiverMock;
    let stranger: HardhatEthersSigner;

    this.beforeEach(async function () {
      ({ token, name, symbol, holder, holderTokenId } = await deploy());
      [spender, eoaRecipient, stranger] = await ethers.getSigners();

      contractRecipient = await ethers.deployContract("ERC721ReceiverMock");
    });

    it("Function `name` returns the name of the token", async function () {
      expect(await token.name()).to.equal(name);
    });

    it("Function `symbol` returns the symbol of the token", async function () {
      expect(await token.symbol()).to.equal(symbol);
    });

    context("Function `supportsInterface`", function () {
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

    context("Function `balanceOf`", function () {
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

    context("Function `ownerOf`", function () {
      it("Returns the address of the holder", async function () {
        expect(await token.ownerOf(holderTokenId)).to.equal(holder.address);
      });
    });

    context("Function `safeTransferFrom`", function () {
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

    resetState(this);
  });
}
