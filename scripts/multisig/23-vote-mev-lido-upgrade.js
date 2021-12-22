const { hash: namehash } = require('eth-ens-namehash')
const { encodeCallScript } = require('@aragon/contract-helpers-test/src/aragon-os')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')
const { resolveEnsAddress } = require('../components/ens')

const { APP_NAMES } = require('./constants')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = [
  'lidoApmEnsName',
  'ensAddress',
  'daoAddress',
  `app:${APP_NAMES.ARAGON_VOTING}`,
  `app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`
]

async function upgradeAppImpl({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  // TODO: update assertRequiredNetworkState: remove nos, add mev, require for rewards emulator
  assertRequiredNetworkState(state, REQUIRED_NET_STATE.concat(['app:lido', 'app:node-operators-registry']))

  logSplitter()

  const ens = await artifacts.require('ENS').at(state.ensAddress)
  const votingAddress = state[`app:${APP_NAMES.ARAGON_VOTING}`].proxyAddress
  const tokenManagerAddress = state[`app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`].proxyAddress
  const voting = await artifacts.require('Voting').at(votingAddress)
  const tokenManager = await artifacts.require('TokenManager').at(tokenManagerAddress)
  const kernel = await artifacts.require('Kernel').at(state.daoAddress)
  const aclAddress = await kernel.acl()
  const acl = await artifacts.require('ACL').at(aclAddress)
  const lidoAddress = state[`app:lido`].proxyAddress
  const lido = await artifacts.require('Lido').at(lidoAddress)
  const mevTxFeeVaultAddress = state.mevTxFeeVaultAddress

  log(`Using ENS:`, yl(state.ensAddress))
  log(`TokenManager address:`, yl(tokenManagerAddress))
  log(`Voting address:`, yl(votingAddress))
  log(`Kernel`, yl(kernel.address))
  log(`ACL`, yl(acl.address))

  log.splitter()

  const lidoUpgradeCallData = await buildUpgradeTransaction('lido', state, ens, kernel)

  const grantRoleCallData = {
    to: aclAddress,
    calldata: await acl.contract.methods
      .createPermission(
        votingAddress,
        state[`app:lido`].proxyAddress,
        web3.utils.soliditySha3('SET_MEV_TX_FEE_VAULT_ROLE'),
        votingAddress
      )
      .encodeABI()
  }

  const setMevTxFeeVaultToLidoCallData = {
    to: lidoAddress,
    calldata: await lido.contract.methods.setMevTxFeeVault(mevTxFeeVaultAddress).encodeABI()
  }

  const encodedUpgradeCallData = encodeCallScript([
    ...lidoUpgradeCallData,
    grantRoleCallData,
    setMevTxFeeVaultToLidoCallData,
  ])

  log(`encodedUpgradeCallData:`, yl(encodedUpgradeCallData))
  const votingCallData = encodeCallScript([
    {
      to: votingAddress,
      calldata: await voting.contract.methods.forward(encodedUpgradeCallData).encodeABI()
    }
  ])

  const txName = `tx-23-deploy-mev-lido-upgrade.json`
  const votingDesc = `1) Publishing new implementation in lido app APM repo
2) Updating implementaion of lido app with new one
3) Grant role SENT_MEV_TX_FEE_VAULT_ROLE to voting
4) Set deployed MevTxFeeVault to Lido contract
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

async function buildUpgradeTransaction(appName, state, ens, kernel) {
  const appId = namehash(`${appName}.${state.lidoApmEnsName}`)
  const repoAddress = await resolveEnsAddress(artifacts, ens, appId)
  const newContractAddress = state[`app:${appName}`].baseAddress
  const newContentURI = state[`app:${appName}`].contentURI
  const repo = await artifacts.require('Repo').at(repoAddress)
  const APP_BASES_NAMESPACE = await kernel.APP_BASES_NAMESPACE()

  const { semanticVersion: currentVersion, contractAddress: currentContractAddress, contentURI: currentContentURI } = await repo.getLatest()

  const versionFrom = currentVersion.map((n) => n.toNumber())
  currentVersion[0] = currentVersion[0].addn(1)
  const versionTo = currentVersion.map((n) => n.toNumber())

  log.splitter()

  log(`Upgrading app:`, yl(appName))
  log(`App ID:`, yl(appId))
  log(`Contract implementation:`, yl(currentContractAddress), `->`, yl(newContractAddress))
  log(`Content URI:`, yl(currentContentURI), `->`, yl(newContentURI))
  log(`Bump version:`, yl(versionFrom.join('.')), `->`, yl(versionTo.join('.')))
  log(`Repo:`, yl(repoAddress))
  log(`APP_BASES_NAMESPACE`, yl(APP_BASES_NAMESPACE))

  log.splitter()
  const upgradeCallData = [
    {
      // repo.newVersion(versionTo, contractAddress, contentURI)
      to: repoAddress,
      calldata: await repo.contract.methods.newVersion(versionTo, newContractAddress, newContentURI).encodeABI()
    },

    {
      // kernel.setApp(APP_BASES_NAMESPACE, appId, oracle)
      to: state.daoAddress,
      calldata: await kernel.contract.methods.setApp(APP_BASES_NAMESPACE, appId, newContractAddress).encodeABI()
    }
  ]

  return upgradeCallData
}

module.exports = runOrWrapScript(upgradeAppImpl, module)
