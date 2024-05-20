import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { LidoLocator, LidoLocator__factory, OssifiableProxy, OssifiableProxy__factory } from "typechain-types";

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
  return locator.attach(await proxy.getAddress());
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
  const proxyFactory = new OssifiableProxy__factory(proxyOwner);
  const proxy = (await proxyFactory.attach(proxyAddress)) as OssifiableProxy;
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
  const [
    accountingOracle,
    depositSecurityModule,
    elRewardsVault,
    legacyOracle,
    lido,
    oracleReportSanityChecker,
    postTokenRebaseReceiver,
    burner,
    stakingRouter,
    treasury,
    validatorsExitBusOracle,
    withdrawalQueue,
    withdrawalVault,
    oracleDaemonConfig,
  ] = await Promise.all([
    await locator.accountingOracle(),
    await locator.depositSecurityModule(),
    await locator.elRewardsVault(),
    await locator.legacyOracle(),
    await locator.lido(),
    await locator.oracleReportSanityChecker(),
    await locator.postTokenRebaseReceiver(),
    await locator.burner(),
    await locator.stakingRouter(),
    await locator.treasury(),
    await locator.validatorsExitBusOracle(),
    await locator.withdrawalQueue(),
    await locator.withdrawalVault(),
    await locator.oracleDaemonConfig(),
  ]);

  const config = {
    accountingOracle,
    depositSecurityModule,
    elRewardsVault,
    legacyOracle,
    lido,
    oracleReportSanityChecker,
    postTokenRebaseReceiver,
    burner,
    stakingRouter,
    treasury,
    validatorsExitBusOracle,
    withdrawalQueue,
    withdrawalVault,
    oracleDaemonConfig,
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
