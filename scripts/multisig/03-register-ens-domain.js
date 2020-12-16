const crypto = require('crypto')
const chalk = require('chalk')
const namehash = require('eth-ens-namehash').hash
const keccak256 = require('js-sha3').keccak_256

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { assert } = require('../helpers/assert')
const { log, yl, gr } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const TLD = 'eth'
const CONTROLLER_INTERFACE_ID = '0x018fac06'

const REQUIRED_NET_STATE = [
  'ensAddress',
  'lidoApmRootEnsLabel',
  'lidoApmRootEnsRegDurationSec',
  'lidoApmSubdomainLabel',
  'multisigAddress',
  'daoTemplateAddress'
]

async function deployTemplate({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  log.wideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  log.splitter()

  log(`Using ENS:`, yl(state.ensAddress))
  const ens = await artifacts.require('ENS').at(state.ensAddress)

  const tldNode = namehash(TLD)
  const tldResolverAddr = await ens.resolver(tldNode)

  log(`Using TLD resolver:`, yl(tldResolverAddr))
  const tldResolver = await artifacts.require('IInterfaceResolver').at(tldResolverAddr)

  const controllerAddr = await tldResolver.interfaceImplementer(tldNode, CONTROLLER_INTERFACE_ID)

  log(`Using TLD controller:`, yl(controllerAddr))
  const controller = await artifacts.require('IETHRegistrarController').at(controllerAddr)

  const controllerParams = await Promise.all([
    controller.minCommitmentAge(),
    controller.maxCommitmentAge(),
    controller.MIN_REGISTRATION_DURATION()
  ])

  const [minCommitmentAge, maxCommitmentAge, minRegistrationDuration] = controllerParams.map(x => +x)

  log(`Controller min commitment age: ${yl(minCommitmentAge)} sec`)
  log(`Controller max commitment age: ${yl(maxCommitmentAge)} sec`)
  log(`Controller min registration duration: ${yl(minRegistrationDuration)} sec`)

  log.splitter()

  const rootLabel = state.lidoApmRootEnsLabel
  const rootOwner = state.multisigAddress
  const rootRegDuration = state.lidoApmRootEnsRegDurationSec
  const rootDomain = `${rootLabel}.${TLD}`
  const rootNode = namehash(rootDomain)

  const subLabel = state.lidoApmSubdomainLabel
  const subOwner = state.daoTemplateAddress
  const subdomain = `${subLabel}.${rootDomain}`
  const subNode = namehash(subdomain)

  log(`ENS root domain: ${yl(`${rootDomain}`)} (${rootNode})`)
  log(`ENS root domain owner:`, yl(rootOwner))
  log(`ENS root domain registration duration: ${yl(rootRegDuration)} sec`)

  log(`ENS subdomain: ${yl(subdomain)} (${subNode})`)
  log(`ENS subdomain owner:`, yl(subOwner))

  log.splitter()

  assert.log(
    assert.isTrue,
    await controller.available(rootLabel),
    `the root domain is available`
  )

  assert.log(
    assert.isAtLeast,
    rootRegDuration,
    minRegistrationDuration,
    `registration duration is at least the minimum one`
  )

  log.splitter()

  const salt = '0x' + crypto.randomBytes(32).toString('hex')
  log(`Using salt:`, yl(salt))

  const commitment = await controller.makeCommitment(rootLabel, rootOwner, salt)
  log(`Using commitment:`, yl(commitment))

  const rentPrice = await controller.rentPrice(rootLabel, rootRegDuration)
  log(`Rent price:`, yl(`${web3.utils.fromWei(rentPrice, 'ether')} ETH`))

  // increasing by 15% to account for price fluctuation; the difference will be refunded
  const registerTxValue = rentPrice.muln(115).divn(100)
  log(`Register TX value:`, yl(`${web3.utils.fromWei(registerTxValue, 'ether')} ETH`))

  log.splitter()

  await saveCallTxData(`commit`, controller, 'commit', `tx-02-1-commit-ens-registration.json`, {
    arguments: [commitment],
    from: state.multisigAddress
  })

  await saveCallTxData(`register`, controller, 'register', `tx-02-2-make-ens-registration.json`, {
    arguments: [rootLabel, rootOwner, rootRegDuration, salt],
    from: state.multisigAddress,
    value: '0x' + registerTxValue.toString(16),
    estimateGas: false // estimation will fail since no commitment is actually made yet
  })

  await saveCallTxData(`setSubnodeOwner`, ens, 'setSubnodeOwner', `tx-02-3-create-subdomain.json`, {
    arguments: [rootNode, '0x' + keccak256(subLabel), subOwner],
    from: state.multisigAddress,
    estimateGas: false // estimation will fail since root domain is not registered yet
  })

  log.splitter()
  log(gr(`Before continuing the deployment, please send all transactions listed above`))
  log(gr(`from the multisig address ${yl(state.multisigAddress)}.\n`))
  log(gr(`Make sure to send the second transaction at least ${yl(minCommitmentAge)} seconds after the`))
  log(gr(`first one is included in a block, but no more than ${yl(maxCommitmentAge)} seconds after that.`))
  log.splitter()

  persistNetworkState(network.name, netId, state, {
    lidoApmEnsName: subdomain
  })
}

module.exports = runOrWrapScript(deployTemplate, module)
