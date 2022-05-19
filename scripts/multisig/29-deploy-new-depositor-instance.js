const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveDeployTx } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')
const { assert, strictEqual } = require('../helpers/assert')

const { APP_NAMES } = require('./constants')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = [
  'daoInitialSettings',
  'depositorParams',
  'depositorAddress',
  `app:${APP_NAMES.LIDO}`,
  `app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`
]

function assertParameterIsTheSame(contractValue, stateValue, paramName) {
  // console.log(typeof(contractValue))
  // assert.equal(+contractValue.toString(), stateValue,
  assert.equal(contractValue, stateValue,
    `Value of ${paramName} in state and in the deployed contract differ`)
}

async function upgradeApp({ web3, artifacts }) {
  const appArtifact = 'DepositSecurityModule'
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const lidoAddress = state[`app:${APP_NAMES.LIDO}`].proxyAddress
  log(`Using Lido address:`, yl(lidoAddress))
  const nosAddress = state[`app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`].proxyAddress
  log(`Using NOS address:`, yl(nosAddress))
  const { depositContractAddress } = state.daoInitialSettings.beaconSpec
  log(`Using Deposit Contract:`, yl(depositContractAddress))
  logSplitter()

  const depositor = await artifacts.require(appArtifact).at(state.depositorAddress)

  const { maxDepositsPerBlock, minDepositBlockDistance, pauseIntentValidityPeriodBlocks, quorum, guardians } = state.depositorParams

  const args = [
    lidoAddress,
    depositContractAddress,
    nosAddress,
    netId,
    maxDepositsPerBlock,
    minDepositBlockDistance,
    pauseIntentValidityPeriodBlocks
  ]
  console.log("Constructor arguments (for use for source code verification): " + args.join(' '))

  assertParameterIsTheSame(await depositor.LIDO(), lidoAddress, 'lidoAddress')
  assertParameterIsTheSame(await depositor.DEPOSIT_CONTRACT(), depositContractAddress, 'depositContractAddress')
  assertParameterIsTheSame(await depositor.getMaxDeposits(), maxDepositsPerBlock, 'maxDepositsPerBlock')
  assertParameterIsTheSame(await depositor.getMinDepositBlockDistance(), minDepositBlockDistance, 'minDepositBlockDistance')
  assertParameterIsTheSame(await depositor.getPauseIntentValidityPeriodBlocks(), pauseIntentValidityPeriodBlocks, 'pauseIntentValidityPeriodBlocks')

  // Also check guardians and quorum in state file correspond to the values in the contract
  assertParameterIsTheSame(await depositor.getGuardianQuorum(), quorum, 'quorum')
  assertParameterIsTheSame(await depositor.getGuardians(), guardians, 'guardians')

  await saveDeployTx(appArtifact, `tx-29-deploy-new-depositor-instance.json`, {
    arguments: args,
    from: DEPLOYER || state.multisigAddress
  })
  persistNetworkState(network.name, netId, state, {
    depositorConstructorArgs: args
  })

  logSplitter()
  log(gr(`Before continuing the deployment, please send all contract creation transactions`))
  log(gr(`that you can find in the files listed above. You may use a multisig address`))
  log(gr(`if it supports deploying new contract instances.`))
  logSplitter()
}

module.exports = runOrWrapScript(upgradeApp, module)
