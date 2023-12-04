import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ZeroAddress, formatUnits, parseUnits } from "ethers";
import { describe } from "mocha";
import { INITIAL_STETH_HOLDER, Snapshot, batch } from "../../lib";
import { ethers } from "hardhat";
import { StETHMock } from "../../typechain-types";
import { expect } from "chai";

describe("stETH shares", function () {
  const initialTotalSupply = parseUnits("1.0", "ether");

  let steth: StETHMock;
  let users: HardhatEthersSigner[];
  let initialSuiteState: string;

  this.beforeAll(async function () {
    initialSuiteState = await Snapshot.take();

    steth = await ethers.deployContract("StETHMock", { value: initialTotalSupply });
    console.log("steth balance", formatUnits(await ethers.provider.getBalance(steth), "ether"));
    console.log("steth shares", formatUnits(await steth.getTotalShares(), "ether"));
    users = await ethers.getSigners();
  });

  it("Returns the correct number of shares of the initial holder.", async function () {
    expect(await steth.sharesOf(INITIAL_STETH_HOLDER)).to.equal(await steth.getSharesByPooledEth(initialTotalSupply));
  });

  describe("getTotalShares()", function () {
    let user: HardhatEthersSigner;

    let initialState: string;
    let setupState: string;

    this.beforeAll(async function () {
      initialState = await Snapshot.take();

      [user] = users;
    });

    this.beforeEach(async function () {
      setupState = await Snapshot.refresh(setupState);
    });

    it("Returns the correct initial number of total shares.", async function () {
      expect(await steth.getTotalShares()).to.equal(await steth.getSharesByPooledEth(initialTotalSupply));
    });

    it("Returns the correct number of total shares after minting stETH.", async function () {
      const amount = parseUnits("100.0", "ether");
      const amountInShares = await steth.getSharesByPooledEth(amount);

      await expect(steth.mintSteth(user, { value: amount }))
        .to.emit(steth, "TransferShares")
        .withArgs(ZeroAddress, user.address, amountInShares);

      expect(await steth.balanceOf(user)).to.equal(amount);
      expect(await steth.sharesOf(user)).to.equal(amountInShares);

      expect(await steth.getTotalShares()).to.equal(
        (await steth.getSharesByPooledEth(initialTotalSupply)) + amountInShares,
      );
    });

    it("Minting shares without a rebase decreases balances.", async function () {
      const amountOfShares = parseUnits("1.0", "ether");

      const before = await batch({
        holderBalance: steth.balanceOf(INITIAL_STETH_HOLDER),
        holderShares: steth.sharesOf(INITIAL_STETH_HOLDER),
        userBalance: steth.balanceOf(user),
        userShares: steth.sharesOf(user),
        totalShares: steth.getTotalShares(),
        totalPooledEther: steth.getTotalPooledEther(),
      });

      await expect(steth.mintShares(user, amountOfShares))
        .to.emit(steth, "TransferShares")
        .withArgs(ZeroAddress, user.address, amountOfShares);

      const after = await batch({
        holderBalance: steth.balanceOf(INITIAL_STETH_HOLDER),
        holderShares: steth.sharesOf(INITIAL_STETH_HOLDER),
        userBalance: steth.balanceOf(user),
        userShares: steth.sharesOf(user),
        totalShares: steth.getTotalShares(),
        totalPooledEther: steth.getTotalPooledEther(),
      });

      expect(after.userShares).to.equal(amountOfShares);
      expect(after.userBalance).to.equal(await steth.getPooledEthByShares(amountOfShares));
      expect(after.holderShares).to.equal(before.holderShares);
      expect(after.holderBalance).to.equal(await steth.getPooledEthByShares(after.holderShares));
    });

    this.afterAll(async function () {
      await Snapshot.restore(initialState);
    });
  });

  this.afterAll(async function () {
    await Snapshot.restore(initialSuiteState);
  });
});
