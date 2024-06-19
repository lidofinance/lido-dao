import { ethers } from "hardhat";

import { deployImplementation, deployWithoutProxy, log, persistNetworkState, readNetworkState, Sk } from "lib";

function getEnvVariable(name: string, defaultValue?: string) {
  const value = process.env[name];
  if (value === undefined) {
    if (defaultValue === undefined) {
      throw new Error(`Env variable ${name} must be set`);
    }
    return defaultValue;
  } else {
    log(`Using env variable ${name}=${value}`);
    return value;
  }
}

async function main() {
  const deployer = ethers.getAddress(getEnvVariable("DEPLOYER"));
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const balance = await ethers.provider.getBalance(deployer);
  log(`Deployer ${deployer} on network ${chainId} has balance: ${ethers.formatEther(balance)} ETH`);

  const state = readNetworkState();
  state[Sk.scratchDeployGasUsed] = 0n.toString();
  persistNetworkState(state);

  const SC_ADMIN = getEnvVariable("ARAGON_AGENT");
  const LIMITS_LIST = [1500, 500, 1000, 250, 2000, 100, 100, 128, 5000000, 1500];
  const MANAGERS_ROSTER = [[], [], [], [], [], [], [], [], [], [], []];

  // Read all the constants from environment variables
  const LIDO = getEnvVariable("LIDO");
  const DEPOSIT_CONTRACT = getEnvVariable("DEPOSIT_CONTRACT");
  const STAKING_ROUTER = getEnvVariable("STAKING_ROUTER");
  const PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS = parseInt(getEnvVariable("PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS"));
  const MAX_OPERATORS_PER_UNVETTING = parseInt(getEnvVariable("MAX_OPERATORS_PER_UNVETTING"));

  const LOCATOR = getEnvVariable("LOCATOR");
  const LEGACY_ORACLE = getEnvVariable("LEGACY_ORACLE");
  const SECONDS_PER_SLOT = parseInt(getEnvVariable("SECONDS_PER_SLOT"));
  const GENESIS_TIME = parseInt(getEnvVariable("GENESIS_TIME"));

  const ACCOUNTING_ORACLE_PROXY = getEnvVariable("ACCOUNTING_ORACLE_PROXY");
  const EL_REWARDS_VAULT = getEnvVariable("EL_REWARDS_VAULT");
  const BURNER = getEnvVariable("BURNER");
  const TREASURY_ADDRESS = getEnvVariable("TREASURY_ADDRESS");
  const VEBO = getEnvVariable("VEBO");
  const WQ = getEnvVariable("WITHDRAWAL_QUEUE_ERC721");
  const WITHDRAWAL_VAULT = getEnvVariable("WITHDRAWAL_VAULT_ADDRESS");
  const ORACLE_DAEMON_CONFIG = getEnvVariable("ORACLE_DAEMON_CONFIG");

  // StakingRouter deploy

  // Deploy MinFirstAllocationStrategy
  const minFirstAllocationStrategyAddress = (
    await deployWithoutProxy(Sk.minFirstAllocationStrategy, "MinFirstAllocationStrategy", deployer)
  ).address;

  log(`MinFirstAllocationStrategy address: ${minFirstAllocationStrategyAddress}`);

  const libraries = {
    MinFirstAllocationStrategy: minFirstAllocationStrategyAddress,
  };

  const stakingRouterAddress = (
    await deployImplementation(Sk.stakingRouter, "StakingRouter", deployer, [DEPOSIT_CONTRACT], { libraries })
  ).address;

  log(`StakingRouter implementation address: ${stakingRouterAddress}`);

  const appNodeOperatorsRegistry = (
    await deployImplementation(Sk.appNodeOperatorsRegistry, "NodeOperatorsRegistry", deployer, [], { libraries })
  ).address;

  log(`NodeOperatorsRegistry address implementation: ${appNodeOperatorsRegistry}`);

  const depositSecurityModuleParams = [
    LIDO,
    DEPOSIT_CONTRACT,
    STAKING_ROUTER,
    PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS,
    MAX_OPERATORS_PER_UNVETTING,
  ];

  const depositSecurityModuleAddress = (
    await deployWithoutProxy(Sk.depositSecurityModule, "DepositSecurityModule", deployer, depositSecurityModuleParams)
  ).address;

  log(`New DSM address: ${depositSecurityModuleAddress}`);

  const accountingOracleArgs = [LOCATOR, LIDO, LEGACY_ORACLE, SECONDS_PER_SLOT, GENESIS_TIME];

  const accountingOracleAddress = (
    await deployImplementation(Sk.accountingOracle, "AccountingOracle", deployer, accountingOracleArgs)
  ).address;

  log(`AO implementation address: ${accountingOracleAddress}`);

  const oracleReportSanityCheckerArgs = [LOCATOR, SC_ADMIN, LIMITS_LIST, MANAGERS_ROSTER];

  const oracleReportSanityCheckerAddress = (
    await deployWithoutProxy(
      Sk.oracleReportSanityChecker,
      "OracleReportSanityChecker",
      deployer,
      oracleReportSanityCheckerArgs,
    )
  ).address;

  log(`OracleReportSanityChecker new address ${oracleReportSanityCheckerAddress}`);

  const locatorConfig = [
    [
      ACCOUNTING_ORACLE_PROXY,
      depositSecurityModuleAddress,
      EL_REWARDS_VAULT,
      LEGACY_ORACLE,
      LIDO,
      oracleReportSanityCheckerAddress,
      LEGACY_ORACLE,
      BURNER,
      STAKING_ROUTER,
      TREASURY_ADDRESS,
      VEBO,
      WQ,
      WITHDRAWAL_VAULT,
      ORACLE_DAEMON_CONFIG,
    ],
  ];

  const locatorAddress = (await deployImplementation(Sk.lidoLocator, "LidoLocator", deployer, locatorConfig)).address;

  log(`Locator implementation address ${locatorAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    log.error(error);
    process.exit(1);
  });
