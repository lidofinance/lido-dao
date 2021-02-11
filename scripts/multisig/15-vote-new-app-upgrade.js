const { hash: namehash } = require('eth-ens-namehash')
const { encodeCallScript } = require('@aragon/contract-helpers-test/src/aragon-os')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')
const { resolveEnsAddress } = require('../components/ens')

const { APP_NAMES } = require('./constants')
const VALID_APP_NAMES = Object.entries(APP_NAMES).map((e) => e[1])

const APP = process.env.APP || ''
const HOLDER = process.env.HOLDER || ''
const REQUIRED_NET_STATE = [
  'lidoApmEnsName',
  'ensAddress',
  'daoAddress',
  `app:${APP_NAMES.ARAGON_VOTING}`,
  `app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`
]

async function upgradeApp({ web3, artifacts, appName = APP }) {
  if (!appName || !VALID_APP_NAMES.includes(appName)) {
    throw new Error('Wrong app name')
  }

  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE.concat([`app:${appName}`]))

  logSplitter()

  log(`Using ENS:`, yl(state.ensAddress))
  const ens = await artifacts.require('ENS').at(state.ensAddress)
  log.splitter()

  const appId = namehash(`${appName}.${state.lidoApmEnsName}`)
  const repoAddress = await resolveEnsAddress(artifacts, ens, appId)
  const votingAddress = state[`app:${APP_NAMES.ARAGON_VOTING}`].proxyAddress
  const tokenManagerAddress = state[`app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`].proxyAddress

  const kernel = await artifacts.require('Kernel').at(state.daoAddress)
  const repo = await artifacts.require('Repo').at(repoAddress)
  const voting = await artifacts.require('Voting').at(votingAddress)
  const tokenManager = await artifacts.require('TokenManager').at(tokenManagerAddress)

  const APP_BASES_NAMESPACE = await kernel.APP_BASES_NAMESPACE()

  const oldBase = await kernel.getApp(APP_BASES_NAMESPACE, appId)
  const { contractAddress } = await repo.getLatest()
  log(`Upgrading app:`, yl(appName), `appId:`, appId)
  log(`Contract implementation:`, yl(oldBase), `->`, yl(contractAddress))
  log.splitter()
  if (oldBase === contractAddress) {
    throw new Error('No new implementation')
  }

  // encode call to Repo app for newVersion
  const callData1 = encodeCallScript([
    {
      to: state.daoAddress,
      // function newVersion(uint16[] _newSemanticVersion, address _contractAddress, bytes _contentURI)
      calldata: await kernel.contract.methods.setApp(APP_BASES_NAMESPACE, appId, contractAddress).encodeABI()
    }
  ])
  // encode forwarding call from Voting app to app Repo (new Vote will be created under the hood)
  const callData2 = encodeCallScript([
    {
      to: votingAddress,
      calldata: await voting.contract.methods.forward(callData1).encodeABI()
    }
  ])
  // finally forwarding call from TokenManager app to Voting
  await saveCallTxData(`New voting: app ${appName} upgrade`, tokenManager, 'forward', `tx-15-1-create-vote-${appName}-upgrade.json`, {
    arguments: [callData2],
    from: HOLDER || state.multisigAddress
  })

  log.splitter()
  log(gr(`Before continuing the deployment, please send all transactions listed above.\n`))
  log.splitter()

  // persistNetworkState(network.name, netId, state)
}

module.exports = runOrWrapScript(upgradeApp, module)
