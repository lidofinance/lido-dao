const { artifacts, contract } = require('hardhat')
const { bn } = require('@aragon/contract-helpers-test')
const { assertBn, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')

const Withdrawal = artifacts.require('Withdrawal.sol')
const ERC20OZMock = artifacts.require('ERC20OZMock.sol')
const Setup = artifacts.require('withdrawal/Setup.sol')

const ETH = (value) => bn(web3.utils.toWei(value + '', 'ether'))

contract('Withdrawal', ([deployer, user]) => {
  let withdrawal

  let stETH

  beforeEach('deploy lido with dao', async () => {
    totalERC20Supply = ETH(10)
    stETH = await ERC20OZMock.new(totalERC20Supply, { from: user })

    const setup = await Setup.new(stETH.address, { from: deployer })

    withdrawal = await Withdrawal.at(await setup.withdrawal())
  })

  it('One can enqueue stEth to Withdrawal', async () => {
    const amount = ETH(1)
    const lockedStETHBefore = await withdrawal.lockedStETHAmount()
    const balanceBefore = await stETH.balanceOf(withdrawal.address)

    await stETH.approve(withdrawal.address, amount, { from: user })

    await withdrawal.enqueue(amount, { from: user })

    assertBn(await stETH.balanceOf(withdrawal.address), amount.add(balanceBefore))
    assertBn(await withdrawal.lockedStETHAmount(), amount.add(bn(lockedStETHBefore)))
  })
})
