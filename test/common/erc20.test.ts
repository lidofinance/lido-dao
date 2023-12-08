import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Snapshot, batch } from "../../lib";
import { ethers } from "hardhat";
import { assert, expect } from "chai";
import { ERC20 } from "../../typechain-types/@openzeppelin/contracts/token/ERC20/ERC20";
import { parseUnits } from "ethers";
import { describe } from "mocha";

interface ERC20Target {
  tokenName: string;
  deploy: () => Promise<{
    token: ERC20;
    name: string;
    symbol: string;
    decimals: bigint;
    totalSupply: bigint;
    holder: HardhatEthersSigner;
  }>;
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
 * @param {object} target.deploy an async function that returns the instance of the contract and initial parameters
 */
export function testERC20Compliance({ tokenName, deploy }: ERC20Target) {
  describe(`${tokenName} ERC-20 Compliance`, function () {
    let token: ERC20;
    let name: string;
    let symbol: string;
    let decimals: bigint;
    let totalSupply: bigint;
    let holder: HardhatEthersSigner;

    let originalState: string;

    this.beforeAll(async function () {
      originalState = await Snapshot.take();
    });

    this.afterAll(async function () {
      await Snapshot.restore(originalState);
    });

    this.beforeEach(async function () {
      ({ token, name, symbol, decimals, totalSupply, holder } = await deploy());
    });

    context("Read functions", function () {
      it("[OPTIONAL] Function `name` returns the name of the token", async function () {
        if (typeof token.name !== "function") this.skip();

        expect(await token.name()).to.equal(name);
      });

      it("[OPTIONAL] Function `symbol` returns the symbol of the token", async function () {
        if (typeof token.symbol !== "function") this.skip();

        expect(await token.symbol()).to.equal(symbol);
      });

      it("[OPTIONAL] Function `decimals` returns the number of decimals the token uses", async function () {
        if (typeof token.decimals !== "function") this.skip();

        expect(await token.decimals()).to.equal(decimals);
      });

      it("Function `totalSupply` returns the total token supply", async function () {
        expect(await token.totalSupply()).to.equal(totalSupply);
      });

      it("Function `balanceOf` returns the account balance of another account", async function () {
        expect(await token.balanceOf(holder)).to.be.greaterThan(0n);
      });

      it("Function `allowance` the amount which the spender is still allowed to withdraw from the holder", async function () {
        const [spender] = await ethers.getSigners();
        const allowance = parseUnits("1.0");

        await expect(token.connect(holder).approve(spender, allowance))
          .to.emit(token, "Approval")
          .withArgs(holder.address, spender.address, allowance);

        expect(await token.allowance(holder, spender)).to.equal(allowance);
      });
    });

    context("Write functions", function () {
      context("Function `transfer`", function () {
        let recipient: HardhatEthersSigner;
        let transferAmount: bigint;

        let originalState: string;

        this.beforeAll(async function () {
          originalState = await Snapshot.take();
        });

        this.afterAll(async function () {
          await Snapshot.restore(originalState);
        });

        this.beforeEach(async function () {
          [recipient] = await ethers.getSigners();
          transferAmount = await token.balanceOf(holder);
        });

        it("Transfers an amount of tokens to the recipient, and MUST fire the `Transfer` event", async function () {
          const before = await batch({
            holderBalance: token.balanceOf(holder),
            recipientBalance: token.balanceOf(recipient),
          });

          await expect(token.connect(holder).transfer(recipient, transferAmount))
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
          const [recipient] = await ethers.getSigners();

          const before = await batch({
            holderBalance: token.balanceOf(holder),
            recipientBalance: token.balanceOf(recipient),
          });

          const transferAmount = 0n;

          await expect(token.connect(holder).transfer(recipient, transferAmount))
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
          const [recipient] = await ethers.getSigners();

          const before = await batch({
            holderBalance: token.balanceOf(holder),
          });

          const transferAmount = before.holderBalance + 1n;

          await expect(token.connect(holder).transfer(recipient, transferAmount)).to.be.reverted;
        });

        it("Returns `true` if the transfer succeeds", async function () {
          const [recipient] = await ethers.getSigners();

          const success = await token.connect(holder).transfer.staticCallResult(recipient, parseUnits("1.0"));
          assert(success);
        });
      });

      context("Function `transferFrom`", function () {
        let spender: HardhatEthersSigner, recipient: HardhatEthersSigner;
        let transferAmount: bigint;

        let originalState: string;

        this.beforeAll(async function () {
          originalState = await Snapshot.take();
        });

        this.afterAll(async function () {
          await Snapshot.restore(originalState);
        });

        this.beforeEach(async function () {
          [spender, recipient] = await ethers.getSigners();
          transferAmount = await token.balanceOf(holder);

          const allowanceBefore = await token.allowance(holder, spender);

          await expect(token.connect(holder).approve(spender, transferAmount))
            .to.emit(token, "Approval")
            .withArgs(holder.address, spender.address, transferAmount);

          expect(await token.allowance(holder, spender)).to.equal(allowanceBefore + transferAmount);
        });

        it("Transfers an amount of tokens from to the recipient on behalf of the holder, and MUST fire the `Transfer` event", async function () {
          const before = await batch({
            holderBalance: token.balanceOf(holder),
            spenderAllowance: token.allowance(holder, spender),
            recipientBalance: token.balanceOf(recipient),
          });

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
          const before = await batch({
            holderBalance: token.balanceOf(holder),
            spenderAllowance: token.allowance(holder, spender),
            recipientBalance: token.balanceOf(recipient),
          });

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
          const insufficientTransferAmount = transferAmount + 1n;

          await expect(token.connect(spender).transferFrom(holder, recipient, insufficientTransferAmount)).to.be
            .reverted;
        });

        it("Returns `true` if the transfer succeeds", async function () {
          const [recipient] = await ethers.getSigners();

          const success = await token
            .connect(spender)
            .transferFrom.staticCallResult(holder, recipient, parseUnits("1.0"));
          assert(success);
        });
      });

      context("Function `approve`", function () {
        let spender: HardhatEthersSigner, recipient: HardhatEthersSigner;
        let approveAmount: bigint;

        let originalState: string;

        this.beforeAll(async function () {
          originalState = await Snapshot.take();
        });

        this.afterAll(async function () {
          await Snapshot.restore(originalState);
        });

        this.beforeEach(async function () {
          [spender, recipient] = await ethers.getSigners();
          approveAmount = await token.balanceOf(holder);

          const allowanceBefore = await token.allowance(holder, spender);

          await expect(token.connect(holder).approve(spender, approveAmount))
            .to.emit(token, "Approval")
            .withArgs(holder.address, spender.address, approveAmount);

          expect(await token.allowance(holder, spender)).to.equal(allowanceBefore + approveAmount);
        });

        for (const transferCount of [1n, 2n, 5n]) {
          it(`Allows the spender to transfer on behalf of the holder multiples times (${transferCount}), up to the approved amount`, async function () {
            const transferAmount = approveAmount / transferCount;
            assert(transferAmount * transferCount === approveAmount);

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
            const updatedAllowance = approveAmount + delta;

            await expect(token.connect(holder).approve(spender, updatedAllowance))
              .to.emit(token, "Approval")
              .withArgs(holder.address, spender.address, updatedAllowance);

            expect(await token.allowance(holder, spender)).to.equal(updatedAllowance);
          });
        }

        it("Returns `true` if the approve succeeds", async function () {
          const success = await token.connect(holder).approve.staticCallResult(spender, approveAmount + 1n);

          assert(success);
        });
      });
    });
  });
}
