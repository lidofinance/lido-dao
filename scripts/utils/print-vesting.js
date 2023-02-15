const BN = require('bn.js')
const chalk = require('chalk')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log } = require('../helpers/log')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')

const REQUIRED_NET_STATE = ['vestingParams']

async function printVesting({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  log.splitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  log.splitter()

  const { vestingParams: vesting } = state
  const pairs = Object.entries(vesting.holders)

  pairs.sort((pa, pb) =>
    new BN(pa[1]).lt(new BN(pb[1])) ? 1 : -1
  )

  const holders = pairs.map(p => p[0])
  const amounts = pairs.map(p => p[1])

  log(`Vesting settings:`)
  log(`  Start:`, chalk.yellow(formatDate(vesting.start)))
  log(`  Cliff:`, chalk.yellow(formatDate(vesting.cliff)))
  log(`  End:`, chalk.yellow(formatDate(vesting.end)))
  log(`  Revokable:`, chalk.yellow(vesting.revokable))

  const totalSupply = bigSum(amounts, vesting.unvestedTokensAmount)

  log(`  Token receivers (total ${chalk.yellow(holders.length)}):`)

  holders.forEach((addr, i) => {
    const amount = amounts[i]
    const percentage = +new BN(amount).muln(10000).div(totalSupply) / 100
    log(`    ${addr}: ${chalk.yellow(web3.utils.fromWei(amount, 'ether'))} (${percentage}%)`)
  })

  const unvestedPercentage = +new BN(vesting.unvestedTokensAmount).muln(10000).div(totalSupply) / 100
  log(`  Unvested tokens amount: ${chalk.yellow(web3.utils.fromWei(vesting.unvestedTokensAmount, 'wei'))} (${unvestedPercentage}%)`)
  log(`  Total supply:`, chalk.yellow(web3.utils.fromWei(totalSupply.toString(), 'ether')))

  log.splitter()
}

function bigSum(amounts, initialAmount = 0) {
  const sum = new BN(initialAmount)
  amounts.forEach(amount => {
    sum.iadd(new BN(amount))
  })
  return sum
}

function formatDate(unixTimestamp) {
  return new Date(unixTimestamp * 1000).toUTCString()
}

module.exports = runOrWrapScript(printVesting, module)
