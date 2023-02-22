const { artifacts } = require('hardhat')

const { ETH } = require('../helpers/utils')
const withdrawals = require('../helpers/withdrawals')

const StETHMock = artifacts.require('StETHPermitMock.sol')
const WstETH = artifacts.require('WstETHMock.sol')
const EIP712StETH = artifacts.require('EIP712StETH')

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
  const eip712StETH = await EIP712StETH.new(steth.address, { from: stethOwner })
  await steth.initializeEIP712StETH(eip712StETH.address)

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
