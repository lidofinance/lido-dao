import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { HexString } from "ethers/lib.commonjs/utils/data";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { OracleDaemonConfig, OracleDaemonConfig__factory } from "typechain-types";

describe("OracleDaemonConfig", () => {
  let deployer: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let configPrimaryManager: HardhatEthersSigner;
  let configSecondaryManager: HardhatEthersSigner;

  let oracleDaemonConfig: OracleDaemonConfig;

  const defaultKey: string = "key1";
  const defaultValue: HexString = "0xbec001";

  beforeEach(async () => {
    [deployer, admin, stranger, configPrimaryManager, configSecondaryManager] = await ethers.getSigners();

    oracleDaemonConfig = await new OracleDaemonConfig__factory(deployer).deploy(admin, [
      configPrimaryManager,
      configSecondaryManager,
    ]);
    oracleDaemonConfig = oracleDaemonConfig.connect(stranger);
  });

  context("constructor", () => {
    context("Reverts", () => {
      it("Reverts if admin is zero address", async () => {
        await expect(
          new OracleDaemonConfig__factory(deployer).deploy(ZeroAddress, [configPrimaryManager, configSecondaryManager]),
        ).to.be.revertedWithCustomError(oracleDaemonConfig, "ZeroAddress");
      });

      it("Reverts if config managers contain zero address", async () => {
        await expect(
          new OracleDaemonConfig__factory(deployer).deploy(admin, [configPrimaryManager, ZeroAddress]),
        ).to.be.revertedWithCustomError(oracleDaemonConfig, "ZeroAddress");
      });
    });

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

    it("Allows empty config managers list", async () => {
      let newODCInstance: OracleDaemonConfig = await new OracleDaemonConfig__factory(deployer).deploy(admin, []);
      newODCInstance = newODCInstance.connect(stranger);

      const adminRole = await oracleDaemonConfig.DEFAULT_ADMIN_ROLE();
      expect(await newODCInstance.getRoleMemberCount(adminRole)).to.equal(1);
      expect(await newODCInstance.hasRole(adminRole, admin)).to.equal(true);

      const configManagerRole = await oracleDaemonConfig.CONFIG_MANAGER_ROLE();
      expect(await newODCInstance.getRoleMemberCount(configManagerRole)).to.equal(0);
      expect(await newODCInstance.hasRole(configManagerRole, configPrimaryManager)).to.equal(false);
      expect(await newODCInstance.hasRole(configManagerRole, configSecondaryManager)).to.equal(false);
    });
  });

  context("Set and get values", () => {
    context("Reverts", () => {
      it("Reverts trying to set from unauthorized account", async () => {
        const configManagerRole = await oracleDaemonConfig.CONFIG_MANAGER_ROLE();

        await expect(oracleDaemonConfig.set(defaultKey, defaultValue)).to.be.revertedWithOZAccessControlError(
          stranger.address,
          configManagerRole,
        );
      });

      it("Reverts trying to get missing value", async () => {
        await expect(oracleDaemonConfig.get(defaultKey))
          .to.be.revertedWithCustomError(oracleDaemonConfig, "ValueDoesntExist")
          .withArgs(defaultKey);
      });

      it("Reverts trying to set empty value", async () => {
        await expect(oracleDaemonConfig.connect(configPrimaryManager).set(defaultKey, "0x"))
          .to.be.revertedWithCustomError(oracleDaemonConfig, "EmptyValue")
          .withArgs(defaultKey);
      });

      it("Reverts trying to set with the same key twice", async () => {
        await expect(oracleDaemonConfig.connect(configPrimaryManager).set(defaultKey, defaultValue))
          .to.emit(oracleDaemonConfig, "ConfigValueSet")
          .withArgs(defaultKey, defaultValue);

        await expect(oracleDaemonConfig.connect(configPrimaryManager).set(defaultKey, "0xdead"))
          .to.be.revertedWithCustomError(oracleDaemonConfig, "ValueExists")
          .withArgs(defaultKey);
      });
    });

    it("Get works after set", async () => {
      await expect(oracleDaemonConfig.connect(configPrimaryManager).set(defaultKey, defaultValue))
        .to.emit(oracleDaemonConfig, "ConfigValueSet")
        .withArgs(defaultKey, defaultValue);

      expect(await oracleDaemonConfig.get(defaultKey)).to.equal(defaultValue);
    });

    it("Get works after set with empty key", async () => {
      await expect(oracleDaemonConfig.connect(configPrimaryManager).set("", defaultValue))
        .to.emit(oracleDaemonConfig, "ConfigValueSet")
        .withArgs("", defaultValue);

      expect(await oracleDaemonConfig.get("")).to.equal(defaultValue);
    });
  });

  context("Function `update`", () => {
    context("Reverts", () => {
      it("Reverts trying to update from unauthorized account", async () => {
        await expect(oracleDaemonConfig.connect(configPrimaryManager).set(defaultKey, defaultValue))
          .to.emit(oracleDaemonConfig, "ConfigValueSet")
          .withArgs(defaultKey, defaultValue);

        const configManagerRole = await oracleDaemonConfig.CONFIG_MANAGER_ROLE();

        await expect(oracleDaemonConfig.update(defaultKey, "0xdead")).to.be.revertedWithOZAccessControlError(
          stranger.address,
          configManagerRole,
        );
      });

      it("Reverts trying to update missing key", async () => {
        await expect(oracleDaemonConfig.connect(configPrimaryManager).update(defaultKey, "0xdead"))
          .to.be.revertedWithCustomError(oracleDaemonConfig, "ValueDoesntExist")
          .withArgs(defaultKey);
      });

      it("Reverts trying to update to empty value", async () => {
        await expect(oracleDaemonConfig.connect(configPrimaryManager).set(defaultKey, defaultValue))
          .to.emit(oracleDaemonConfig, "ConfigValueSet")
          .withArgs(defaultKey, defaultValue);

        await expect(oracleDaemonConfig.connect(configPrimaryManager).update(defaultKey, "0x"))
          .to.be.revertedWithCustomError(oracleDaemonConfig, "EmptyValue")
          .withArgs(defaultKey);
      });

      it("Reverts trying to update to the same value", async () => {
        await expect(oracleDaemonConfig.connect(configPrimaryManager).set(defaultKey, defaultValue))
          .to.emit(oracleDaemonConfig, "ConfigValueSet")
          .withArgs(defaultKey, defaultValue);

        await expect(oracleDaemonConfig.connect(configPrimaryManager).update(defaultKey, defaultValue))
          .to.be.revertedWithCustomError(oracleDaemonConfig, "ValueIsSame")
          .withArgs(defaultKey, defaultValue);
      });
    });

    it("Update works after set", async () => {
      await expect(oracleDaemonConfig.connect(configPrimaryManager).set(defaultKey, defaultValue))
        .to.emit(oracleDaemonConfig, "ConfigValueSet")
        .withArgs(defaultKey, defaultValue);

      await expect(oracleDaemonConfig.connect(configPrimaryManager).update(defaultKey, "0xdead"))
        .to.emit(oracleDaemonConfig, "ConfigValueUpdated")
        .withArgs(defaultKey, "0xdead");
    });

    it("Update works after set with empty key", async () => {
      await expect(oracleDaemonConfig.connect(configPrimaryManager).set("", defaultValue))
        .to.emit(oracleDaemonConfig, "ConfigValueSet")
        .withArgs("", defaultValue);

      await expect(oracleDaemonConfig.connect(configPrimaryManager).update("", "0xdead"))
        .to.emit(oracleDaemonConfig, "ConfigValueUpdated")
        .withArgs("", "0xdead");
    });
  });

  context("Function `unset`", () => {
    context("Reverts", () => {
      it("Reverts trying to unset from unauthorized account", async () => {
        await expect(oracleDaemonConfig.connect(configPrimaryManager).set(defaultKey, defaultValue))
          .to.emit(oracleDaemonConfig, "ConfigValueSet")
          .withArgs(defaultKey, defaultValue);

        const configManagerRole = await oracleDaemonConfig.CONFIG_MANAGER_ROLE();

        await expect(oracleDaemonConfig.unset(defaultKey)).to.be.revertedWithOZAccessControlError(
          stranger.address,
          configManagerRole,
        );
      });

      it("Reverts trying to unset missing key", async () => {
        await expect(oracleDaemonConfig.connect(configPrimaryManager).unset(defaultKey))
          .to.be.revertedWithCustomError(oracleDaemonConfig, "ValueDoesntExist")
          .withArgs(defaultKey);
      });
    });

    it("Unset works after set", async () => {
      await expect(oracleDaemonConfig.connect(configPrimaryManager).set(defaultKey, defaultValue))
        .to.emit(oracleDaemonConfig, "ConfigValueSet")
        .withArgs(defaultKey, defaultValue);

      await expect(oracleDaemonConfig.connect(configPrimaryManager).unset(defaultKey))
        .to.emit(oracleDaemonConfig, "ConfigValueUnset")
        .withArgs(defaultKey);
    });

    it("Unset works after set with empty key", async () => {
      await expect(oracleDaemonConfig.connect(configPrimaryManager).set("", defaultValue))
        .to.emit(oracleDaemonConfig, "ConfigValueSet")
        .withArgs("", defaultValue);

      await expect(oracleDaemonConfig.connect(configPrimaryManager).unset(""))
        .to.emit(oracleDaemonConfig, "ConfigValueUnset")
        .withArgs("");
    });
  });

  context("Function `getList`", () => {
    context("Reverts", () => {
      it("Reverts trying to get at least one missing key", async () => {
        await expect(oracleDaemonConfig.connect(configPrimaryManager).set(defaultKey, defaultValue))
          .to.emit(oracleDaemonConfig, "ConfigValueSet")
          .withArgs(defaultKey, defaultValue);

        await expect(oracleDaemonConfig.connect(configPrimaryManager).set("key2", "0xdead"))
          .to.emit(oracleDaemonConfig, "ConfigValueSet")
          .withArgs("key2", "0xdead");

        await expect(oracleDaemonConfig.getList(["unknownKey"]))
          .to.be.revertedWithCustomError(oracleDaemonConfig, "ValueDoesntExist")
          .withArgs("unknownKey");
      });
    });

    it("getList works for empty keys list", async () => {
      expect(await oracleDaemonConfig.getList([])).to.be.an("array").that.is.empty;
    });

    it("getList works after set", async () => {
      await expect(oracleDaemonConfig.connect(configPrimaryManager).set(defaultKey, defaultValue))
        .to.emit(oracleDaemonConfig, "ConfigValueSet")
        .withArgs(defaultKey, defaultValue);

      await expect(oracleDaemonConfig.connect(configPrimaryManager).set("key2", "0xdead"))
        .to.emit(oracleDaemonConfig, "ConfigValueSet")
        .withArgs("key2", "0xdead");

      await expect(oracleDaemonConfig.connect(configPrimaryManager).set("", "0xfead"))
        .to.emit(oracleDaemonConfig, "ConfigValueSet")
        .withArgs("", "0xfead");

      expect(await oracleDaemonConfig.getList([])).to.be.an("array").that.is.empty;
      expect(await oracleDaemonConfig.getList([defaultKey])).to.deep.equal([defaultValue]);
      expect(await oracleDaemonConfig.getList(["key2"])).to.deep.equal(["0xdead"]);
      expect(await oracleDaemonConfig.getList([defaultKey, "key2", ""])).to.deep.equal([
        defaultValue,
        "0xdead",
        "0xfead",
      ]);
    });
  });
});
