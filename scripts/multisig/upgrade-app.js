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
const BUMP = process.env.BUMP || 'major'
const HOLDER = process.env.HOLDER || ''
const REQUIRED_NET_STATE = [
  'lidoApmEnsName',
  'ensAddress',
  'daoAddress',
  `app:${APP_NAMES.ARAGON_VOTING}`,
  `app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`,
  `app:${APP}`
]

async function upgradeAppImpl({ web3, artifacts, appName = APP }) {
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
  const newContractAddress = state[`app:${appName}`].baseAddress
  const newContentURI = state[`app:${APP}`].contentURI

  const repo = await artifacts.require('Repo').at(repoAddress)
  const voting = await artifacts.require('Voting').at(votingAddress)
  const tokenManager = await artifacts.require('TokenManager').at(tokenManagerAddress)

  const {
    semanticVersion: currentVersion,
    contractAddress: currentContractAddress,
    contentURI: currentContentURI
  } = await repo.getLatest()

  const versionFrom = currentVersion.map((n) => n.toNumber())
  switch (BUMP) {
    case 'patch':
      currentVersion[2] = currentVersion[2].addn(1)
      break
    case 'minor':
      currentVersion[1] = currentVersion[1].addn(1)
      break
    case 'major':
    default:
      currentVersion[0] = currentVersion[0].addn(1)
  }
  const versionTo = currentVersion.map((n) => n.toNumber())

  const txSender = HOLDER || state.multisigAddress

  log(`Upgrading app:`, yl(appName))
  log(`App ID:`, yl(appId))
  log(`Contract implementation:`, yl(currentContractAddress), `->`, yl(newContractAddress))
  log(`Content URI:`, yl(currentContentURI), `->`, yl(newContentURI))
  log(`Bump version:`, yl(versionFrom.join('.')), `->`, yl(versionTo.join('.')))
  log(`Voting address:`, yl(votingAddress))
  log(`TokenManager address:`, yl(tokenManagerAddress))
  log(`Transaction sender:`, yl(txSender))

  log.splitter()

  // encode call to Repo app for newVersion
  const callData1 = encodeCallScript([
    {
      // repo.newVersion(versionTo, contractAddress, contentURI)
      to: repoAddress,
      calldata: await repo.contract.methods.newVersion(
        versionTo,
        newContractAddress,
        newContentURI
      ).encodeABI()
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

  const newVersionDesc = versionTo.join('.')
  const txName = `tx-upgrade-app-${appName}-to-${newVersionDesc}.json`
  const votingDesc = `New voting: upgrade ${appName} to ${newVersionDesc}`

  await saveCallTxData(votingDesc, tokenManager, 'forward', txName, {
    arguments: [callData2],
    from: txSender
  })

  log.splitter()
  log(gr(`Before continuing the deployment, please send all transactions listed above.`))
  log(gr(`A new voting will be created to add a new "${appName}" implementation to Lido APM.`))
  log(gr(`You must complete it positively and execute before continuing with the deployment!`))
  log.splitter()

  // persistNetworkState(network.name, netId, state)
}

module.exports = runOrWrapScript(upgradeAppImpl, module)
