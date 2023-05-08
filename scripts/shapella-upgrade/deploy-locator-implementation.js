const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { deployWithoutProxy, deployBehindOssifiableProxy, updateProxyImplementation } = require('../helpers/deploy')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const { APP_NAMES } = require('../constants')

const DEPLOYER = process.env.DEPLOYER || ''
const GAS_PRICE = process.env.GAS_PRICE || 0
const REQUIRED_NET_STATE = [
  `app:${APP_NAMES.LIDO}`,
  `app:${APP_NAMES.ORACLE}`,
  "oracleReportSanityChecker",
  "burner",
  "withdrawalQueueERC721",
  "oracleDaemonConfig",
  "withdrawalVault",
  "executionLayerRewardsVaultAddress",
  "accountingOracle",
  "depositSecurityModule",
  "stakingRouter",
  "validatorsExitBusOracle",
]

async function deployNewContracts({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()
  logWideSplitter()
  log(`Network ID:`, yl(netId))
  let state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const lidoAddress = state["app:lido"].proxyAddress
  const legacyOracleAddress = state["app:oracle"].proxyAddress
  const agentAddress = state["app:aragon-agent"].proxyAddress
  const withdrawalVaultAddress = state["withdrawalVault"].address
  const elRewardsVaultAddress = state["executionLayerRewardsVaultAddress"]
  const accountingOracleAddress = state["accountingOracle"].address
  const depositSecurityModuleAddress = state["depositSecurityModule"].address
  const oracleReportSanityCheckerAddress = state["oracleReportSanityChecker"].address
  const burnerAddress = state["burner"].address
  const stakingRouterAddress = state["stakingRouter"].address
  const validatorsExitBusOracleAddress = state["validatorsExitBusOracle"].address
  const withdrawalQueueERC721Address = state["withdrawalQueueERC721"].address
  const oracleDaemonConfigAddress = state["oracleDaemonConfig"].address
  const treasuryAddress = agentAddress


  if (!DEPLOYER) {
    throw new Error('DEPLOYER env variable is not specified')
  }

  const sanityChecks = state["oracleReportSanityChecker"].parameters
  logWideSplitter()

  if (!state.depositContractAddress && !state.daoInitialSettings.beaconSpec.depositContractAddress && isPublicNet) {
    throw new Error(`please specify deposit contract address in state file ${networkStateFile}`)
  }
  const depositContract = state.depositContractAddress || state.daoInitialSettings.beaconSpec.depositContractAddress

  // Deployer and admins
  const deployer = DEPLOYER
  const temporaryAdmin = deployer
  const txParams = {from: temporaryAdmin, gasPrice: GAS_PRICE}
  //
  // === LidoLocator: update to valid implementation ===
  //
  const postTokenRebaseReceiver = legacyOracleAddress
  const locatorConfig = [
    accountingOracleAddress,
    depositSecurityModuleAddress,
    elRewardsVaultAddress,
    legacyOracleAddress,
    lidoAddress,
    oracleReportSanityCheckerAddress,
    postTokenRebaseReceiver,
    burnerAddress,
    stakingRouterAddress,
    treasuryAddress,
    validatorsExitBusOracleAddress,
    withdrawalQueueERC721Address,
    withdrawalVaultAddress,
    oracleDaemonConfigAddress,
  ]
  console.log(locatorConfig)
  await deployWithoutProxy("lidoLocator", "LidoLocator", deployer, [locatorConfig], "implementation")
}

module.exports = runOrWrapScript(deployNewContracts, module)
