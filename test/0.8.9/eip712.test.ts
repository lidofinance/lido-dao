import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";
import { certainAddress, deriveDomainSeparator, deriveTypeDataHash, streccak } from "lib";
import { describe } from "mocha";
import { EIP712StETH, EIP712StETH__factory } from "typechain-types";

interface Domain {
  type: string;
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

describe("EIP712StETH.sol", () => {
  let domain: Domain;

  let eip712steth: EIP712StETH;

  beforeEach(async () => {
    domain = {
      type: "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
      name: "Liquid staked Ether 2.0",
      version: "2",
      chainId: await ethers.provider.send("eth_chainId", []),
      verifyingContract: certainAddress("eip712.test:domain:verifying-contract"),
    };

    const [deployer] = await ethers.getSigners();
    const factory = new EIP712StETH__factory(deployer);
    eip712steth = await factory.deploy(domain.verifyingContract);
  });

  context("constructor", function () {
    it("Reverts if the verifying contract is zero address", async function () {
      const [deployer] = await ethers.getSigners();
      const factory = new EIP712StETH__factory(deployer);

      await expect(factory.deploy(ZeroAddress)).to.be.revertedWithCustomError(eip712steth, "ZeroStETHAddress");
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
      const domainSeparator = deriveDomainSeparator(domain);

      const expectedHash = deriveTypeDataHash({
        domainSeparator,
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
