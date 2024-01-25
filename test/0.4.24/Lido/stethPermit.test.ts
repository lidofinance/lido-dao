import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { Wallet } from "ethers";
import { ethers } from "hardhat";
import { days, ether, signStethPermit, signStethPermitEIP1271 } from "lib";
import { describe } from "mocha";
import { EIP712StETH__factory, StethPermitInheritor__factory } from "typechain-types/*";
import { PermitSigner__factory } from "typechain-types/factories/test/0.4.24/Lido/PermitSigner.sol";

describe.only("StethPermit", () => {
  async function deploy() {
    const [deployer] = await ethers.getSigners();

    const steth = await new StethPermitInheritor__factory(deployer).deploy(deployer, { value: ether("100.0") });
    const helper = await new EIP712StETH__factory(deployer).deploy(steth);
    await steth.initializeEIP712StETH(helper);
    const stethAddress = await steth.getAddress();

    return {
      deployer,
      steth,
      stethAddress,
      helper,
    };
  }

  async function eoaPermit() {
    const deployed = await loadFixture(deploy);
    const { steth } = deployed;

    const permit = {
      type: "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)",
      owner: Wallet.createRandom(),
      spender: Wallet.createRandom(),
      value: ether("1.0"),
      deadline: BigInt(await time.latest()) + days(7n),
    };

    const signature = signStethPermit({
      ...permit,
      steth: await steth.getAddress(),
      nonce: await steth.nonces(permit.owner),
    });

    return {
      ...deployed,
      permit,
      signature,
    };
  }

  async function contractPermit() {
    const deployed = await loadFixture(deploy);
    const { deployer, steth } = deployed;

    const owner = await new PermitSigner__factory(deployer).deploy();
    const spender = await new PermitSigner__factory(deployer).deploy();

    const permit = {
      type: "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)",
      owner,
      spender,
      value: ether("1.0"),
      deadline: BigInt(await time.latest()) + days(7n),
    };

    const signature = await signStethPermitEIP1271({
      ...permit,
      steth: await steth.getAddress(),
      nonce: await steth.nonces(permit.owner),
    });

    return {
      ...deployed,
      permit,
      signature,
    };
  }

  context("DOMAIN_SEPARATOR", () => {
    it("Returns the correct domain separator", async () => {
      const { steth, helper } = await loadFixture(deploy);

      expect(await steth.DOMAIN_SEPARATOR()).to.equal(await helper.domainSeparatorV4(await steth.getAddress()));
    });
  });

  context("permit", () => {
    it("Reverts if the deadline is expired [EOA]", async () => {
      const {
        steth,
        permit: { owner, spender, value },
        signature: { v, r, s },
      } = await loadFixture(eoaPermit);

      const expiredDeadline = await time.latest();

      await expect(steth.permit(owner, spender, value, expiredDeadline, v, r, s)).to.be.revertedWith(
        "DEADLINE_EXPIRED",
      );
    });

    it("Reverts if the deadline is expired [EIP-1271]", async () => {
      const {
        steth,
        permit: { owner, spender, value },
        signature: { v, r, s },
      } = await loadFixture(contractPermit);

      const expiredDeadline = await time.latest();

      await expect(steth.permit(owner, spender, value, expiredDeadline, v, r, s)).to.be.revertedWith(
        "DEADLINE_EXPIRED",
      );
    });

    it("Sets the spender allowance and increments the owner nonce [EOA]", async () => {
      const {
        steth,
        permit: { owner, spender, value, deadline },
        signature: { v, r, s },
      } = await loadFixture(eoaPermit);

      await expect(steth.permit(owner, spender, value, deadline, v, r, s))
        .to.emit(steth, "Approval")
        .withArgs(owner.address, spender.address, value);

      expect(await steth.nonces(owner)).to.equal(1n);
      expect(await steth.allowance(owner, spender)).to.equal(value);
    });

    it("Sets the spender allowance and increments the owner nonce [EIP-1271]", async () => {
      const {
        steth,
        permit: { owner, spender, value, deadline },
        signature: { v, r, s },
      } = await loadFixture(contractPermit);

      await expect(steth.permit(owner, spender, value, deadline, v, r, s))
        .to.emit(steth, "Approval")
        .withArgs(await owner.getAddress(), await spender.getAddress(), value);

      expect(await steth.nonces(owner)).to.equal(1n);
      expect(await steth.allowance(owner, spender)).to.equal(value);
    });
  });
});
