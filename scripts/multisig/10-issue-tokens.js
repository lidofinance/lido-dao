const path = require('path')
const chalk = require('chalk')
const { assert } = require('chai')
const { getEvents } = require('@aragon/contract-helpers-test')
const { hash: namehash } = require('eth-ens-namehash')
const { toChecksumAddress } = require('web3-utils')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log } = require('../helpers/log')
const { assertLastEvent } = require('../helpers/events')
const { readNetworkState, persistNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { saveCallTxData } = require('../helpers/tx-data')
const { resolveLatestVersion: apmResolveLatest } = require('../components/apm')

const { APP_NAMES } = require('./constants')
const VALID_APP_NAMES = Object.entries(APP_NAMES).map((e) => e[1])

const REQUIRED_NET_STATE = [
  'daoAddress',
  'daoTemplateAddress',
  'vestingParams'
]

const MAX_HOLDERS_IN_ONE_TX = 30

async function issueTokens({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  log.splitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  log.splitter()
  log(`Using LidoTemplate: ${chalk.yellow(state.daoTemplateAddress)}`)
  const template = await artifacts.require('LidoTemplate').at(state.daoTemplateAddress)
  await assertLastEvent(template, 'TmplDAOAndTokenDeployed')
  log.splitter()

  const { vestingParams: vesting } = state

  log(`Using vesting settings:`)
  log(`  Start:`, chalk.yellow(formatDate(vesting.start)))
  log(`  Cliff:`, chalk.yellow(formatDate(vesting.cliff)))
  log(`  End:`, chalk.yellow(formatDate(vesting.end)))
  log(`  Revokable:`, chalk.yellow(vesting.revokable))
  log(`  Token receivers (total ${chalk.yellow(vesting.holders.length)}):`)

  vesting.holders.forEach((addr, i) => {
    log(`    ${addr}: ${chalk.yellow(web3.utils.fromWei(vesting.amounts[i], 'ether'))}`)
  })

  log(`  Unvested tokens amount:`, chalk.yellow(vesting.unvestedTokensAmount))

  log.splitter()

  const holdersInOneTx = Math.min(MAX_HOLDERS_IN_ONE_TX, vesting.holders.length)
  const totalTxes = Math.ceil(vesting.holders.length / holdersInOneTx)

  log(`Total batches:`, chalk.yellow(totalTxes))

  for (let i = 0; i < totalTxes; ++i) {
    const startIndex = i * holdersInOneTx
    await saveCallTxData(
      `issueTokens (batch ${i + 1})`,
      template,
      'issueTokens',
      `tx-05-${i + 1}-issue-tokens.json`,
      {
        arguments: [
          vesting.holders.slice(startIndex, startIndex + holdersInOneTx),
          vesting.amounts.slice(startIndex, startIndex + holdersInOneTx),
          vesting.start,
          vesting.cliff,
          vesting.end,
          vesting.revokable
        ],
        from: state.multisigAddress
      }
    )
  }
}

function formatDate(unixTimestamp) {
  return new Date(unixTimestamp * 1000).toUTCString()
}

module.exports = runOrWrapScript(issueTokens, module)
