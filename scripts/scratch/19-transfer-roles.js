const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr, OK } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { makeTx, TotalGasCounter } = require('../helpers/deploy')

const REQUIRED_NET_STATE = [
  "app:aragon-agent",
  "accountingOracle",
  "burner",
  "daoInitialSettings",
  "hashConsensusForAccountingOracle",
  "hashConsensusForValidatorsExitBusOracle",
  "lidoLocator",
  "stakingRouter",
  "validatorsExitBusOracle",
  "withdrawalQueueERC721",
]

const DEFAULT_ADMIN_ROLE = "0x00"


async function transferOZAdmin(contractName, contractAddress, currentAdmin, newAdmin) {
  console.log(`Transferring OZ admin of ${contractAddress} from ${currentAdmin} to ${newAdmin}:`)
  const contract = await artifacts.require(contractName).at(contractAddress)
  await makeTx(contract, 'grantRole', [DEFAULT_ADMIN_ROLE, newAdmin], { from: currentAdmin })
  await makeTx(contract, 'renounceRole', [DEFAULT_ADMIN_ROLE, currentAdmin], { from: currentAdmin })
  console.log()
}

async function changeOssifiableProxyAdmin(contractAddress, currentAdmin, newAdmin) {
  console.log(`Transferring OssifiableProxy admin of ${contractAddress} from ${currentAdmin} to ${newAdmin}...`)
  const contract = await artifacts.require('OssifiableProxy').at(contractAddress)
  await makeTx(contract, 'proxy__changeAdmin', [newAdmin], { from: currentAdmin })
  console.log()
}

async function changeDepositSecurityModuleAdmin(contractAddress, currentAdmin, newAdmin) {
  console.log(`Changing DepositSecurityModule owner of ${contractAddress} from ${currentAdmin} to ${newAdmin}...`)
  const depositSecurityModule = await artifacts.require('DepositSecurityModule').at(contractAddress)
  await makeTx(depositSecurityModule, 'setOwner', [newAdmin], { from: currentAdmin } )
  console.log()
}

async function deployNewContracts({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()
  logWideSplitter()
  log(`Network ID:`, yl(netId))

  let state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const deployer = state.deployer
  const agent = state["app:aragon-agent"].proxy.address

  await transferOZAdmin('Burner', state.burner.address, deployer, agent)
  await transferOZAdmin('HashConsensus', state.hashConsensusForAccountingOracle.address, deployer, agent)
  await transferOZAdmin('HashConsensus', state.hashConsensusForValidatorsExitBusOracle.address, deployer, agent)
  await transferOZAdmin('StakingRouter', state.stakingRouter.proxy.address, deployer, agent)
  await transferOZAdmin('AccountingOracle', state.accountingOracle.proxy.address, deployer, agent)
  await transferOZAdmin('ValidatorsExitBusOracle', state.validatorsExitBusOracle.proxy.address, deployer, agent)
  await transferOZAdmin('WithdrawalQueueERC721', state.withdrawalQueueERC721.proxy.address, deployer, agent)
  await transferOZAdmin('OracleDaemonConfig', state.oracleDaemonConfig.address, deployer, agent)
  await transferOZAdmin('OracleReportSanityChecker', state.oracleReportSanityChecker.address, deployer, agent)

  await changeOssifiableProxyAdmin(state.lidoLocator.proxy.address, deployer, agent)
  await changeOssifiableProxyAdmin(state.stakingRouter.proxy.address, deployer, agent)
  await changeOssifiableProxyAdmin(state.accountingOracle.proxy.address, deployer, agent)
  await changeOssifiableProxyAdmin(state.validatorsExitBusOracle.proxy.address, deployer, agent)
  await changeOssifiableProxyAdmin(state.withdrawalQueueERC721.proxy.address, deployer, agent)

  if (state.depositSecurityModule.deployParameters.usePredefinedAddressInstead === null) {
    await changeDepositSecurityModuleAdmin(state.depositSecurityModule.address, deployer, agent)
  }

  await TotalGasCounter.incrementTotalGasUsedInStateFile()
}

module.exports = runOrWrapScript(deployNewContracts, module)
