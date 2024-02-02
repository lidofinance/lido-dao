import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";
import { ONE_ETHER, batch, ether } from "lib";
import { describe } from "mocha";
import { StethMinimalMockWithTotalPooledEther, StethMinimalMockWithTotalPooledEther__factory } from "typechain-types";

describe("StETH:non-ERC-20 behavior", () => {
  let holder: HardhatEthersSigner;
  let recipient: HardhatEthersSigner;
  let spender: HardhatEthersSigner;

  const holderBalance = ether("10.0");
  const totalSupply = holderBalance;

  let steth: StethMinimalMockWithTotalPooledEther;

  beforeEach(async () => {
    const signers = await ethers.getSigners();
    [holder, recipient, spender] = signers;

    const factory = new StethMinimalMockWithTotalPooledEther__factory(holder);
    steth = await factory.deploy(holder, { value: holderBalance });
  });

  context("getTotalPooledEther", function () {
    it("Returns the amount of ether sent upon construction", async function () {
      expect(await steth.getTotalPooledEther()).to.equal(totalSupply);
    });

    for (const [rebase, factor] of [
      ["neutral", 100n], // 1
      ["positive", 105n], // 0.95
      ["negative", 95n], // 1.05
    ]) {
      it(`Returns the correct value after ${rebase} rebase`, async function () {
        const rebasedSupply = (totalSupply * (factor as bigint)) / 100n;
        await steth.setTotalPooledEther(rebasedSupply);

        expect(await steth.getTotalPooledEther()).to.equal(rebasedSupply);
      });
    }
  });

  context("transfer", function () {
    it("Transfers stETH to the recipient and fires the `Transfer` and `TransferShares` events", async function () {
      const beforeTransfer = await batch({
        holderBalance: steth.balanceOf(holder),
        recipientBalance: steth.balanceOf(recipient),
        shareRate: steth.getSharesByPooledEth(ONE_ETHER),
      });

      const transferAmount = beforeTransfer.holderBalance;
      const transferAmountInShares = (transferAmount * beforeTransfer.shareRate) / ONE_ETHER;

      await expect(steth.connect(holder).transfer(recipient, transferAmount))
        .to.emit(steth, "Transfer")
        .withArgs(holder.address, recipient.address, transferAmount)
        .and.to.emit(steth, "TransferShares")
        .withArgs(holder.address, recipient.address, transferAmountInShares);

      const afterTransfer = await batch({
        holderBalance: steth.balanceOf(holder),
        recipientBalance: steth.balanceOf(recipient),
      });

      expect(afterTransfer.holderBalance).to.equal(beforeTransfer.holderBalance - transferAmount);
      expect(afterTransfer.recipientBalance).to.equal(beforeTransfer.recipientBalance + transferAmount);
    });

    it("Reverts when the recipient is zero address", async function () {
      const transferAmount = await steth.balanceOf(holder);

      await expect(steth.connect(holder).transfer(ZeroAddress, transferAmount)).to.be.revertedWith(
        "TRANSFER_TO_ZERO_ADDR",
      );
    });

    it("Reverts when the recipient is stETH contract", async function () {
      const transferAmount = await steth.balanceOf(holder);

      await expect(steth.connect(holder).transfer(steth, transferAmount)).to.be.revertedWith(
        "TRANSFER_TO_STETH_CONTRACT",
      );
    });
  });

  context("increaseAllowance", function () {
    it("Increases the spender's allowance by the amount and fires the `Approval` event", async function () {
      const allowance = await steth.balanceOf(holder);
      await steth.connect(holder).approve(spender, allowance);
      expect(await steth.allowance(holder, spender)).to.equal(allowance);

      const increaseAmount = ether("1.0");
      const updatedAllowance = allowance + increaseAmount;

      await expect(steth.connect(holder).increaseAllowance(spender, increaseAmount))
        .to.emit(steth, "Approval")
        .withArgs(holder.address, spender.address, updatedAllowance);

      expect(await steth.allowance(holder, spender)).to.equal(updatedAllowance);
    });
  });

  context("decreaseAllowance", function () {
    it("Decreases the spender's allowance by the amount and fires the `Approval` event", async function () {
      const allowance = await steth.balanceOf(holder);
      await steth.connect(holder).approve(spender, allowance);
      expect(await steth.allowance(holder, spender)).to.equal(allowance);

      const decreaseAmount = ether("1.0");
      const updatedAllowance = allowance - decreaseAmount;

      await expect(steth.connect(holder).decreaseAllowance(spender, decreaseAmount))
        .to.emit(steth, "Approval")
        .withArgs(holder.address, spender.address, updatedAllowance);

      expect(await steth.allowance(holder, spender)).to.equal(updatedAllowance);
    });
  });
});
