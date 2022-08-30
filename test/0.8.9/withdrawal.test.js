const { artifacts, contract } = require('hardhat')
const { bn } = require('@aragon/contract-helpers-test')
const { assertBn, assertEvent, assertRevert } = require('@aragon/contract-helpers-test/src/asserts')
const { getEvents } = require('@aragon/contract-helpers-test/src/events')
const { forceTransfer } = require('./helpers/transfer')

const Withdrawal = artifacts.require('Withdrawal.sol')
const ERC20OZMock = artifacts.require('ERC20OZMock.sol')

const ETH = (value) => bn(web3.utils.toWei(value + '', 'ether'))
const tokens = ETH

contract('Withdrawal', ([deployer, user, stranger]) => {
  console.log('Addresses:')
  console.log(`Deployer: ${deployer}`)
  console.log(`User: ${user}`)

  let withdrawal
  let stETH

  beforeEach('Deploy Withdrawal', async () => {
    totalERC20Supply = tokens(10)
    stETH = await ERC20OZMock.new(totalERC20Supply, { from: user })

    // unlock stETH account (allow transactions originated from stETH.address)
    await ethers.provider.send('hardhat_impersonateAccount', [stETH.address])

    withdrawal = await Withdrawal.new(stETH.address)

    forceTransfer(withdrawal.address, ETH(10))
  })

  context('Request', async () => {
    let amount, lockedStETHBefore, balanceBefore, ticketId

    beforeEach('Read some state', async () => {
      amount = tokens(1)
      lockedStETHBefore = await withdrawal.lockedStETHAmount()
      balanceBefore = await stETH.balanceOf(withdrawal.address)
      ticketId = await withdrawal.nextTicketId()
    })

    it('Lido can request withdrawal and get a ticket', async () => {
      const receipt = await withdrawal.request(user, amount, { from: stETH.address })

      assertEvent(receipt, 'WithdrawalRequested', { expectedArgs: { owner: user, ticketId, amountOfStETH: amount } })
      assertBn(await withdrawal.ownerOf(ticketId), user)
      assertBn(await withdrawal.nextTicketId(), +ticketId + 1)
      assertBn(await stETH.balanceOf(withdrawal.address), balanceBefore)
      assertBn(await withdrawal.lockedStETHAmount(), amount.add(bn(lockedStETHBefore)))
    })

    it('Only Lido can request withdrawal', async () => {
      await assertRevert(withdrawal.request(user, amount, { from: user }), 'NOT_OWNER')

      await assertRevert(withdrawal.ownerOf(ticketId), 'ERC721: owner query for nonexistent token')
      assertBn(await withdrawal.nextTicketId(), ticketId)
      assertBn(await stETH.balanceOf(withdrawal.address), balanceBefore)
      assertBn(await withdrawal.lockedStETHAmount(), lockedStETHBefore)
    })
  })

  context('Withdraw', async () => {
    let ticketId, amount
    beforeEach('Create a ticket', async () => {
      amount = tokens(1)
      const receipt = await withdrawal.request(user, amount, { from: stETH.address })
      ticketId = getEvents(receipt, 'WithdrawalRequested')[0].args.ticketId
    })

    it('One cant redeem not finalized ticket', async () => {
      await assertRevert(withdrawal.cashout(user, ticketId, { from: stETH.address }), 'TICKET_NOT_FINALIZED')
    })

    it('One can redeem token for ETH', async () => {
      const balanceBefore = bn(await web3.eth.getBalance(user))
      await withdrawal.handleOracleReport({ from: stETH.address })

      const receipt = await withdrawal.cashout(user, ticketId, { from: stETH.address })

      assertEvent(receipt, 'Cashout', { expectedArgs: { owner: user, ticketId, amountOfETH: amount } })
      assertBn(await web3.eth.getBalance(user), balanceBefore.add(amount))
    })

    it("Cant redeem other guy's token", async () => {
      await withdrawal.handleOracleReport({ from: stETH.address })

      await assertRevert(withdrawal.cashout(stranger, ticketId, { from: stETH.address }), 'NOT_TICKET_OWNER')
    })

    it('Cant redeem token two times', async () => {
      await withdrawal.handleOracleReport({ from: stETH.address })

      await withdrawal.cashout(user, ticketId, { from: stETH.address })

      await assertRevert(withdrawal.cashout(user, ticketId, { from: stETH.address }), 'ERC721: owner query for nonexistent token')
    })
  })
})
