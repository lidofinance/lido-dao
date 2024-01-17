import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers, network } from "hardhat";
import { describe } from "mocha";
import { deriveDomainSeparator, deriveTypeDataHash, randomAddress, streccak } from "lib";
import { EIP712StETH } from "typechain-types";

describe("EIP712StETH.sol", function () {
  const domain = {
    type: "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
    name: "Liquid staked Ether 2.0",
    version: "2",
    chainId: network.config.chainId!,
    verifyingContract: randomAddress(),
  };

  let eip712steth: EIP712StETH;

  this.beforeAll(async function () {
    eip712steth = await ethers.deployContract("EIP712StETH", [domain.verifyingContract]);
  });

  context("constructor", function () {
    it("Reverts if the verifying contract is zero address", async function () {
      await expect(ethers.deployContract("EIP712StETH", [ZeroAddress])).to.be.revertedWithCustomError(
        eip712steth,
        "ZeroStETHAddress",
      );
    });
  });

  context("domainSeparatorV4", function () {
    it("Returns the correct domain separator", async function () {
      const expectedSeparator = deriveDomainSeparator(domain);

      expect(await eip712steth.domainSeparatorV4(domain.verifyingContract)).to.equal(expectedSeparator);
    });
  });

  context("hashTypedDataV4", function () {
    it("Returns the message hash", async function () {
      const expectedHash = deriveTypeDataHash({
        address: domain.verifyingContract,
        structHash: streccak(domain.type),
      });

      expect(await eip712steth.hashTypedDataV4(domain.verifyingContract, streccak(domain.type))).to.equal(expectedHash);
    });
  });

  context("eip712Domain", function () {
    it("Returns the domain data", async function () {
      expect(await eip712steth.eip712Domain(domain.verifyingContract)).to.deep.equal([
        domain.name,
        domain.version,
        domain.chainId,
        domain.verifyingContract,
      ]);
    });
  });
});
