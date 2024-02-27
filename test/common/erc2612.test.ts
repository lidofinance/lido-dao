import { expect } from "chai";
import { Signature, Signer, TypedDataDomain, TypedDataEncoder } from "ethers";
import { ExclusiveSuiteFunction, PendingSuiteFunction } from "mocha";

import { time } from "@nomicfoundation/hardhat-network-helpers";

import { IERC20, IERC2612 } from "typechain-types";

import { certainAddress, days, Snapshot } from "lib";

interface ERC2612Target {
  tokenName: string;
  deploy: () => Promise<{
    token: IERC20 & IERC2612;
    domain: TypedDataDomain;
    owner: Signer;
  }>;
  suiteFunction?: ExclusiveSuiteFunction | PendingSuiteFunction;
}

interface Permit {
  owner: string;
  spender: string;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
}

export function testERC2612Compliance({ tokenName, deploy, suiteFunction = describe }: ERC2612Target) {
  suiteFunction(`${tokenName} ERC-2612 Compliance`, () => {
    let token: IERC20 & IERC2612;
    let domain: TypedDataDomain;
    let owner: Signer;

    let permit: Permit;
    let signature: string;

    let originalState: string;

    before(async () => {
      ({ token, domain, owner } = await deploy());

      const holderBalance = await token.balanceOf(owner);

      permit = {
        owner: await owner.getAddress(),
        spender: certainAddress("spender"),
        value: holderBalance,
        nonce: await token.nonces(owner),
        deadline: BigInt(await time.latest()) + days(7n),
      };

      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      signature = await owner.signTypedData(domain, types, permit);
    });

    beforeEach(async () => (originalState = await Snapshot.take()));

    afterEach(async () => await Snapshot.restore(originalState));

    context("permit", () => {
      it("permit sets the allowance and increases nonce", async () => {
        const { owner, spender, value, nonce, deadline } = permit;
        const { v, r, s } = Signature.from(signature);

        await expect(token.permit(owner, spender, value, deadline, v, r, s))
          .to.emit(token, "Approval")
          .withArgs(owner, spender, value);

        expect(await token.allowance(owner, spender)).to.equal(value);
        expect(await token.nonces(owner)).to.equal(nonce + 1n);
      });
    });

    context("DOMAIN_SEPARATOR", () => {
      it("Matches the expected value", async () => {
        const expected = TypedDataEncoder.hashDomain(domain);

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
