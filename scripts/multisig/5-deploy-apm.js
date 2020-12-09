const chalk = require('chalk')
const { assert } = require('chai')
const { hash: namehash } = require('eth-ens-namehash')
const keccak256 = require('js-sha3').keccak_256

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const {
  readNetworkState,
  assertRequiredNetworkState,
  persistNetworkState,
} = require('../helpers/persisted-network-state')
const { getENSNodeOwner } = require('../components/ens')

const REQUIRED_NET_STATE = [
  'multisigAddress',
  'daoTemplateAddress',
  'ensAddress',
  'lidoApmEnsName'
]

const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'

async function deployAPM({
  web3,
  artifacts,
  networkStateFile = NETWORK_STATE_FILE
}) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(networkStateFile, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  logSplitter()
  log(`APM ENS domain: ${chalk.yellow(state.lidoApmEnsName)}`)
  log(`Using DAO template: ${chalk.yellow(state.daoTemplateAddress)}`)

  logSplitter('Checking preconditions...')

  const ens = await artifacts.require('ENS').at(state.ensAddress)
  const lidoApmEnsNode = namehash(state.lidoApmEnsName)
  const lidoApmEnsNodeOwner = await getENSNodeOwner(ens, lidoApmEnsNode)
  const checkDesc = `ENS node is owned by the DAO template`

  assert.equal(lidoApmEnsNodeOwner, state.daoTemplateAddress, checkDesc)
  log.success(checkDesc)

  logSplitter()

  const template = await artifacts.require('LidoTemplate3').at(state.daoTemplateAddress)

  const domain = splitDomain(state.lidoApmEnsName)
  const parentHash = namehash(domain.parent)
  const subHash = '0x' + keccak256(domain.sub)

  log(`Parent domain: ${chalk.yellow(domain.parent)} ${parentHash}`)
  log(`Subdomain label: ${chalk.yellow(domain.sub)} ${subHash}`)

  logSplitter()

  await saveCallTxData(`APM deploy`, template, 'deployLidoAPM', `tx-05-deploy-apm.json`, {
    arguments: [ parentHash, subHash ],
    from: state.multisigAddress
  })
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
