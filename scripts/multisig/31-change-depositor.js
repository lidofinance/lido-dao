const { encodeCallScript } = require('@aragon/contract-helpers-test/src/aragon-os')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES } = require('./constants')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = [
  'lidoApmEnsName',
  'ensAddress',
  'daoAddress',
  'depositorAddress',
  `app:${APP_NAMES.LIDO}`,
  `app:${APP_NAMES.ARAGON_VOTING}`,
  `app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`
]

async function changeDepositor({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  logSplitter()

  const averageBlocksPerSecond = 13.8235 // average speed based on 14700000...14830000 range
  const votingDurationBlocks = Math.floor((60 * 60 * 24 * 3) / averageBlocksPerSecond) // 3 days

  const votingAddress = state[`app:${APP_NAMES.ARAGON_VOTING}`].proxyAddress
  const tokenManagerAddress = state[`app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`].proxyAddress
  const lidoAddress = state[`app:${APP_NAMES.LIDO}`].proxyAddress
  const voting = await artifacts.require('Voting').at(votingAddress)
  const tokenManager = await artifacts.require('TokenManager').at(tokenManagerAddress)
  const kernel = await artifacts.require('Kernel').at(state.daoAddress)
  const aclAddress = await kernel.acl()
  const acl = await artifacts.require('ACL').at(aclAddress)
  const lido = await artifacts.require('Lido').at(lidoAddress)
  const depositRole = await lido.DEPOSIT_ROLE()
  const filter = { app: lidoAddress, role: depositRole }
  const depositRoleEvents = await acl.getPastEvents('SetPermission', { filter, fromBlock: 0 })
  const oldDepositorAddress = depositRoleEvents.sort((a, b) => b.blockNumber - a.blockNumber)[0].returnValues.entity
  const newDepositorAddress = state.depositorAddress
  const newDepositor = await artifacts.require('DepositSecurityModule').at(newDepositorAddress)
  const currentBLock = await await web3.eth.getBlockNumber()
  const newLastDepositBlock = currentBLock + votingDurationBlocks

  log(`Using ENS:`, yl(state.ensAddress))
  log(`TokenManager address:`, yl(tokenManagerAddress))
  log(`Voting address:`, yl(votingAddress))
  log(`Kernel:`, yl(kernel.address))
  log(`ACL:`, yl(acl.address))
  log(`Old Depositor:`, yl(oldDepositorAddress))
  log(`New Depositor:`, yl(newDepositorAddress))
  log(`LastDepositBlock:`, yl(newLastDepositBlock))

  log.splitter()

  const revokeCallData = {
    to: aclAddress,
    calldata: await acl.contract.methods.revokePermission(oldDepositorAddress, state[`app:lido`].proxyAddress, depositRole).encodeABI()
  }

  const grantCallData = {
    to: aclAddress,
    calldata: await acl.contract.methods.grantPermission(newDepositorAddress, state[`app:lido`].proxyAddress, depositRole).encodeABI()
  }

  const setLastBlockCallData = {
    to: newDepositorAddress,
    calldata: await newDepositor.contract.methods.setLastDepositBlock(newLastDepositBlock).encodeABI()
  }

  const encodedUpgradeCallData = encodeCallScript([revokeCallData, grantCallData, setLastBlockCallData])

  log(`encodedUpgradeCallData:`, yl(encodedUpgradeCallData))
  const votingCallData = encodeCallScript([
    {
      to: votingAddress,
      calldata: await voting.contract.methods.forward(encodedUpgradeCallData).encodeABI()
    }
  ])

  const txName = `tx-31-change-depositor.json`
  const votingDesc = `
    1) Revoke permission DEPOSIT_ROLE from ${oldDepositorAddress}
    2) Grant permission DEPOSIT_ROLE to ${newDepositorAddress}
    3) Set last deposit block to ${newLastDepositBlock}
  `

  await saveCallTxData(votingDesc, tokenManager, 'forward', txName, {
    arguments: [votingCallData],
    from: DEPLOYER || state.multisigAddress
  })

  log.splitter()
  log(gr(`Before continuing the deployment, please send all transactions listed above.`))
  log(gr(`You must complete it positively and execute before continuing with the deployment!`))
  log.splitter()
}

module.exports = runOrWrapScript(changeDepositor, module)
