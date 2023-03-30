const { hash: namehash } = require('eth-ens-namehash')
const { encodeCallScript } = require('@aragon/contract-helpers-test/src/aragon-os')
const { BN } = require('bn.js')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')
const { resolveEnsAddress } = require('../components/ens')

const { APP_NAMES } = require('./constants')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = [
  'lidoApmEnsName',
  'ensAddress',
  'daoAddress',
  `app:${APP_NAMES.ARAGON_VOTING}`,
  `app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`,
  'executionLayerRewardsParams'
]

async function createVoting({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE.concat([
    'app:lido',
    'app:node-operators-registry',
    'app:oracle',
    'executionLayerRewardsVaultAddress'
  ]))

  logSplitter()

  const votingAddress = state[`app:${APP_NAMES.ARAGON_VOTING}`].proxyAddress
  const tokenManagerAddress = state[`app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`].proxyAddress
  const voting = await artifacts.require('Voting').at(votingAddress)
  const tokenManager = await artifacts.require('TokenManager').at(tokenManagerAddress)
  const kernel = await artifacts.require('Kernel').at(state.daoAddress)
  const aclAddress = await kernel.acl()
  const acl = await artifacts.require('ACL').at(aclAddress)
  const lidoAddress = state[`app:lido`].proxyAddress
  const lido = await artifacts.require('Lido').at(lidoAddress)
  const elRewardsVaultAddress = state.executionLayerRewardsVaultAddress

  // About the value see https://github.com/lidofinance/lido-dao/issues/405
  const elRewardsWithdrawalLimitPoints = state.executionLayerRewardsParams.withdrawalLimit

  log(`Using ENS:`, yl(state.ensAddress))
  log(`TokenManager address:`, yl(tokenManagerAddress))
  log(`Voting address:`, yl(votingAddress))
  log(`Kernel:`, yl(kernel.address))
  log(`ACL:`, yl(acl.address))
  log(`ELRewardsWithdrawalLimitPoints: `, yl(elRewardsWithdrawalLimitPoints))

  log.splitter()

  const setELRewardsVaultCallData = {
    to: lidoAddress,
    calldata: await lido.contract.methods.setELRewardsVault(elRewardsVaultAddress).encodeABI()
  }

  const setELRewardsWithdrawalLimitCallData = {
    to: lidoAddress,
    calldata: await lido.contract.methods.setELRewardsWithdrawalLimit(elRewardsWithdrawalLimitPoints).encodeABI()
  }

  const encodedUpgradeCallData = encodeCallScript([
    setELRewardsVaultCallData,
    setELRewardsWithdrawalLimitCallData,
  ])

  log(`encodedUpgradeCallData:`, yl(encodedUpgradeCallData))
  const votingCallData = encodeCallScript([
    {
      to: votingAddress,
      calldata: await voting.contract.methods.forward(encodedUpgradeCallData).encodeABI()
    }
  ])

  const txName = `tx-28-vote-el-rewards.json`
  const votingDesc =
`1) Set deployed LidoExecutionLayerRewardsVault to Lido contract
2) Set Execution Layer rewards withdrawal limit to ${elRewardsWithdrawalLimitPoints} basis points`

  await saveCallTxData(votingDesc, tokenManager, 'forward', txName, {
    arguments: [votingCallData],
    from: DEPLOYER || state.multisigAddress
  })

  log.splitter()
  log(gr(`Before continuing the deployment, please send all transactions listed above.`))
  log(gr(`You must complete it positively and execute before continuing with the deployment!`))
  log.splitter()
}


function fromE18ToString(x) {
  return `${(x / 1e18).toFixed(3)} ETH (${x} wei)`
}

module.exports = runOrWrapScript(createVoting, module)
