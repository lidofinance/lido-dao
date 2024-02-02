import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ECDSASignature } from "ethereumjs-util";
import { HDNodeWallet, Wallet, ZeroAddress } from "ethers";
import { ethers } from "hardhat";
import { certainAddress, days, ether, randomAddress, signStethPermit, signStethPermitEIP1271 } from "lib";
import { describe } from "mocha";
import {
  EIP712StETH,
  EIP712StETH__factory,
  OwnerWithEip712PermitSignature__factory,
  StethPermitMockWithEip712Initialization__factory,
  OwnerWithEip712PermitSignature,
  StethPermitMockWithEip712Initialization,
} from "typechain-types";

describe("Permit", () => {
  let deployer: HardhatEthersSigner;

  let steth: StethPermitMockWithEip712Initialization;

  const value = ether("1.0");

  beforeEach(async () => {
    [deployer] = await ethers.getSigners();

    const factory = new StethPermitMockWithEip712Initialization__factory(deployer);
    steth = await factory.deploy(deployer, { value });
  });

  context("initialize", () => {
    it("Reverts if the EIP-712 helper contract is zero address", async () => {
      await expect(steth.initializeEIP712StETH(ZeroAddress)).to.be.revertedWith("ZERO_EIP712STETH");
    });

    it("Reverts if the EIP-712 helper contract is already set", async () => {
      const eip712helper = certainAddress("eip712helper");
      await expect(steth.initializeEIP712StETH(eip712helper))
        .to.be.emit(steth, "EIP712StETHInitialized")
        .withArgs(eip712helper);
      expect(await steth.getEIP712StETH()).to.equal(eip712helper);

      await expect(steth.initializeEIP712StETH(eip712helper)).to.be.revertedWith("EIP712STETH_ALREADY_SET");
    });

    it("Initializes the EIP-712 Steth helper and emits the 'EIP712StETHInitialized' event", async () => {
      const eip712helper = certainAddress("eip712helper");

      await expect(steth.initializeEIP712StETH(eip712helper))
        .to.be.emit(steth, "EIP712StETHInitialized")
        .withArgs(eip712helper);
      expect(await steth.getEIP712StETH()).to.equal(eip712helper);
    });
  });

  context("permit", () => {
    let permit: EoaPermit;
    let signature: ECDSASignature;

    beforeEach(async () => {
      const owner = Wallet.createRandom();

      permit = {
        type: "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)",
        owner,
        spender: randomAddress(),
        nonce: await steth.nonces(owner),
        value,
        deadline: BigInt(await time.latest()) + days(7n),
        steth: await steth.getAddress(),
      };

      signature = signStethPermit(permit);
    });

    context("uninitialized", () => {
      it("Reverts", async () => {
        const { owner, spender, deadline } = permit;
        const { v, r, s } = signature;

        await expect(steth.permit(owner.address, spender, value, deadline, v, r, s)).to.be.reverted;
      });
    });

    context("initialized", () => {
      let eip712helper: EIP712StETH;

      beforeEach(async () => {
        const factory = new EIP712StETH__factory(deployer);
        eip712helper = await factory.deploy(steth);

        await expect(steth.initializeEIP712StETH(eip712helper))
          .to.be.emit(steth, "EIP712StETHInitialized")
          .withArgs(await eip712helper.getAddress());
        expect(await steth.getEIP712StETH()).to.equal(await eip712helper.getAddress());
      });

      it("Reverts if the deadline is expired", async () => {
        const expiredDeadline = await time.latest();
        const { owner, spender } = permit;
        const { v, r, s } = signature;

        await expect(steth.permit(owner.address, spender, value, expiredDeadline, v, r, s)).to.be.revertedWith(
          "DEADLINE_EXPIRED",
        );
      });

      it("Reverts if the signature does not match", async () => {
        const { owner, spender, deadline } = permit;
        const { v, r, s } = signature;
        // corrupting the signature
        s[0] = (s[0] + 1) % 255;

        await expect(steth.permit(owner.address, spender, value, deadline, v, r, s)).to.be.revertedWith(
          "INVALID_SIGNATURE",
        );
      });

      it("Sets spender allowance", async () => {
        const { owner, spender, deadline } = permit;
        const { v, r, s } = signature;

        await expect(steth.permit(owner.address, spender, value, deadline, v, r, s))
          .to.emit(steth, "Approval")
          .withArgs(owner.address, spender, value);
        expect(await steth.allowance(owner, spender)).to.equal(value);
      });

      context("As contract owner", () => {
        let permit: ContractPermit;
        let signature: ECDSASignature;

        beforeEach(async () => {
          const owner = await new OwnerWithEip712PermitSignature__factory(deployer).deploy();

          permit = {
            type: "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)",
            owner,
            spender: randomAddress(),
            nonce: await steth.nonces(owner),
            value,
            deadline: BigInt(await time.latest()) + days(7n),
            steth: await steth.getAddress(),
          };

          signature = await signStethPermitEIP1271(permit);
        });

        it("Sets spender allowance", async () => {
          const { owner, spender, deadline } = permit;
          const { v, r, s } = signature;

          await expect(steth.permit(owner, spender, value, deadline, v, r, s))
            .to.emit(steth, "Approval")
            .withArgs(await owner.getAddress(), spender, value);
          expect(await steth.allowance(owner, spender)).to.equal(value);
        });
      });
    });
  });
});

interface Permit {
  type: string;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
  spender: string;
  steth: string;
}

interface EoaPermit extends Permit {
  owner: HDNodeWallet;
}

interface ContractPermit extends Permit {
  owner: OwnerWithEip712PermitSignature;
}
