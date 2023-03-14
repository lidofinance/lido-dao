const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveDeployTx } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')
const { deployWithoutProxy, deployBehindOssifiableProxy } = require('../helpers/deploy-shapella')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')
const fs = require('fs')

const { APP_NAMES } = require('../multisig/constants')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = [
  "app:lido",
  "app:aragon-agent",
  "app:aragon-voting",
  "app:node-operators-registry",
  "lidoOracle",
  "stakingRouter",
  "executionLayerRewardsVaultAddress",
  "withdrawalQueue",
  "depositSecurityModuleAddress",
  "daoInitialSettings",
  "compositePostRebaseBeaconReceiverAddress",
  "withdrawalVaultAddress",
  "validatorExitBus",
  "beaconChainDepositorAddress",
  "wstETHAddress",
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
  const withdrawalVault = state["withdrawalVaultAddress"]
  const executionLayerRewardsVault = state["executionLayerRewardsVaultAddress"]
  const beaconSpec = state["daoInitialSettings"]["beaconSpec"]
  const compositePostRebaseBeaconReceiverAddress = state["compositePostRebaseBeaconReceiverAddress"]
  const validatorExitBus = state["validatorExitBus"].proxy
  const nodeOperatorsRegistry = state["app:node-operators-registry"].proxyAddress
  const beaconChainDepositor = state["beaconChainDepositorAddress"]

  const addressesInfo = `
Lido ${lidoAddress}
WstETH ${state["wstETHAddress"]}
WithdrawalVault ${withdrawalVault}
WithdrawalQueue ${withdrawalQueue}
ExecutionLayerRewardsVault ${executionLayerRewardsVault}
StakingRouter ${stakingRouter}
NodeOperatorRegistry ${nodeOperatorsRegistry}
BeaconChainDepositor ${beaconChainDepositor}
DepositSecurityModule ${depositSecurityModule}
CompositePostRebaseBeaconReceive ${compositePostRebaseBeaconReceiverAddress}
Burner ${state["burnerAddress"]}
`
  console.log(addressesInfo)
  // fs.writeFileSync(fileName, data + '\n', 'utf8')

}

module.exports = runOrWrapScript(deployNewContracts, module)
