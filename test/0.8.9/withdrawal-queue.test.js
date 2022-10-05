const { artifacts, contract } = require('hardhat')
const { bn } = require('@aragon/contract-helpers-test')
const { assertBn, assertRevert } = require('@aragon/contract-helpers-test/src/asserts')

const WithdrawalQueue = artifacts.require('WithdrawalQueue.sol')

contract('WithdrawalQueue', ([deployer, owner, holder, stranger]) => {
  console.log('Addresses:')
  console.log(`Deployer: ${deployer}`)
  console.log(`Owner: ${owner}`)

  let withdrawal

  beforeEach('Deploy', async () => {
    withdrawal = await WithdrawalQueue.new(owner)
  })

  context('Create a ticket', async () => {
    let ticketId

    beforeEach('Read some state', async () => {
      ticketId = await withdrawal.queueLength()
    })

    it('Owner can create a ticket', async () => {
      await withdrawal.createTicket(holder, 1, 1, { from: owner })

      assertBn(await withdrawal.holderOf(ticketId), holder)
      assertBn(await withdrawal.queueLength(), +ticketId + 1)
      assert(ticketId >= (await withdrawal.finalizedQueueLength()))
      const ticket = await withdrawal.queue(ticketId)
      assert.equal(ticket[0], holder)
      assertBn(ticket[1], bn(1))
      assertBn(ticket[2], bn(1))
    })

    it('Only owner can create a ticket', async () => {
      await assertRevert(withdrawal.createTicket(holder, 1, 1, { from: stranger }), 'NOT_OWNER')
      await assertRevert(withdrawal.holderOf(ticketId), 'TICKET_NOT_FOUND')

      assertBn(await withdrawal.queueLength(), ticketId)
    })
  })

  context('Finalization', async () => {
    let ticketId
    let amountOfStETH
    const amountOfShares = 1
    beforeEach('Create a ticket', async () => {
      amountOfStETH = 100
      ticketId = await withdrawal.queueLength()
      await withdrawal.createTicket(holder, amountOfStETH, amountOfShares, { from: owner })
    })

    it('Only owner can finalize a ticket', async () => {
      await withdrawal.finalizeTickets(0, amountOfStETH, amountOfShares, { from: owner, value: amountOfStETH })
      await assertRevert(
        withdrawal.finalizeTickets(0, amountOfStETH, amountOfShares, { from: stranger, value: amountOfStETH }),
        'NOT_OWNER'
      )
    })

    it('One cannot finalize tickets with no ether', async () => {
      await assertRevert(
        withdrawal.finalizeTickets(0, amountOfStETH, amountOfShares, { from: owner, value: amountOfStETH - 1 }),
        'NOT_ENOUGH_ETHER'
      )
    })

    it('One can finalize tickets with discount', async () => {
      shares = 2
      withdrawal.finalizeTickets(0, amountOfStETH, shares, { from: owner, value: 50 })
    })
  })

  context('Withdraw', async () => {
    let ticketId
    beforeEach('Create a ticket', async () => {
      ticketId = await withdrawal.queueLength()
      await withdrawal.createTicket(holder, 100, 1, { from: owner })
    })

    it('One cant withdraw not finalized ticket', async () => {
      await assertRevert(withdrawal.withdraw(ticketId, { from: owner }), 'TICKET_NOT_FINALIZED')
    })

    it('Anyone can withdraw a finalized token', async () => {
      const balanceBefore = bn(await web3.eth.getBalance(holder))
      await withdrawal.finalizeTickets(0, 100, 1, { from: owner, value: 100 })

      await withdrawal.withdraw(ticketId, { from: stranger })

      assertBn(await web3.eth.getBalance(holder), balanceBefore.add(bn(100)))
    })

    it('Cant withdraw token two times', async () => {
      await withdrawal.finalizeTickets(0, 100, 1, { from: owner, value: 100 })
      await withdrawal.withdraw(ticketId)

      await assertRevert(withdrawal.withdraw(ticketId, { from: stranger }), 'TICKET_NOT_FOUND')
    })

    it('Discounted withdrawals produce less eth', async () => {
      const balanceBefore = bn(await web3.eth.getBalance(holder))
      await withdrawal.finalizeTickets(0, 50, 1, { from: owner, value: 50 })

      await withdrawal.withdraw(ticketId, { from: stranger })

      assertBn(await web3.eth.getBalance(holder), balanceBefore.add(bn(50)))
    })
  })
})
