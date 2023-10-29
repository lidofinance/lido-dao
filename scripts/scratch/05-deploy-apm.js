const chalk = require('chalk')
const { assert } = require('chai')
const { hash: namehash } = require('eth-ens-namehash')
const keccak256 = require('js-sha3').keccak_256

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter } = require('../helpers/log')
const { assertNoEvents } = require('../helpers/events')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')
const { getENSNodeOwner } = require('../components/ens')
const { makeTx, TotalGasCounter } = require('../helpers/deploy')

const REQUIRED_NET_STATE = [
  'deployer',
  'lidoTemplate',
  'ens',
  'lidoApmEnsName',
]

async function deployAPM({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const daoTemplateAddress = state.lidoTemplate.address

  logSplitter()
  log(`APM ENS domain: ${chalk.yellow(state.lidoApmEnsName)}`)
  log(`Using DAO template: ${chalk.yellow(daoTemplateAddress)}`)

  const template = await artifacts.require('LidoTemplate').at(daoTemplateAddress)
  if (state.lidoTemplate.deployBlock) {
    log(`Using LidoTemplate deploy block: ${chalk.yellow(state.lidoTemplate.deployBlock)}`)
  }
  log.splitter()
  await assertNoEvents(template, null, state.lidoTemplate.deployBlock)

  const ens = await artifacts.require('ENS').at(state.ens.address)
  const lidoApmEnsNode = namehash(state.lidoApmEnsName)
  const lidoApmEnsNodeOwner = await getENSNodeOwner(ens, lidoApmEnsNode)
  const checkDesc = `ENS node is owned by the DAO template`

  assert.equal(lidoApmEnsNodeOwner, daoTemplateAddress, checkDesc)
  log.success(checkDesc)

  logSplitter()

  const domain = splitDomain(state.lidoApmEnsName)
  const parentHash = namehash(domain.parent)
  const subHash = '0x' + keccak256(domain.sub)

  log(`Parent domain: ${chalk.yellow(domain.parent)} ${parentHash}`)
  log(`Subdomain label: ${chalk.yellow(domain.sub)} ${subHash}`)

  logSplitter()

  const from = state.deployer

  const lidoApmDeployArguments = [parentHash, subHash]
  const receipt = await makeTx(template, 'deployLidoAPM', lidoApmDeployArguments, { from })

  state.lidoApm = {
    ...state.lidoApm,
    deployArguments: lidoApmDeployArguments,
    deployTx: receipt.tx,
  }
  persistNetworkState(network.name, netId, state)

  await TotalGasCounter.incrementTotalGasUsedInStateFile()
}

function splitDomain(domain) {
  const dotIndex = domain.indexOf('.')
  if (dotIndex === -1) {
    throw new Error(`the ENS domain ${domain} is a top-level domain`)
  }
  return {
    sub: domain.substring(0, dotIndex),
    parent: domain.substring(dotIndex + 1)
  }
}

module.exports = runOrWrapScript(deployAPM, module)
