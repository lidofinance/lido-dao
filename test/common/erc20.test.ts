import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { parseUnits } from "ethers";
import { batch } from "lib";
import { ExclusiveSuiteFunction, PendingSuiteFunction, describe } from "mocha";
import { ERC20 } from "../../typechain-types/@openzeppelin/contracts/token/ERC20/ERC20";

interface ERC20Target {
  tokenName: string;
  deploy: () => Promise<{
    token: ERC20;
    name: string;
    symbol: string;
    decimals: bigint;
    totalSupply: bigint;
    holder: HardhatEthersSigner;
    spender: HardhatEthersSigner;
    recipient: HardhatEthersSigner;
  }>;
  suiteFunction?: ExclusiveSuiteFunction | PendingSuiteFunction;
}

/**
 * @function testERC20Compliance
 * @description This function provides a black-box test suite for verifying
 * the compliance of Ethereum contracts with the ERC-20 token standard.
 * It is designed to strictly adhere to the specifications prescribed in the ERC-20 standard.
 * The test suite covers all mandatory aspects of the standard, ensuringthat the contract
 * correctly implements essential functionalities such as totalSupply, balanceOf, transfer, and approve,
 * along with events like Transfer and Approval.
 *
 * Optional aspects of the ERC-20 standard, such as token name, symbol, and decimals, are also tested,
 * but these tests are not mandatory for compliance.
 * The suite does not make any assumptions beyond what is explicitly stated in the ERC-20 specification.
 * As a result, it does not include tests for scenarios like transfers to a zero address
 * or tests for increase/decrease allowance functions, which are not part of the core ERC-20 specification.
 *
 * The test descriptions in this suite closely mirror the function descriptions
 * provided in the ERC-20 standard documentation, with special focus on the MUST, SHOULD keywords.
 * This approach ensures that each test is relevant and accurately reflects the requirements of the standard,
 * aiding developers in assessing the compliance of their ERC-20 contracts effectively.
 *
 * @param {object} target.tokenName name of the token to use in the suite description
 * @param {object} target.deploy async function that returns the instance of the contract and initial parameters
 * @param {object} target.suiteFunction function that runs the suite, a temporary workaround for running
 * the suite exclusively or skipping the suite; see the todo below
 *
 * @todo rewrite the function to support the same interface as `describe`, i.e.
 * instead of passing `suiteFunction`, we should be able to call the function like:
 * testERC20Compliance.only(target)
 * testERC20Compliance.skip(target)
 */
export function testERC20Compliance({ tokenName, deploy, suiteFunction = describe }: ERC20Target) {
  suiteFunction(`${tokenName} ERC-20 Compliance`, function () {
    context("name", function () {
      it("[OPTIONAL] Returns the name of the token", async function () {
        const { token, name } = await loadFixture(deploy);

        if (typeof token.name !== "function") this.skip();

        expect(await token.name()).to.equal(name);
      });
    });

    context("symbol", function () {
      it("[OPTIONAL] Returns the symbol of the token", async function () {
        const { token, symbol } = await loadFixture(deploy);

        if (typeof token.symbol !== "function") this.skip();

        expect(await token.symbol()).to.equal(symbol);
      });
    });

    context("decimals", function () {
      it("[OPTIONAL] Returns the number of decimals the token uses", async function () {
        const { token, decimals } = await loadFixture(deploy);

        if (typeof token.decimals !== "function") this.skip();

        expect(await token.decimals()).to.equal(decimals);
      });
    });

    context("totalSupply", function () {
      it("Returns the total token supply", async function () {
        const { token, totalSupply } = await loadFixture(deploy);

        expect(await token.totalSupply()).to.equal(totalSupply);
      });
    });

    context("balanceOf", function () {
      it("Returns the account balance of another account", async function () {
        const { token, holder } = await loadFixture(deploy);

        expect(await token.balanceOf(holder)).to.be.greaterThan(0n);
      });
    });

    context("allowance", function () {
      it("Returns the amount which the spender is still allowed to withdraw from the holder", async function () {
        const { token, holder, spender } = await loadFixture(deploy);
        const allowance = parseUnits("1.0");

        await expect(token.approve(spender, allowance))
          .to.emit(token, "Approval")
          .withArgs(holder.address, spender.address, allowance);

        expect(await token.allowance(holder, spender)).to.equal(allowance);
      });
    });

    context("transfer", function () {
      it("Transfers an amount of tokens to the recipient, and MUST fire the `Transfer` event", async function () {
        const { token, holder, recipient } = await loadFixture(deploy);

        const before = await batch({
          holderBalance: token.balanceOf(holder),
          recipientBalance: token.balanceOf(recipient),
        });

        const transferAmount = before.holderBalance;

        await expect(token.transfer(recipient, transferAmount))
          .to.emit(token, "Transfer")
          .withArgs(holder.address, recipient.address, transferAmount);

        const after = await batch({
          holderBalance: token.balanceOf(holder),
          recipientBalance: token.balanceOf(recipient),
        });

        expect(after.holderBalance).to.equal(before.holderBalance - transferAmount);
        expect(after.recipientBalance).to.equal(before.recipientBalance + transferAmount);
      });

      it("MUST treat transfers of 0 values as normal transfers and fire the `Transfer` event.", async function () {
        const { token, holder, recipient } = await loadFixture(deploy);

        const before = await batch({
          holderBalance: token.balanceOf(holder),
          recipientBalance: token.balanceOf(recipient),
        });

        const transferAmount = 0n;

        await expect(token.transfer(recipient, transferAmount))
          .to.emit(token, "Transfer")
          .withArgs(holder.address, recipient.address, transferAmount);

        const after = await batch({
          holderBalance: token.balanceOf(holder),
          recipientBalance: token.balanceOf(recipient),
        });

        expect(after.holderBalance).to.equal(before.holderBalance - transferAmount);
        expect(after.recipientBalance).to.equal(before.recipientBalance + transferAmount);
      });

      it("SHOULD throw if the message caller’s account balance does not have enough tokens to spend", async function () {
        const { token, holder, recipient } = await loadFixture(deploy);

        const before = await batch({
          holderBalance: token.balanceOf(holder),
        });

        // exceeding the current balance only by 1 sometimes does not revert the transaction
        // due to the stETH 1-2 stWei error margin, which is why we exceed by 3
        const transferAmount = before.holderBalance + 3n;

        await expect(token.transfer(recipient, transferAmount)).to.be.reverted;
      });

      it("Returns `true` if the transfer succeeds", async function () {
        const { token, holder, recipient } = await loadFixture(deploy);

        const [success] = await token.connect(holder).transfer.staticCallResult(recipient, parseUnits("1.0"));
        expect(success).to.equal(true);
      });
    });

    async function setupAllowance() {
      const deployed = await loadFixture(deploy);
      const { token, holder, spender } = deployed;
      const approveAmount = await token.balanceOf(holder);

      const allowanceBefore = await token.allowance(holder, spender);

      await expect(token.approve(spender, approveAmount))
        .to.emit(token, "Approval")
        .withArgs(holder.address, spender.address, approveAmount);

      expect(await token.allowance(holder, spender)).to.equal(allowanceBefore + approveAmount);

      return deployed;
    }

    context("transferFrom", function () {
      it("Transfers an amount of tokens from to the recipient on behalf of the holder, and MUST fire the `Transfer` event", async function () {
        const { token, holder, spender, recipient } = await loadFixture(setupAllowance);

        const before = await batch({
          holderBalance: token.balanceOf(holder),
          spenderAllowance: token.allowance(holder, spender),
          recipientBalance: token.balanceOf(recipient),
        });

        const transferAmount = before.spenderAllowance;

        await expect(token.connect(spender).transferFrom(holder, recipient, transferAmount))
          .to.emit(token, "Transfer")
          .withArgs(holder.address, recipient.address, transferAmount);

        const after = await batch({
          holderBalance: token.balanceOf(holder),
          spenderAllowance: token.allowance(holder, spender),
          recipientBalance: token.balanceOf(recipient),
        });

        expect(after.holderBalance).to.equal(before.holderBalance - transferAmount);
        expect(after.recipientBalance).to.equal(before.recipientBalance + transferAmount);
        expect(after.spenderAllowance).to.equal(before.spenderAllowance - transferAmount);
      });

      it("MUST treat transfers of 0 values as normal transfers and fire the `Transfer` event.", async function () {
        const { token, holder, spender, recipient } = await loadFixture(setupAllowance);

        const before = await batch({
          holderBalance: token.balanceOf(holder),
          spenderAllowance: token.allowance(holder, spender),
          recipientBalance: token.balanceOf(recipient),
        });

        const transferAmount = before.spenderAllowance;

        await expect(token.connect(spender).transferFrom(holder, recipient, transferAmount))
          .to.emit(token, "Transfer")
          .withArgs(holder.address, recipient.address, transferAmount);

        const after = await batch({
          holderBalance: token.balanceOf(holder),
          spenderAllowance: token.allowance(holder, spender),
          recipientBalance: token.balanceOf(recipient),
        });

        expect(after.holderBalance).to.equal(before.holderBalance - transferAmount);
        expect(after.recipientBalance).to.equal(before.recipientBalance + transferAmount);
        expect(after.spenderAllowance).to.equal(before.spenderAllowance - transferAmount);
      });

      it("SHOULD throw if the message caller’s account balance does not have enough tokens to spend", async function () {
        const { token, holder, spender, recipient } = await loadFixture(setupAllowance);
        const transferAmount = await token.allowance(holder, spender);
        const insufficientTransferAmount = transferAmount + 1n;

        await expect(token.connect(spender).transferFrom(holder, recipient, insufficientTransferAmount)).to.be.reverted;
      });

      it("Returns `true` if the transfer succeeds", async function () {
        const { token, holder, spender, recipient } = await loadFixture(setupAllowance);

        const [success] = await token
          .connect(spender)
          .transferFrom.staticCallResult(holder, recipient, parseUnits("1.0"));
        expect(success).to.equal(true);
      });
    });

    context("approve", function () {
      for (const transferCount of [1n, 2n, 5n]) {
        it(`Allows the spender to transfer on behalf of the holder multiples times (${transferCount}), up to the approved amount`, async function () {
          const { token, holder, spender, recipient } = await loadFixture(setupAllowance);
          const approveAmount = await token.allowance(holder, spender);

          const transferAmount = approveAmount / transferCount;
          expect(transferAmount * transferCount).to.equal(approveAmount);

          for (let i = 0; i < transferCount; i++) {
            const before = await batch({
              holderBalance: token.balanceOf(holder),
              recipientBalance: token.balanceOf(recipient),
              spenderAllowance: token.allowance(holder, spender),
            });

            await expect(token.connect(spender).transferFrom(holder, recipient, transferAmount))
              .to.emit(token, "Transfer")
              .withArgs(holder.address, recipient.address, transferAmount);

            const after = await batch({
              holderBalance: token.balanceOf(holder),
              recipientBalance: token.balanceOf(recipient),
              spenderAllowance: token.allowance(holder, spender),
            });

            expect(after.holderBalance).equal(before.holderBalance - transferAmount);
            expect(after.recipientBalance).equal(before.recipientBalance + transferAmount);
            expect(after.spenderAllowance).equal(before.spenderAllowance - transferAmount);
          }
        });
      }

      for (const delta of [-1n, 1n]) {
        it(`Overwrites the current allowance to a ${delta < 0 ? "smaller" : "greater"} amount`, async function () {
          const { token, holder, spender } = await loadFixture(setupAllowance);
          const approveAmount = await token.allowance(holder, spender);
          const updatedAllowance = approveAmount + delta;

          await expect(token.connect(holder).approve(spender, updatedAllowance))
            .to.emit(token, "Approval")
            .withArgs(holder.address, spender.address, updatedAllowance);

          expect(await token.allowance(holder, spender)).to.equal(updatedAllowance);
        });
      }

      it("Returns `true` if the approve succeeds", async function () {
        const { token, holder, spender } = await loadFixture(setupAllowance);
        const approveAmount = await token.allowance(holder, spender);

        const [success] = await token.connect(holder).approve.staticCallResult(spender, approveAmount + 1n);

        expect(success).to.equal(true);
      });
    });
  });
}
