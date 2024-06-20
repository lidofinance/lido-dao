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

// TODO: add guardians
async function main() {
  const deployer = ethers.getAddress(getEnvVariable("DEPLOYER"));
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const balance = await ethers.provider.getBalance(deployer);
  log(`Deployer ${deployer} on network ${chainId} has balance: ${ethers.formatEther(balance)} ETH`);

  // parameters from env variables

  const PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS = parseInt(getEnvVariable("PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS"));
  const MAX_OPERATORS_PER_UNVETTING = parseInt(getEnvVariable("MAX_OPERATORS_PER_UNVETTING"));
  const SECONDS_PER_SLOT = parseInt(getEnvVariable("SECONDS_PER_SLOT"));
  const GENESIS_TIME = parseInt(getEnvVariable("GENESIS_TIME"));

  const LIMITS_LIST = [1500, 500, 1000, 250, 2000, 100, 100, 128, 5000000, 1500];
  const MANAGERS_ROSTER = [[], [], [], [], [], [], [], [], [], [], []];

  const state = readNetworkState();
  state[Sk.scratchDeployGasUsed] = 0n.toString();
  persistNetworkState(state);

  // Read contracts addresses from config
  const DEPOSIT_CONTRACT_ADDRESS = state[Sk.chainSpec].depositContractAddress;
  const APP_AGENT_ADDRESS = state[Sk.appAgent].proxy.address;
  const SC_ADMIN = APP_AGENT_ADDRESS;
  const LIDO = state[Sk.appLido].proxy.address;
  const STAKING_ROUTER = state[Sk.stakingRouter].proxy.address;
  const LOCATOR = state[Sk.lidoLocator].proxy.address;
  const LEGACY_ORACLE = state[Sk.appOracle].proxy.address;
  const ACCOUNTING_ORACLE_PROXY = state[Sk.accountingOracle].proxy.address;
  const EL_REWARDS_VAULT = state[Sk.executionLayerRewardsVault].address;
  const BURNER = state[Sk.burner].address;
  const TREASURY_ADDRESS = APP_AGENT_ADDRESS;
  const VEBO = state[Sk.validatorsExitBusOracle].proxy.address;
  const WQ = state[Sk.withdrawalQueueERC721].proxy.address;
  const WITHDRAWAL_VAULT = state[Sk.withdrawalVault].proxy.address;
  const ORACLE_DAEMON_CONFIG = state[Sk.oracleDaemonConfig].address;

  // Deploy MinFirstAllocationStrategy
  const minFirstAllocationStrategyAddress = (
    await deployWithoutProxy(Sk.minFirstAllocationStrategy, "MinFirstAllocationStrategy", deployer)
  ).address;

  log(`MinFirstAllocationStrategy address: ${minFirstAllocationStrategyAddress}`);

  const libraries = {
    MinFirstAllocationStrategy: minFirstAllocationStrategyAddress,
  };

  const stakingRouterAddress = (
    await deployImplementation(Sk.stakingRouter, "StakingRouter", deployer, [DEPOSIT_CONTRACT_ADDRESS], { libraries })
  ).address;

  log(`StakingRouter implementation address: ${stakingRouterAddress}`);

  const appNodeOperatorsRegistry = (
    await deployImplementation(Sk.appNodeOperatorsRegistry, "NodeOperatorsRegistry", deployer, [], { libraries })
  ).address;

  log(`NodeOperatorsRegistry address implementation: ${appNodeOperatorsRegistry}`);

  const depositSecurityModuleParams = [
    LIDO,
    DEPOSIT_CONTRACT_ADDRESS,
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
