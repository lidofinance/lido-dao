const { artifacts } = require('hardhat')

const { ETH } = require('../helpers/utils')
const withdrawals = require('../helpers/withdrawals')

const StETHMock = artifacts.require('StETHMock.sol')
const WstETH = artifacts.require('WstETHMock.sol')

async function deployWithdrawalQueue({
  stethOwner,
  queueOwner,
  queuePauser,
  queueResumer,
  queueFinalizer,
  queueBunkerReporter,
  queueName = 'Unsteth nft',
  symbol = 'UNSTETH'
}) {
  const steth = await StETHMock.new({ value: ETH(1), from: stethOwner })
  const wsteth = await WstETH.new(steth.address, { from: stethOwner })

  const { queue: withdrawalQueue } = await withdrawals.deploy(queueOwner, wsteth.address, queueName, symbol)

  await withdrawalQueue.initialize(
    queueOwner,
    queuePauser,
    queueResumer,
    queueFinalizer || steth.address,
    queueBunkerReporter || steth.address
  )
  await withdrawalQueue.resume({ from: queueOwner })

  return {
    steth,
    wsteth,
    withdrawalQueue
  }
}

module.exports = {
  deployWithdrawalQueue
}
