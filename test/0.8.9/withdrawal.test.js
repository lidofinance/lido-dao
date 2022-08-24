const { artifacts, contract } = require('hardhat')
const { bn, ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const { assertBn, assertEvent, assertRevert } = require('@aragon/contract-helpers-test/src/asserts')

const Withdrawal = artifacts.require('Withdrawal.sol')
const ERC20OZMock = artifacts.require('ERC20OZMock.sol')
const Setup = artifacts.require('withdrawal/Setup.sol')

const ETH = (value) => bn(web3.utils.toWei(value + '', 'ether'))

contract('Withdrawal', ([deployer, user]) => {
  console.log('Addresses:')
  console.log(`Deployer: ${deployer}`)
  console.log(`User: ${user}`)

  let withdrawal
  let stETH

  beforeEach('Deploy Withdrawal', async () => {
    totalERC20Supply = ETH(10)
    stETH = await ERC20OZMock.new(totalERC20Supply, { from: user })

    const setup = await Setup.new(stETH.address, { from: deployer })

    withdrawal = await Withdrawal.at(await setup.withdrawal())
  })

  it('One can enqueue stEth to Withdrawal and get an NFT', async () => {
    const amount = ETH(1)
    const lockedStETHBefore = await withdrawal.lockedStETHAmount()
    const balanceBefore = await stETH.balanceOf(withdrawal.address)
    const nextTokenId = await withdrawal.nextTokenId()

    await stETH.approve(withdrawal.address, amount, { from: user })

    const receipt = await withdrawal.enqueue(amount, { from: user })

    console.log(receipt.logs)

    // How to parse ERC20 Transfer from receipt ?
    // assertEvent(receipt, 'Transfer', { expectedArgs: { from: user, to: withdrawal,  value: amount }})

    assertEvent(receipt, 'StETHQueued', { expectedArgs: { owner: user, id: nextTokenId, amount } })
    assertBn(await withdrawal.ownerOf(nextTokenId), user)
    assertBn(await withdrawal.nextTokenId(), +nextTokenId + 1)
    assertBn(await stETH.balanceOf(withdrawal.address), amount.add(balanceBefore))
    assertBn(await withdrawal.lockedStETHAmount(), amount.add(bn(lockedStETHBefore)))
  })

  it('Cant witdraw dust', async () => {
    const amount = ETH(0.01)

    await stETH.approve(withdrawal.address, amount, { from: user })

    assertRevert(withdrawal.enqueue(amount, { from: user }), 'NO_DUST_WITHDRAWAL')
  })
})
