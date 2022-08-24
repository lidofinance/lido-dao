const { artifacts, contract } = require('hardhat')
const { bn, ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const { assertBn, assertEvent, assertRevert } = require('@aragon/contract-helpers-test/src/asserts')
const { getEvents } = require('@aragon/contract-helpers-test/src/events')

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

  const newToken = async (amount) => {
    await stETH.approve(withdrawal.address, amount, { from: user })
    return getEvents(await withdrawal.request(amount, { from: user }), 'Requested')[0].args.tokenId
  }

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

    const receipt = await withdrawal.request(amount, { from: user })

    // How to parse ERC20 Transfer from receipt ?
    // assertEvent(receipt, 'Transfer', { expectedArgs: { from: user, to: withdrawal,  value: amount }})

    assertEvent(receipt, 'Requested', { expectedArgs: { owner: user, tokenId: nextTokenId, amount } })
    assertBn(await withdrawal.ownerOf(nextTokenId), user)
    assertBn(await withdrawal.nextTokenId(), +nextTokenId + 1)
    assertBn(await stETH.balanceOf(withdrawal.address), amount.add(balanceBefore))
    assertBn(await withdrawal.lockedStETHAmount(), amount.add(bn(lockedStETHBefore)))
  })

  it('One can redeem token for ETH', async () => {
    const amount = ETH(1)
    const tokenId = await newToken(amount)
    await withdrawal.handleOracleReport() // make ETH redeemable

    const receipt = await withdrawal.redeem(tokenId, { from: user })

    assertEvent(receipt, 'Redeemed', { expectedArgs: { owner: user, tokenId, amount: amount } })
  })

  it('One cant redeem non-redeemable token', async () => {
    await assertRevert(withdrawal.redeem(await newToken(ETH(1)), { from: user }), 'TOKEN_NOT_REDEEMABLE')
  })

  it("One cant withdraw other guy's ETH", async () => {
    const tokenId = await newToken(ETH(1))
    await withdrawal.handleOracleReport()
    await assertRevert(withdrawal.redeem(tokenId, { from: deployer }), 'SENDER_NOT_OWNER')
  })

  it('One cant withdraw ETH two times', async () => {
    const tokenId = await newToken(ETH(1))
    await withdrawal.handleOracleReport()
    await withdrawal.redeem(tokenId, { from: user })

    await assertRevert(withdrawal.redeem(tokenId, { from: user }), 'ERC721: owner query for nonexistent token')
  })

  it('Cant withdraw dust', async () => await assertRevert(newToken(ETH(0.01)), 'NO_DUST_WITHDRAWAL'))

  // TODO: Add some ERC721 acceptance tests
})
