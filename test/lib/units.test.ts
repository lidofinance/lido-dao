import { expect } from "chai";

import { shareRate, shares } from "lib/units";

describe("shares", () => {
  it("should correctly parse shares values", () => {
    const result = shares(0n);
    expect(result.toString()).to.equal("0");
  });

  it("should correctly parse shares values", () => {
    const result = shares(1n);
    expect(result.toString()).to.equal("1000000000000000000");
  });
});

describe("shareRate", () => {
  it("should correctly parse shareRate values", () => {
    const result = shareRate(0n);
    expect(result.toString()).to.equal("0");
  });

  it("should correctly parse shareRate values", () => {
    const result = shareRate(1n);
    expect(result.toString()).to.equal("1000000000000000000000000000");
  });
});
