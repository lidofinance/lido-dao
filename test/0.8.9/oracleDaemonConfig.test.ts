import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { OracleDaemonConfig, OracleDaemonConfig__factory } from "typechain-types";

describe("OracleDaemonConfig", () => {
  let deployer: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let holder: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let configPrimaryManager: HardhatEthersSigner;
  let configSecondaryManager: HardhatEthersSigner;

  let oracleDaemonConfig: OracleDaemonConfig;

  beforeEach(async () => {
    [deployer, admin, holder, stranger, configPrimaryManager, configSecondaryManager] = await ethers.getSigners();

    oracleDaemonConfig = await new OracleDaemonConfig__factory(deployer).deploy(admin, [
      configPrimaryManager,
      configSecondaryManager,
    ]);
    oracleDaemonConfig = oracleDaemonConfig.connect(holder);
  });

  context("constructor", () => {
    it("Sets up roles", async () => {
      const adminRole = await oracleDaemonConfig.DEFAULT_ADMIN_ROLE();
      expect(await oracleDaemonConfig.getRoleMemberCount(adminRole)).to.equal(1);
      expect(await oracleDaemonConfig.hasRole(adminRole, admin)).to.equal(true);
      expect(await oracleDaemonConfig.hasRole(adminRole, stranger)).to.equal(false);
      expect(await oracleDaemonConfig.hasRole(adminRole, configPrimaryManager)).to.equal(false);
      expect(await oracleDaemonConfig.hasRole(adminRole, configSecondaryManager)).to.equal(false);

      const configManagerRole = await oracleDaemonConfig.CONFIG_MANAGER_ROLE();
      expect(await oracleDaemonConfig.getRoleMemberCount(configManagerRole)).to.equal(2);
      expect(await oracleDaemonConfig.hasRole(configManagerRole, configPrimaryManager)).to.equal(true);
      expect(await oracleDaemonConfig.hasRole(configManagerRole, configSecondaryManager)).to.equal(true);
      expect(await oracleDaemonConfig.hasRole(configManagerRole, admin)).to.equal(false);
      expect(await oracleDaemonConfig.hasRole(configManagerRole, stranger)).to.equal(false);
    });

    it("Reverts if admin is zero address", async () => {
      await expect(
        new OracleDaemonConfig__factory(deployer).deploy(ZeroAddress, [configPrimaryManager, configSecondaryManager]),
      ).to.be.revertedWithCustomError(oracleDaemonConfig, "ZeroAddress");
    });

    it("Allows empty config managers list", async () => {
      let newODCInstance: OracleDaemonConfig = await new OracleDaemonConfig__factory(deployer).deploy(admin, []);
      newODCInstance = newODCInstance.connect(holder);

      const adminRole = await oracleDaemonConfig.DEFAULT_ADMIN_ROLE();
      expect(await newODCInstance.getRoleMemberCount(adminRole)).to.equal(1);
      expect(await newODCInstance.hasRole(adminRole, admin)).to.equal(true);

      const configManagerRole = await oracleDaemonConfig.CONFIG_MANAGER_ROLE();
      expect(await newODCInstance.getRoleMemberCount(configManagerRole)).to.equal(0);
      expect(await newODCInstance.hasRole(configManagerRole, configPrimaryManager)).to.equal(false);
      expect(await newODCInstance.hasRole(configManagerRole, configSecondaryManager)).to.equal(false);
    });
  });
});
