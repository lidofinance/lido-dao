const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')
const { deployWithoutProxy, deployBehindOssifiableProxy } = require('../helpers/deploy-shapella')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const { APP_NAMES } = require('./constants')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = [
  "app:lido",
  "app:aragon-agent",
  "app:aragon-voting",
  "lidoOracle",
  "stakingRouter",
  "executionLayerRewardsVaultAddress",
  "withdrawalQueue",
  "depositSecurityModuleAddress",
  "daoInitialSettings",
  "compositePostRebaseBeaconReceiverAddress",
]


async function deployNewContracts({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()
  logWideSplitter()
  log(`Network ID:`, yl(netId))

  let state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const agent = state["app:aragon-agent"].proxyAddress
  const voting = state["app:aragon-voting"].proxyAddress
  const lidoAddress = state["app:lido"].proxyAddress
  const oracleAddress = state["lidoOracle"].proxy
  const stakingRouter = state["stakingRouter"].proxy
  const depositSecurityModule = state["depositSecurityModuleAddress"]
  const withdrawalQueue = state["withdrawalQueue"].proxy
  const executionLayerRewardsVault = state["executionLayerRewardsVaultAddress"]
  const beaconSpec = state["daoInitialSettings"]["beaconSpec"]
  const compositePostRebaseBeaconReceiverAddress = state["compositePostRebaseBeaconReceiverAddress"]


  //
  // === Lido: initialize ===
  //
  // TODO: deploy eip712 contract
  const eip712StETH = ZERO_ADDRESS
  const treasury = agent
  const lidoInitArgs = [
    oracleAddress,
    treasury,
    stakingRouter,
    depositSecurityModule,
    executionLayerRewardsVault,
    withdrawalQueue,
    eip712StETH,
  ]
  console.log({ lidoInitArgs })
  const lido = await artifacts.require('Lido').at(lidoAddress)
  let tx = await lido.initialize(...lidoInitArgs, { from: DEPLOYER })
  logWideSplitter()


  //
  // === LidoOracleNew: initialize ===
  //
  const allowedBeaconBalanceAnnualRelativeIncrease = 3000  // just larger than in mainnet
  const allowedBeaconBalanceRelativeDecrease = 1000  // just larger than in mainnet
  const oracleInitArgs = [
    voting,
    lidoAddress,
    beaconSpec.epochsPerFrame,
    beaconSpec.slotsPerEpoch,
    beaconSpec.secondsPerSlot,
    beaconSpec.genesisTime,
    allowedBeaconBalanceAnnualRelativeIncrease,
    allowedBeaconBalanceRelativeDecrease,
    compositePostRebaseBeaconReceiverAddress,
  ]
  const oracle = await artifacts.require('LidoOracleNew').at(oracleAddress)
  tx = await oracle.initialize(...oracleInitArgs, { from: DEPLOYER })

}

module.exports = runOrWrapScript(deployNewContracts, module)
