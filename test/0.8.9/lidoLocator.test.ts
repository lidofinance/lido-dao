import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";
import { describe } from "mocha";
import { ArrayToUnion, randomAddress } from "lib";
import { LidoLocator } from "typechain-types";

const services = [
  "accountingOracle",
  "depositSecurityModule",
  "elRewardsVault",
  "legacyOracle",
  "lido",
  "oracleReportSanityChecker",
  "postTokenRebaseReceiver",
  "burner",
  "stakingRouter",
  "treasury",
  "validatorsExitBusOracle",
  "withdrawalQueue",
  "withdrawalVault",
  "oracleDaemonConfig",
] as const;

type Service = ArrayToUnion<typeof services>;
type Config = Record<Service, string>;

function randomConfig(): Config {
  return services.reduce<Config>((config, service) => {
    config[service] = randomAddress();
    return config;
  }, {} as Config);
}

describe("LidoLocator.sol", function () {
  const config = randomConfig();
  let locator: LidoLocator;

  this.beforeAll(async function () {
    locator = await ethers.deployContract("LidoLocator", [config]);
  });

  context("constructor", function () {
    for (const service of services) {
      it(`Reverts if the \`config.${service}\` is zero address`, async function () {
        const config = randomConfig();
        config[service] = ZeroAddress;

        await expect(ethers.deployContract("LidoLocator", [config])).to.be.revertedWithCustomError(
          locator,
          "ZeroAddress",
        );
      });
    }
  });

  context("coreComponents", function () {
    it("Returns correct services in correct order", async function () {
      const { elRewardsVault, oracleReportSanityChecker, stakingRouter, treasury, withdrawalQueue, withdrawalVault } =
        config;

      expect(await locator.coreComponents()).to.deep.equal([
        elRewardsVault,
        oracleReportSanityChecker,
        stakingRouter,
        treasury,
        withdrawalQueue,
        withdrawalVault,
      ]);
    });
  });

  context("oracleReportComponentsForLido", function () {
    it("Returns correct services in correct order", async function () {
      const {
        accountingOracle,
        elRewardsVault,
        oracleReportSanityChecker,
        burner,
        withdrawalQueue,
        withdrawalVault,
        postTokenRebaseReceiver,
      } = config;

      expect(await locator.oracleReportComponentsForLido()).to.deep.equal([
        accountingOracle,
        elRewardsVault,
        oracleReportSanityChecker,
        burner,
        withdrawalQueue,
        withdrawalVault,
        postTokenRebaseReceiver,
      ]);
    });
  });
});
