import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";
import { LidoLocator, LidoLocator__factory } from "typechain-types";
import { certainAddress } from ".";

export async function dummyLocator(config?: Partial<LidoLocator.ConfigStruct>, deployer?: HardhatEthersSigner) {
  if (!deployer) {
    [deployer] = await ethers.getSigners();
  }

  const factory = new LidoLocator__factory(deployer);

  const locator = await factory.deploy({
    accountingOracle: certainAddress("dummy-locator:accountingOracle"),
    burner: certainAddress("dummy-locator:burner"),
    depositSecurityModule: certainAddress("dummy-locator:depositSecurityModule"),
    elRewardsVault: certainAddress("dummy-locator:elRewardsVault"),
    legacyOracle: certainAddress("dummy-locator:legacyOracle"),
    lido: certainAddress("dummy-locator:lido"),
    oracleDaemonConfig: certainAddress("dummy-locator:oracleDaemonConfig"),
    oracleReportSanityChecker: certainAddress("dummy-locator:oracleReportSanityChecker"),
    postTokenRebaseReceiver: certainAddress("dummy-locator:postTokenRebaseReceiver"),
    stakingRouter: certainAddress("dummy-locator:stakingRouter"),
    treasury: certainAddress("dummy-locator:treasury"),
    validatorsExitBusOracle: certainAddress("dummy-locator:validatorsExitBusOracle"),
    withdrawalQueue: certainAddress("dummy-locator:withdrawalQueue"),
    withdrawalVault: certainAddress("dummy-locator:withdrawalVault"),
    ...config,
  });

  return locator;
}
