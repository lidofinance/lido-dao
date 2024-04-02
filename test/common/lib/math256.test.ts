import { expect } from "chai";
import { ethers } from "hardhat";

import { Math256__Harness } from "typechain-types";

describe("Math256.sol", () => {
  let math256: Math256__Harness;

  before(async () => {
    math256 = await ethers.deployContract("Math256__Harness");
  });

  context("max(uint256,uint256)", () => {
    it("Returns the maximum of two numbers", async () => {
      expect(await math256["max(uint256,uint256)"](1, 2)).to.equal(2);
      expect(await math256["max(uint256,uint256)"](2, 1)).to.equal(2);
    });

    it("Returns the maximum for equal numbers", async () => {
      expect(await math256["max(uint256,uint256)"](1, 1)).to.equal(1);
    });
  });

  context("max(int256,int256)", () => {
    it("Returns the maximum of two numbers", async () => {
      expect(await math256["max(int256,int256)"](1, 2)).to.equal(2);
      expect(await math256["max(int256,int256)"](2, 1)).to.equal(2);
    });

    it("Returns the maximum for equal numbers", async () => {
      expect(await math256["max(int256,int256)"](1, 1)).to.equal(1);
    });

    it("Returns the maximum for negative numbers", async () => {
      expect(await math256["max(int256,int256)"](-1, -2)).to.equal(-1);
      expect(await math256["max(int256,int256)"](-2, -1)).to.equal(-1);
    });
  });

  context("min(uint256,uint256)", () => {
    it("Returns the minimum of two numbers", async () => {
      expect(await math256["min(uint256,uint256)"](1, 2)).to.equal(1);
      expect(await math256["min(uint256,uint256)"](2, 1)).to.equal(1);
    });

    it("Returns the minimum for equal numbers", async () => {
      expect(await math256["min(uint256,uint256)"](1, 1)).to.equal(1);
    });
  });

  context("min(int256,int256)", () => {
    it("Returns the minimum of two numbers", async () => {
      expect(await math256["min(int256,int256)"](1, 2)).to.equal(1);
      expect(await math256["min(int256,int256)"](2, 1)).to.equal(1);
    });

    it("Returns the minimum for equal numbers", async () => {
      expect(await math256["min(int256,int256)"](1, 1)).to.equal(1);
    });

    it("Returns the minimum for negative numbers", async () => {
      expect(await math256["min(int256,int256)"](-1, -2)).to.equal(-2);
      expect(await math256["min(int256,int256)"](-2, -1)).to.equal(-2);
    });
  });

  context("ceilDiv", () => {
    it("Returns the ceiling division for zero", async () => {
      expect(await math256.ceilDiv(0, 1)).to.equal(0);
      expect(await math256.ceilDiv(0, 2)).to.equal(0);
    });

    it("Returns the ceiling division for one", async () => {
      expect(await math256.ceilDiv(1, 1)).to.equal(1);
      expect(await math256.ceilDiv(2, 1)).to.equal(2);
    });

    it("Returns the ceiling division for two", async () => {
      expect(await math256.ceilDiv(2, 2)).to.equal(1);
      expect(await math256.ceilDiv(4, 2)).to.equal(2);
    });

    it("Returns the ceiling division for three", async () => {
      expect(await math256.ceilDiv(3, 3)).to.equal(1);
      expect(await math256.ceilDiv(4, 3)).to.equal(2);
    });
  });

  context("absDiff", () => {
    it("Returns the absolute difference for zero", async () => {
      expect(await math256.absDiff(0, 0)).to.equal(0);
      expect(await math256.absDiff(0, 1)).to.equal(1);
    });

    it("Returns the absolute difference for one", async () => {
      expect(await math256.absDiff(1, 1)).to.equal(0);
      expect(await math256.absDiff(1, 2)).to.equal(1);
    });

    it("Returns the absolute difference for two", async () => {
      expect(await math256.absDiff(2, 2)).to.equal(0);
      expect(await math256.absDiff(2, 3)).to.equal(1);
      expect(await math256.absDiff(3, 2)).to.equal(1);
    });
  });
});
