const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr, OK } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const REQUIRED_NET_STATE = [
  "app:aragon-agent",
  "accountingOracle",
  "burner",
  "daoInitialSettings",
  "hashConsensusForAccounting",
  "hashConsensusForValidatorsExitBus",
  "lidoLocator",
  "stakingRouter",
  "validatorsExitBusOracle",
  "withdrawalQueueERC721",
]

const DEFAULT_ADMIN_ROLE = "0x00"


async function transferOZAdmin(contractName, contractAddress, currentAdmin, newAdmin) {
  console.log(`Transferring OZ admin of ${contractAddress} from ${currentAdmin} to ${newAdmin}:`)
  const contract = await artifacts.require(contractName).at(contractAddress)
  await log.makeTx(contract, 'grantRole', [DEFAULT_ADMIN_ROLE, newAdmin], { from: currentAdmin })
  await log.makeTx(contract, 'renounceRole', [DEFAULT_ADMIN_ROLE, currentAdmin], { from: currentAdmin })
  console.log()
}

async function changeOssifiableProxyAdmin(contractAddress, currentAdmin, newAdmin) {
  console.log(`Transferring OssifiableProxy admin of ${contractAddress} from ${currentAdmin} to ${newAdmin}...`)
  const contract = await artifacts.require('OssifiableProxy').at(contractAddress)
  await log.makeTx(contract, 'proxy__changeAdmin', [newAdmin], { from: currentAdmin })
  console.log()
}

async function changeDepositSecurityModuleAdmin(contractAddress, currentAdmin, newAdmin) {
  console.log(`Changing DepositSecurityModule owner of ${contractAddress} from ${currentAdmin} to ${newAdmin}...`)
  const depositSecurityModule = await artifacts.require('DepositSecurityModule').at(contractAddress)
  await log.makeTx(depositSecurityModule, 'setOwner', [newAdmin], { from: currentAdmin } )
  console.log()
}

async function deployNewContracts({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()
  logWideSplitter()
  log(`Network ID:`, yl(netId))

  let state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const owner = state.owner
  const agent = state["app:aragon-agent"].proxy.address

  await transferOZAdmin('Burner', state.burner.address, owner, agent)
  await transferOZAdmin('HashConsensus', state.hashConsensusForAccounting.address, owner, agent)
  await transferOZAdmin('HashConsensus', state.hashConsensusForValidatorsExitBus.address, owner, agent)
  await transferOZAdmin('StakingRouter', state.stakingRouter.address, owner, agent)
  await transferOZAdmin('AccountingOracle', state.accountingOracle.address, owner, agent)
  await transferOZAdmin('ValidatorsExitBusOracle', state.validatorsExitBusOracle.address, owner, agent)
  await transferOZAdmin('WithdrawalQueueERC721', state.withdrawalQueueERC721.address, owner, agent)

  await changeOssifiableProxyAdmin(state.lidoLocator.address, owner, agent)
  await changeOssifiableProxyAdmin(state.stakingRouter.address, owner, agent)
  await changeOssifiableProxyAdmin(state.accountingOracle.address, owner, agent)
  await changeOssifiableProxyAdmin(state.validatorsExitBusOracle.address, owner, agent)
  await changeOssifiableProxyAdmin(state.withdrawalQueueERC721.address, owner, agent)

  await changeDepositSecurityModuleAdmin(state.depositSecurityModule.address, owner, agent)
}

module.exports = runOrWrapScript(deployNewContracts, module)
