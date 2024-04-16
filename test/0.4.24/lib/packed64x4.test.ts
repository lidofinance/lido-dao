import { expect } from "chai";
import { ethers } from "hardhat";

import { Packed64x4__Harness } from "typechain-types";

const OVER_UINT64_MAX = 2n ** 64n;

describe("Packed64x4.sol", () => {
  let packed: Packed64x4__Harness;

  before(async () => {
    packed = await ethers.deployContract("Packed64x4__Harness");
  });

  context("get", () => {
    it("Returns the value from position", async () => {
      const value = await packed.get(0);
      expect(value).to.equal(0);
    });

    it("Returns 0 when out of bounds", async () => {
      const value = await packed.get(4);
      expect(value).to.equal(0);
    });
  });

  context("set", () => {
    it("Reverts if number is more than 64 bits", async () => {
      await expect(packed.set(0, OVER_UINT64_MAX)).to.be.revertedWith("PACKED_OVERFLOW");
    });

    it("Updates value at different positions", async () => {
      await packed.set(0, 1n);
      await packed.set(1, 2n);
      await packed.set(2, 3n);
      await packed.set(3, 4n);

      expect(await packed.get(0)).to.equal(1n);
      expect(await packed.get(1)).to.equal(2n);
      expect(await packed.get(2)).to.equal(3n);
      expect(await packed.get(3)).to.equal(4n);
    });

    it("Preserves values when updating out of bounds", async () => {
      await packed.set(0, 1n);
      await packed.set(1, 2n);
      await packed.set(2, 3n);
      await packed.set(3, 4n);

      await packed.set(4, 5n);

      expect(await packed.get(0)).to.equal(1n);
      expect(await packed.get(1)).to.equal(2n);
      expect(await packed.get(2)).to.equal(3n);
      expect(await packed.get(3)).to.equal(4n);
    });
  });
});
