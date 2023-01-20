const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveDeployTx } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')
const { deployWithoutProxy, deployBehindOssifiableProxy } = require('../helpers/deploy-shapella')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const { APP_NAMES } = require('../multisig/constants')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = [
  "app:lido",
  "app:aragon-agent",
  "app:aragon-voting",
]

const GAS_LIMIT = 8000000

async function deployNewContracts({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()
  logWideSplitter()
  log(`Network ID:`, yl(netId))
  let state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const lidoAddress = state["app:lido"].proxyAddress
  const agent = state["app:aragon-agent"].proxyAddress
  const voting = state["app:aragon-voting"].proxyAddress
  const beaconSpec = state["daoInitialSettings"]["beaconSpec"]
  logWideSplitter()


  const lido = await artifacts.require('Lido').at(lidoAddress)
  const oracleAddress = await lido.getOracle()
  const treasuryAddress = await lido.getTreasury()
  const stakingRouterAddressLido = await lido.getStakingRouter()
  const depositSecurityModuleAddress = await lido.getDepositSecurityModule()
  const elRewardsVaultAddress = await lido.getELRewardsVault()
  const withdrawalQueueAddressLido = await lido.getWithdrawalQueue()
  console.log({
    oracleAddress,
    treasuryAddress,
    stakingRouterAddressLido,
    depositSecurityModuleAddress,
    elRewardsVaultAddress,
    withdrawalQueueAddressLido,
  })


  //
  // === ValidatorExitBus ===
  //
  const validatorExitBusAddress = state["validatorExitBus"].proxy
  const validatorExitBus = await artifacts.require('ValidatorExitBus').at(validatorExitBusAddress)

  //
  // === StakingRouter ===
  //
  const stakingRouterAddress = state["stakingRouter"].proxy
  const stakingRouter = await artifacts.require('StakingRouter').at(stakingRouterAddress)

  //
  // === WithdrawalQueue ===
  //
  state = readNetworkState(network.name, netId)
  const withdrawalQueueAddress = state["withdrawalQueue"].proxy
  const withdrawalQueue = await artifacts.require('WithdrawalQueue').at(withdrawalQueueAddress)

}

module.exports = runOrWrapScript(deployNewContracts, module)
