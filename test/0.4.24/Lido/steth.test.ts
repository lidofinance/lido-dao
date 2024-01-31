import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";
import { ONE_ETHER, batch, ether, resetState } from "lib";
import { describe } from "mocha";
import { StethMinimalMockWithTotalPooledEther__factory } from "typechain-types/factories/test/0.4.24/Lido/contracts/StethMinimalMockWithTotalPooledEther__factory";

describe("StETH:non-ERC-20 behavior", function () {
  async function deploySteth() {
    const signers = await ethers.getSigners();
    const [holder, recipient, spender] = signers;
    const holderBalance = ether("10.0");
    const totalSupply = holderBalance;

    const factory = new StethMinimalMockWithTotalPooledEther__factory(holder);
    const steth = await factory.deploy(holder, { value: holderBalance });

    expect(await steth.balanceOf(holder)).to.equal(holderBalance);
    expect(await steth.totalSupply()).to.equal(totalSupply);

    return {
      holder,
      holderBalance,
      recipient,
      spender,
      totalSupply,
      steth,
    };
  }

  async function deployApprovedSteth() {
    const deployed = await loadFixture(deploySteth);
    const { steth, holder, spender } = deployed;

    const allowance = await steth.balanceOf(holder);
    await steth.connect(holder).approve(spender, allowance);
    expect(await steth.allowance(holder, spender)).to.equal(allowance);

    return deployed;
  }

  context("getTotalPooledEther", function () {
    it("Returns the amount of ether sent upon construction", async function () {
      const { steth, totalSupply } = await loadFixture(deploySteth);

      expect(await steth.getTotalPooledEther()).to.equal(totalSupply);
    });

    for (const [rebase, factor] of [
      ["neutral", 100n], // 1
      ["positive", 105n], // 0.95
      ["negative", 95n], // 1.05
    ]) {
      it(`Returns the correct value after ${rebase} rebase`, async function () {
        const { steth, totalSupply } = await loadFixture(deploySteth);

        const rebasedSupply = (totalSupply * (factor as bigint)) / 100n;
        await steth.setTotalPooledEther(rebasedSupply);

        expect(await steth.getTotalPooledEther()).to.equal(rebasedSupply);
      });
    }
  });

  context("transfer", function () {
    it("Transfers stETH to the recipient and fires the `Transfer` and `TransferShares` events", async function () {
      const { steth, holder, recipient } = await loadFixture(deploySteth);

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
      const { steth, holder } = await loadFixture(deploySteth);

      const transferAmount = await steth.balanceOf(holder);

      await expect(steth.connect(holder).transfer(ZeroAddress, transferAmount)).to.be.revertedWith(
        "TRANSFER_TO_ZERO_ADDR",
      );
    });

    it("Reverts when the recipient is stETH contract", async function () {
      const { steth, holder } = await loadFixture(deploySteth);

      const transferAmount = await steth.balanceOf(holder);

      await expect(steth.connect(holder).transfer(steth, transferAmount)).to.be.revertedWith(
        "TRANSFER_TO_STETH_CONTRACT",
      );
    });
  });

  context("increaseAllowance", function () {
    it("Increases the spender's allowance by the amount and fires the `Approval` event", async function () {
      const { steth, holder, spender } = await loadFixture(deployApprovedSteth);

      const allowance = await steth.allowance(holder, spender);
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
      const { steth, holder, spender } = await loadFixture(deployApprovedSteth);

      const allowance = await steth.allowance(holder, spender);
      const decreaseAmount = ether("1.0");
      const updatedAllowance = allowance - decreaseAmount;

      await expect(steth.connect(holder).decreaseAllowance(spender, decreaseAmount))
        .to.emit(steth, "Approval")
        .withArgs(holder.address, spender.address, updatedAllowance);

      expect(await steth.allowance(holder, spender)).to.equal(updatedAllowance);
    });
  });

  resetState(this);
});
