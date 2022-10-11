const { artifacts, contract } = require('hardhat')
const { bn } = require('@aragon/contract-helpers-test')
const { assertBn, assertRevert } = require('@aragon/contract-helpers-test/src/asserts')
const { assert } = require('chai')

const WithdrawalQueue = artifacts.require('WithdrawalQueue.sol')

contract('WithdrawalQueue', ([deployer, owner, requestor, stranger]) => {
  console.log('Addresses:')
  console.log(` Deployer: ${deployer}`)
  console.log(` Owner: ${owner}`)

  let withdrawal

  beforeEach('Deploy', async () => {
    withdrawal = await WithdrawalQueue.new(owner)
  })

  context('Enqueue', async () => {
    let requestId

    beforeEach('Read some state', async () => {
      requestId = await withdrawal.queueLength()
    })

    it('Owner can enqueue a request', async () => {
      await withdrawal.enqueue(requestor, 1, 1, { from: owner })

      assertBn(await withdrawal.requestor(requestId), requestor)
      assertBn(await withdrawal.queueLength(), +requestId + 1)
      assert(requestId >= (await withdrawal.finalizedQueueLength()))
      const request = await withdrawal.queue(requestId)
      assert.equal(request[0], requestor)
      assertBn(request[1], bn(1))
      assertBn(request[2], bn(1))
    })

    it('Only owner can enqueue a request', async () => {
      await assertRevert(withdrawal.enqueue(requestor, 1, 1, { from: stranger }), 'NOT_OWNER')
      await assertRevert(withdrawal.requestor(requestId), 'REQUEST_NOT_FOUND')

      assertBn(await withdrawal.queueLength(), requestId)
    })
  })

  context('Finalization', async () => {
    let requestId
    let amountOfStETH
    const amountOfShares = 1
    beforeEach('Enqueue a request', async () => {
      amountOfStETH = 100
      requestId = await withdrawal.queueLength()
      await withdrawal.enqueue(requestor, amountOfStETH, amountOfShares, { from: owner })
    })

    it('Only owner can finalize a request', async () => {
      await withdrawal.finalize(0, amountOfStETH, amountOfShares, { from: owner, value: amountOfStETH })
      await assertRevert(withdrawal.finalize(0, amountOfStETH, amountOfShares, { from: stranger, value: amountOfStETH }), 'NOT_OWNER')

      assertBn(await withdrawal.lockedEtherAmount(), bn(amountOfStETH))
    })

    it('One cannot finalize requests with no ether', async () => {
      await assertRevert(
        withdrawal.finalize(0, amountOfStETH, amountOfShares, { from: owner, value: amountOfStETH - 1 }),
        'NOT_ENOUGH_ETHER'
      )

      assertBn(await withdrawal.lockedEtherAmount(), bn(0))
    })

    it('One can finalize requests with discount', async () => {
      shares = 2

      await withdrawal.finalize(0, amountOfStETH, shares, { from: owner, value: amountOfStETH / shares })

      assertBn(await withdrawal.lockedEtherAmount(), bn(amountOfStETH / shares))
    })

    it('One can finalize part of the queue', async () => {
      await withdrawal.enqueue(requestor, amountOfStETH, amountOfShares, { from: owner })

      await withdrawal.finalize(0, amountOfStETH, amountOfShares, { from: owner, value: amountOfStETH })

      assertBn(await withdrawal.queueLength(), +requestId + 2)
      assertBn(await withdrawal.finalizedQueueLength(), +requestId + 1)
      assertBn(await withdrawal.lockedEtherAmount(), bn(amountOfStETH))
    })
  })

  context('Claim', async () => {
    let requestId
    beforeEach('Enqueue a request', async () => {
      requestId = await withdrawal.queueLength()
      await withdrawal.enqueue(requestor, 100, 1, { from: owner })
    })

    it('One cant claim not finalized request', async () => {
      await assertRevert(withdrawal.claim(requestId, { from: owner }), 'REQUEST_NOT_FINALIZED')
    })

    it('Anyone can claim a finalized token', async () => {
      const balanceBefore = bn(await web3.eth.getBalance(requestor))
      await withdrawal.finalize(0, 100, 1, { from: owner, value: 100 })

      await withdrawal.claim(requestId, { from: stranger })

      assertBn(await web3.eth.getBalance(requestor), balanceBefore.add(bn(100)))
    })

    it('Cant withdraw token two times', async () => {
      await withdrawal.finalize(0, 100, 1, { from: owner, value: 100 })
      await withdrawal.claim(requestId)

      await assertRevert(withdrawal.claim(requestId, { from: stranger }), 'REQUEST_NOT_FOUND')
    })

    it('Discounted withdrawals produce less eth', async () => {
      const balanceBefore = bn(await web3.eth.getBalance(requestor))
      await withdrawal.finalize(0, 50, 1, { from: owner, value: 50 })

      await withdrawal.claim(requestId, { from: stranger })

      assertBn(await web3.eth.getBalance(requestor), balanceBefore.add(bn(50)))
    })
  })
})
