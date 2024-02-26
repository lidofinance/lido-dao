import { expect } from "chai";
import { TypedDataEncoder } from "ethers";
import { network } from "hardhat";
import { ExclusiveSuiteFunction, PendingSuiteFunction } from "mocha";

import { IERC20, IERC2612 } from "typechain-types";

import { Snapshot } from "lib";

interface ERC2612Target {
  tokenName: string;
  deploy: () => Promise<{
    token: IERC20 & IERC2612;
    name: string;
    version: string;
  }>;
  suiteFunction?: ExclusiveSuiteFunction | PendingSuiteFunction;
}

export function testERC2612Compliance({ tokenName, deploy, suiteFunction = describe }: ERC2612Target) {
  suiteFunction(`${tokenName} ERC-2612 Compliance`, () => {
    let token: IERC20 & IERC2612;
    let name: string;
    let version: string;

    let originalState: string;

    before(async () => {
      ({ token, name, version } = await deploy());
    });

    beforeEach(async () => (originalState = await Snapshot.take()));

    afterEach(async () => await Snapshot.restore(originalState));

    context("DOMAIN_SEPARATOR", () => {
      it("Matches the expected value", async () => {
        const expected = TypedDataEncoder.hashDomain({
          name,
          version,
          chainId: network.config.chainId!,
          verifyingContract: await token.getAddress(),
        });

        expect(await token.DOMAIN_SEPARATOR()).to.equal(expected);
      });
    });
  });
}

testERC2612Compliance.only = (target: ERC2612Target) =>
  testERC2612Compliance({
    ...target,
    suiteFunction: describe.only, // eslint-disable-line no-only-tests/no-only-tests
  });

testERC2612Compliance.skip = (target: ERC2612Target) =>
  testERC2612Compliance({
    ...target,
    suiteFunction: describe.skip,
  });
