const { encodeCallScript } = require('@aragon/contract-helpers-test/src/aragon-os')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const { APP_NAMES, APP_ARTIFACTS } = require('./constants')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = [
  'lidoApmEnsName',
  'ensAddress',
  'daoAddress',
  'compositePostRebaseBeaconReceiverAddress',
  'selfOwnedStETHBurnerAddress',
  `app:${APP_NAMES.ARAGON_VOTING}`,
  `app:${APP_NAMES.ORACLE}`,
  `app:${APP_NAMES.LIDO}`,
  `app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`
]

const padWithoutPrefix = (hex, bytesLength) => {
  const absentZeroes = bytesLength * 2 + 2 - hex.length
  if (absentZeroes > 0) hex = '0'.repeat(absentZeroes) + hex.substr(2)
  return hex
}

const composePermissionParam = (addr) => {
  const argId = '0x00' // arg 0
  const op = '01' // operation eq (Op.Eq == 1)
  const value = padWithoutPrefix(addr, 240 / 8) // pad 160bit -> 240bit, remove '0x'
  assert.equal(value.length, (240 / 8) * 2) // check the value length explicitly

  const paramStr = `${argId}${op}${value}`
  assert.equal(paramStr.length, (256 / 8) * 2 + 2)

  return paramStr
}

async function setupCoverageMechanismImpl({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  logSplitter()

  const voting = await artifacts.require('Voting')
    .at(state[`app:${APP_NAMES.ARAGON_VOTING}`].proxyAddress)
  const tokenManager = await artifacts.require('TokenManager')
    .at(state[`app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`].proxyAddress)
  const kernel = await artifacts.require('Kernel')
    .at(state.daoAddress)
  const acl = await artifacts.require('ACL')
    .at(await kernel.acl())
  const compositePostRebaseBeaconReceiver = await artifacts.require('CompositePostRebaseBeaconReceiver')
    .at(state.compositePostRebaseBeaconReceiverAddress)
  const selfOwnedStETHBurner = await artifacts.require('SelfOwnedStETHBurner')
    .at(state.selfOwnedStETHBurnerAddress)
  const lidoOracle = await artifacts.require(`${APP_ARTIFACTS.oracle}`)
    .at(state[`app:${APP_NAMES.ORACLE}`].proxyAddress)
  const lido = await artifacts.require(`${APP_ARTIFACTS.lido}`)
    .at(state[`app:${APP_NAMES.LIDO}`].proxyAddress)

  log(`Voting address:`, yl(voting.address))
  log(`TokenManager address:`, yl(tokenManager.address))
  log(`Kernel address:`, yl(kernel.address))
  log(`ACL address:`, yl(acl.address))
  log(`CompositePostRebaseBeaconReceiver address`, yl(compositePostRebaseBeaconReceiver.address))
  log(`SelfOwnedStETHBurner`, yl(selfOwnedStETHBurner.address))
  log(`LidoOracle address:`, yl(lidoOracle.address))
  log(`Lido address`, yl(lido.address))

  log.splitter()

  const wrapStETHBurnerIntoCompositeCallData = {
    to: compositePostRebaseBeaconReceiver.address,
    calldata: await compositePostRebaseBeaconReceiver.contract.methods
      .addCallback(
        selfOwnedStETHBurner.address
      )
      .encodeABI()
  }

  const setupCompositeAsReceiverCallData = {
    to: lidoOracle.address,
    calldata: await lidoOracle.contract.methods
      .setBeaconReportReceiver(
          compositePostRebaseBeaconReceiver.address
      )
      .encodeABI()
  }

  const burnRoleHash = await lido.BURN_ROLE()
  log(`BURN_ROLE hash:`, yl(burnRoleHash))

  const revokeBurnPermissionsFromVotingCallData = {
    to: acl.address,
    calldata: await acl.contract.methods
      .revokePermission(
        voting.address,
        lido.address,
        burnRoleHash
      )
      .encodeABI()
  }

  const permParam = composePermissionParam(selfOwnedStETHBurner.address)
  log(`Permission param:`, yl(permParam))

  const grantGranularBurnPermissionsToStETHBurner = {
    to: acl.address,
    calldata: await acl.contract.methods
      .grantPermissionP(
        selfOwnedStETHBurner.address,
        lido.address,
        burnRoleHash,
        [permParam]
      )
      .encodeABI()
  }

  const encodedSetupCallData = encodeCallScript([
    wrapStETHBurnerIntoCompositeCallData,
    setupCompositeAsReceiverCallData,
    revokeBurnPermissionsFromVotingCallData,
    grantGranularBurnPermissionsToStETHBurner
  ])

  log(`encodedSetupCallData:`, yl(encodedSetupCallData))
  const votingCallData = encodeCallScript([
    {
      to: voting.address,
      calldata: await voting.contract.methods.forward(encodedSetupCallData).encodeABI()
    }
  ])

  const txName = `tx-25-vote-self-owned-steth-burner.json`
  const votingDesc = `
    1) Wrap stETH burner into the composite receiver
    2) Attach composite receiver to lido oracle as beacon report callback
    3) Revoke 'BURN_ROLE' permissions from Voting
    4) Grant 'BURN_ROLE' constrained permissions to stETH burner
  `

  await saveCallTxData(votingDesc, tokenManager, 'forward', txName, {
      arguments: [votingCallData],
      from: DEPLOYER || state.multisigAddress
  })

  log.splitter()
  log(gr(`Before continuing the deployment, please send all transactions listed above.`))
  log(gr(`You MUST complete it positively and execute before continuing with the deployment!`))
  log.splitter()
}

module.exports = runOrWrapScript(setupCoverageMechanismImpl, module)
