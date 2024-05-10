import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { LidoLocator, LidoLocator__factory, OssifiableProxy__factory } from "typechain-types";

import { certainAddress } from ".";

async function deployLocator(config?: Partial<LidoLocator.ConfigStruct>, deployer?: HardhatEthersSigner) {
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
  return locator as LidoLocator;
}

export async function dummyLocator(config?: Partial<LidoLocator.ConfigStruct>, deployer?: HardhatEthersSigner) {
  if (!deployer) {
    [deployer] = await ethers.getSigners();
  }
  const locator = await deployLocator(config, deployer);
  const proxyFactory = new OssifiableProxy__factory(deployer);
  const proxy = await proxyFactory.deploy(await locator.getAddress(), await deployer.getAddress(), new Uint8Array());
  return await ethers.getContractAt("LidoLocator", await proxy.getAddress());
}

async function updateProxyImplementation(
  proxyAddress: string,
  config: LidoLocator.ConfigStruct,
  customLocator?: string,
  proxyOwner?: HardhatEthersSigner,
) {
  if (!proxyOwner) {
    [proxyOwner] = await ethers.getSigners();
  }
  const proxy = await ethers.getContractAt("OssifiableProxy", proxyAddress);
  let implementation;
  if (customLocator) {
    const contractFactory = await ethers.getContractFactory(customLocator);
    implementation = await contractFactory.connect(proxyOwner).deploy(config);
  } else {
    implementation = await deployLocator(config, proxyOwner);
  }
  await proxy.proxy__upgradeTo(await implementation.getAddress());
}

async function getLocatorConfig(locatorAddress: string) {
  const locator = await ethers.getContractAt("LidoLocator", locatorAddress);
  const config = {
    accountingOracle: await locator.accountingOracle(),
    depositSecurityModule: await locator.depositSecurityModule(),
    elRewardsVault: await locator.elRewardsVault(),
    legacyOracle: await locator.legacyOracle(),
    lido: await locator.lido(),
    oracleReportSanityChecker: await locator.oracleReportSanityChecker(),
    postTokenRebaseReceiver: await locator.postTokenRebaseReceiver(),
    burner: await locator.burner(),
    stakingRouter: await locator.stakingRouter(),
    treasury: await locator.treasury(),
    validatorsExitBusOracle: await locator.validatorsExitBusOracle(),
    withdrawalQueue: await locator.withdrawalQueue(),
    withdrawalVault: await locator.withdrawalVault(),
    oracleDaemonConfig: await locator.oracleDaemonConfig(),
  };
  return config;
}

export async function updateLocatorImplementation(
  locatorAddress: string,
  configUpdate = {},
  customLocator?: string,
  admin?: HardhatEthersSigner,
) {
  const config = await getLocatorConfig(locatorAddress);
  Object.assign(config, configUpdate);
  await updateProxyImplementation(locatorAddress, config, customLocator, admin);
}
