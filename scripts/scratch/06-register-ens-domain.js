const crypto = require('crypto')
const chalk = require('chalk')
const namehash = require('eth-ens-namehash').hash
const keccak256 = require('js-sha3').keccak_256

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { assert } = require('../helpers/assert')
const { log, yl, gr } = require('../helpers/log')
const { makeTx, TotalGasCounter } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const TLD = 'eth'
const CONTROLLER_INTERFACE_ID = '0x018fac06'

const REQUIRED_NET_STATE = [
  'ens',
  'lidoApmEnsName',
  'lidoApmEnsRegDurationSec',
  'deployer',
  'lidoTemplate'
]

async function deployTemplate({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  log.wideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  log.splitter()

  log(`Using ENS:`, yl(state.ens.address))
  const ens = await artifacts.require('ENS').at(state.ens.address)

  const tldNode = namehash(TLD)

  const domainName = state.lidoApmEnsName
  const domainOwner = state.lidoTemplate.address
  const domainRegDuration = state.lidoApmEnsRegDurationSec

  const node = namehash(domainName)

  log(`ENS domain: ${yl(`${domainName}`)} (${node})`)

  const domainParts = domainName.split('.')
  assert.lengthOf(domainParts, 2, `the domain is a second-level domain`)
  assert.equal(domainParts[1], TLD, `the TLD is the expected one`)
  const [domainLabel] = domainParts

  const labelHash = '0x' + keccak256(domainLabel)

  log(`TLD node: ${chalk.yellow(TLD)} (${tldNode})`)
  log(`Label: ${chalk.yellow(domainLabel)} (${labelHash})`)

  if ((await ens.owner(node)) !== state.deployer && (await ens.owner(tldNode)) !== state.deployer) {
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

    const [minCommitmentAge, maxCommitmentAge, minRegistrationDuration] = controllerParams.map((x) => +x)

    log(`Controller min commitment age: ${yl(minCommitmentAge)} sec`)
    log(`Controller max commitment age: ${yl(maxCommitmentAge)} sec`)
    log(`Controller min registration duration: ${yl(formatTimeInterval(minRegistrationDuration))} (${minRegistrationDuration} sec)`)

    log.splitter()

    log(`ENS domain owner:`, yl(domainOwner))
    log(`ENS domain registration duration: ${yl(formatTimeInterval(domainRegDuration))} (${domainRegDuration} sec)`)

    log.splitter()
    assert.log(assert.isTrue, await controller.available(domainLabel), `the domain is available`)
    assert.log(assert.isAtLeast, domainRegDuration, minRegistrationDuration, `registration duration is at least the minimum one`)
    log.splitter()

    const salt = '0x' + crypto.randomBytes(32).toString('hex')
    log(`Using salt:`, yl(salt))

    const commitment = await controller.makeCommitment(domainLabel, domainOwner, salt)
    log(`Using commitment:`, yl(commitment))

    const rentPrice = await controller.rentPrice(domainLabel, domainRegDuration)
    log(`Rent price:`, yl(`${web3.utils.fromWei(rentPrice, 'ether')} ETH`))

    // increasing by 15% to account for price fluctuation; the difference will be refunded
    const registerTxValue = rentPrice.muln(115).divn(100)
    log(`Register TX value:`, yl(`${web3.utils.fromWei(registerTxValue, 'ether')} ETH`))

    log.splitter()

    await makeTx(controller, 'commit', [commitment], { from: state.deployer })

    await makeTx(controller, 'register', [domainLabel, domainOwner, domainRegDuration, salt], {
      from: state.deployer,
      value: '0x' + registerTxValue.toString(16),
    })

    log.splitter()
  } else {
    log(`ENS domain new owner:`, yl(domainOwner))
    if ((await ens.owner(node)) === state.deployer) {
      log(`Transferring name ownership from owner ${chalk.yellow(state.deployer)} to template ${chalk.yellow(domainOwner)}`)
      await makeTx(ens, 'setOwner', [node, domainOwner], { from: state.deployer })
    } else {
      log(`Creating the subdomain and assigning it to template ${chalk.yellow(domainOwner)}`)
      await makeTx(ens, 'setSubnodeOwner', [tldNode, labelHash, domainOwner], { from: state.deployer })
    }

    log.splitter()
  }

  await TotalGasCounter.incrementTotalGasUsedInStateFile()
}

const HOUR = 60 * 60
const DAY = HOUR * 24
const MONTH = DAY * 30
const YEAR = DAY * 365

function formatTimeInterval(sec) {
  if (sec > YEAR) {
    return floor(sec / YEAR, 100) + ' year(s)'
  }
  if (sec > MONTH) {
    return floor(sec / MONTH, 10) + ' month(s)'
  }
  if (sec > DAY) {
    return floor(sec / DAY, 10) + ' day(s)'
  }
  return `${sec} second(s)`
}

function floor(n, mult) {
  return Math.floor(n * mult) / mult
}

module.exports = runOrWrapScript(deployTemplate, module)
