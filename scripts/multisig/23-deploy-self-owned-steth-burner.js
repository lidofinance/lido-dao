const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveDeployTx } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState }
  = require('../helpers/persisted-network-state')

const { APP_NAMES, APP_ARTIFACTS } = require('./constants')
const { assert } = require('../helpers/assert')

const DEPLOYER = process.env.DEPLOYER || ''

const REQUIRED_NET_STATE = [
  'lidoApmEnsName',
  'ensAddress',
  'daoAddress',
  'compositePostRebaseBeaconReceiverAddress',
  'selfOwnedStETHBurnerParams',
  `app:${APP_NAMES.ARAGON_VOTING}`,
  `app:${APP_NAMES.ORACLE}`,
  `app:${APP_NAMES.ARAGON_AGENT}`
]

async function upgradeApp({ web3, artifacts }) {
  const appArtifact = 'SelfOwnedStETHBurner'
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const votingAddress = state[`app:${APP_NAMES.ARAGON_VOTING}`].proxyAddress
  const lidoOracleAddress = state[`app:${APP_NAMES.ORACLE}`].proxyAddress
  const lidoAddress = state[`app:${APP_NAMES.LIDO}`].proxyAddress
  const treasuryAddress = state[`app:${APP_NAMES.ARAGON_AGENT}`].proxyAddress
  log(`Using Treasury address:`, yl(treasuryAddress))
  log(`Using Lido address:`, yl(lidoAddress))
  log(`Using Voting address:`, yl(votingAddress))

  logSplitter()

  const {
    totalCoverSharesBurnt,
    totalNonCoverSharesBurnt,
    maxBurnAmountPerRunBasisPoints
  } = state.selfOwnedStETHBurnerParams

  log(`Total cover shares burnt / init:`, yl(totalCoverSharesBurnt))
  log(`Total non-cover shares burnt / init:`, yl(totalNonCoverSharesBurnt))
  log(`Burn amount per run quota, basis points / init:`, yl(maxBurnAmountPerRunBasisPoints))

  const lidoInstance = await artifacts.require(`${APP_ARTIFACTS.lido}`).at(lidoAddress)

  assert.addressEqual(await lidoInstance.getOracle(), lidoOracleAddress, 'Lido: wrong oracle address')
  assert.addressEqual(await lidoInstance.getInsuranceFund(), treasuryAddress, 'Lido: wrong treasury address')

  const args = [
    treasuryAddress,
    lidoAddress,
    votingAddress,
    totalCoverSharesBurnt,
    totalNonCoverSharesBurnt,
    maxBurnAmountPerRunBasisPoints
  ]

  await saveDeployTx(appArtifact, `tx-23-deploy-self-owned-steth-burner.json`, {
    arguments: args,
    from: DEPLOYER || state.multisigAddress
  })
  persistNetworkState(network.name, netId, state, {
    selfOwnedStETHBurnerConstructorArgs: args
  })

  logSplitter()
  log(gr(`Before continuing the deployment, please send all contract creation transactions`))
  log(gr(`that you can find in the files listed above. You may use a multisig address`))
  log(gr(`if it supports deploying new contract instances.`))
  logSplitter()
}

module.exports = runOrWrapScript(upgradeApp, module)
