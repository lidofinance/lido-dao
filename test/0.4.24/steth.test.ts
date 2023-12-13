import { describe } from "mocha";
import { batch, ether, resetState } from "../../lib";
import { ZeroAddress, parseUnits } from "ethers";
import { StETHMock } from "../../typechain-types";
import { ethers } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe.only("StETH.sol", function () {
  const initialSupply = parseUnits("1.0", "ether");

  let steth: StETHMock;

  this.beforeEach(async function () {
    steth = await ethers.deployContract("StETHMock", { value: initialSupply });
  });

  context("Function `getTotalPooledEther`", function () {
    it("Returns the amount of ether sent upon construction", async function () {
      expect(await steth.getTotalPooledEther()).to.equal(initialSupply);
    });

    for (const [rebase, factor] of [
      ["neutral", 100n], // 1
      ["positive", 105n], // 0.95
      ["negative", 95n], // 1.05
    ]) {
      context(`After ${rebase} rebase`, function () {
        const totalPooledEtherAfterRebase = (initialSupply * (factor as bigint)) / 100n;

        this.beforeEach(async function () {
          await steth.setTotalPooledEther(totalPooledEtherAfterRebase);
        });

        it("Is equivalent to the `totalSupply` call", async function () {
          expect(await steth.getTotalPooledEther()).to.equal(await steth.totalSupply());
        });
      });
    }
  });

  context("With a holder", function () {
    let holder: HardhatEthersSigner;
    let recipient: HardhatEthersSigner;
    let spender: HardhatEthersSigner;

    this.beforeEach(async function () {
      [holder, recipient, spender] = await ethers.getSigners();

      await steth.setTotalPooledEther(ether("100.0"));

      const holderBalance = ether("99.0");
      await steth.mintShares(holder, holderBalance);
      expect(await steth.balanceOf(holder)).to.equal(holderBalance);
    });

    context("Function `transfer`", function () {
      it("Transfers stETH to the recipient and fires the `Transfer` and `TransferShares` events", async function () {
        const beforeTransfer = await batch({
          holderBalance: steth.balanceOf(holder),
          recipientBalance: steth.balanceOf(recipient),
          shareRate: steth.getSharesByPooledEth(ether("1.0")),
        });

        const transferAmount = beforeTransfer.holderBalance;
        const transferAmountInShares = (transferAmount * beforeTransfer.shareRate) / ether("1.0");

        await expect(steth.connect(holder).transfer(recipient, transferAmount))
          .to.emit(steth, "Transfer")
          .withArgs(holder.address, recipient.address, transferAmount)
          .and.to.emit(steth, "TransferShares")
          .withArgs(holder.address, recipient.address, transferAmountInShares);
      });

      it("Reverts when the recipient is zero address", async function () {
        const transferAmount = await steth.balanceOf(holder);

        await expect(steth.connect(holder).transfer(ZeroAddress, transferAmount)).to.be.revertedWith(
          "TRANSFER_TO_ZERO_ADDR",
        );
      });
    });

    context("Allowance", function () {
      this.beforeEach(async function () {
        const allowance = await steth.balanceOf(holder);
        await steth.connect(holder).approve(spender, allowance);
        expect(await steth.allowance(holder, spender)).to.equal(allowance);
      });

      context("Function `increaseAllowance`", function () {
        it("Increases the spender's allowance by the amount and fires the `Approval` event", async function () {
          const allowance = await steth.allowance(holder, spender);
          const increaseAmount = ether("1.0");
          const updatedAllowance = allowance + increaseAmount;

          await expect(steth.connect(holder).increaseAllowance(spender, increaseAmount))
            .to.emit(steth, "Approval")
            .withArgs(holder.address, spender.address, updatedAllowance);

          expect(await steth.allowance(holder, spender)).to.equal(updatedAllowance);
        });
      });

      context("Function `decreaseAllowance`", function () {
        it("Decreases the spender's allowance by the amount and fires the `Approval` event", async function () {
          const allowance = await steth.allowance(holder, spender);
          const decreaseAmount = ether("1.0");
          const updatedAllowance = allowance - decreaseAmount;

          await expect(steth.connect(holder).decreaseAllowance(spender, decreaseAmount))
            .to.emit(steth, "Approval")
            .withArgs(holder.address, spender.address, updatedAllowance);

          expect(await steth.allowance(holder, spender)).to.equal(updatedAllowance);
        });
      });
    });
  });

  resetState(this);
});
