const { artifacts, contract, ethers } = require('hardhat')
const { bn, getEventArgument, ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

const { ETH, StETH, shareRate, shares } = require('../helpers/utils')
const { assert } = require('../helpers/assert')
const withdrawals = require('../helpers/withdrawals')

const StETHMock = artifacts.require('StETHMock.sol')
const WstETH = artifacts.require('WstETH.sol')

contract('WithdrawalQueue', ([recipient, stranger, daoAgent, user]) => {
  let withdrawalQueue, steth, wsteth

  beforeEach('Deploy', async () => {
    steth = await StETHMock.new({ value: ETH(601) })
    wsteth = await WstETH.new(steth.address)

    withdrawalQueue = (await withdrawals.deploy(daoAgent, wsteth.address)).queue

    await withdrawalQueue.initialize(daoAgent, daoAgent, daoAgent, steth.address)
    await withdrawalQueue.resume({ from: daoAgent })

    await steth.setTotalPooledEther(ETH(300))
    await steth.mintShares(user, shares(1))
    await steth.approve(withdrawalQueue.address, StETH(300), { from: user })

    await ethers.provider.send('hardhat_impersonateAccount', [steth.address])
  })

  it('Initial properties', async () => {
    assert.equals(await withdrawalQueue.isPaused(), false)
    assert.equals(await withdrawalQueue.lastRequestId(), 0)
    assert.equals(await withdrawalQueue.lastFinalizedRequestId(), 0)
    assert.equals(await withdrawalQueue.lastDiscountIndex(), 0)
    assert.equals(await withdrawalQueue.unfinalizedStETH(), StETH(0))
    assert.equals(await withdrawalQueue.unfinalizedRequestNumber(), 0)
    assert.equals(await withdrawalQueue.lockedEtherAmount(), ETH(0))
  })

  context('Request', async () => {
    it('One can request a withdrawal', async () => {
      const receipt = await withdrawalQueue.requestWithdrawal(StETH(300), recipient, { from: user })
      const requestId = getEventArgument(receipt, "WithdrawalRequested", "requestId")

      assert.emits(receipt, "WithdrawalRequested", {
        requestId: 1,
        requestor: user.toLowerCase(),
        recipient: recipient.toLowerCase(),
        amountOfStETH: StETH(300),
        amountOfShares: shares(1)
      })

      assert.equals(await withdrawalQueue.lastRequestId(), requestId)
      assert.equals(await withdrawalQueue.lastFinalizedRequestId(), 0)
      assert.equals(await withdrawalQueue.unfinalizedRequestNumber(), 1)
      assert.equals(await withdrawalQueue.unfinalizedStETH(), StETH(300))
      assert.equals(await withdrawalQueue.getWithdrawalRequests(recipient), [1])

      const request = await withdrawalQueue.getWithdrawalRequestStatus(requestId)

      assert.equals(request.recipient, recipient)
      assert.equals(request.amountOfStETH, StETH(300))
      assert.equals(request.amountOfShares, shares(1))
      assert.equals(request.isFinalized, false)
      assert.equals(request.isClaimed, false)
    })

    it('One cant request less than MIN', async () => {
      const min = bn(await withdrawalQueue.MIN_STETH_WITHDRAWAL_AMOUNT())
      assert.equals(min, 100)

      const amount = min.sub(bn(1))

      await assert.reverts(withdrawalQueue.requestWithdrawal(amount, recipient, { from: user }),
        `RequestAmountTooSmall(${amount})`)
    })

    it('One can request MIN', async () => {
      const min = await withdrawalQueue.MIN_STETH_WITHDRAWAL_AMOUNT()
      const shares = await steth.getSharesByPooledEth(min)

      const receipt = await withdrawalQueue.requestWithdrawal(min, recipient, { from: user })
      const requestId = getEventArgument(receipt, "WithdrawalRequested", "requestId")

      assert.emits(receipt, "WithdrawalRequested", {
        requestId: 1,
        requestor: user.toLowerCase(),
        recipient: recipient.toLowerCase(),
        amountOfStETH: min,
        amountOfShares: shares,
      })

      assert.equals(await withdrawalQueue.lastRequestId(), requestId)
      assert.equals(await withdrawalQueue.lastFinalizedRequestId(), 0)

      const request = await withdrawalQueue.getWithdrawalRequestStatus(requestId)

      assert.equals(request.recipient, recipient)
      assert.equals(request.amountOfStETH, min)
      assert.equals(request.amountOfShares, shares)
      assert.equals(request.isFinalized, false)
      assert.equals(request.isClaimed, false)
    })

    it('One cant request more than MAX', async () => {
      const max = bn(await withdrawalQueue.MAX_STETH_WITHDRAWAL_AMOUNT())
      const amount = max.add(bn(1))
      await steth.setTotalPooledEther(amount)
      await steth.approve(withdrawalQueue.address, amount, { from: user })

      await assert.reverts(withdrawalQueue.requestWithdrawal(amount, recipient, { from: user }),
        `RequestAmountTooLarge(${amount})`)
    })

    it('One can request MAX', async () => {
      const max = await withdrawalQueue.MAX_STETH_WITHDRAWAL_AMOUNT()
      await steth.setTotalPooledEther(max)
      await steth.approve(withdrawalQueue.address, max, { from: user })

      const receipt = await withdrawalQueue.requestWithdrawal(max, recipient, { from: user })
      const requestId = getEventArgument(receipt, "WithdrawalRequested", "requestId")

      assert.emits(receipt, "WithdrawalRequested", {
        requestId: 1,
        requestor: user.toLowerCase(),
        recipient: recipient.toLowerCase(),
        amountOfStETH: max,
        amountOfShares: shares(1)
      })

      assert.equals(await withdrawalQueue.lastRequestId(), requestId)
      assert.equals(await withdrawalQueue.lastFinalizedRequestId(), 0)

      const request = await withdrawalQueue.getWithdrawalRequestStatus(requestId)

      assert.equals(request.recipient, recipient)
      assert.equals(request.amountOfStETH, max)
      assert.equals(request.amountOfShares, shares(1))
      assert.equals(request.isFinalized, false)
      assert.equals(request.isClaimed, false)
    })

    it('One cant request more than they have', async () => {
      await assert.reverts(withdrawalQueue.requestWithdrawal(StETH(400), recipient, { from: user }),
        "TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE")
    })

    it('One cant request more than allowed', async () => {
      await steth.approve(withdrawalQueue.address, StETH(200), { from: user })

      await assert.reverts(withdrawalQueue.requestWithdrawal(StETH(300), recipient, { from: user }),
        "TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE")
    })
  })

  context('Finalization', async () => {
    const amount = bn(ETH(300))

    beforeEach('Enqueue a request', async () => {
      await withdrawalQueue.requestWithdrawal(amount, recipient, { from: user })
    })

    it('Calculate one request batch', async () => {
      const batch = await withdrawalQueue.finalizationBatch(1, shareRate(300))

      assert.equals(batch.eth, ETH(300))
      assert.equals(batch.shares, shares(1))
    })

    it('Finalizer can finalize a request', async () => {
      await assert.reverts(withdrawalQueue.finalize(1, { from: stranger }),
        `AccessControl: account ${stranger.toLowerCase()} is missing role ${await withdrawalQueue.FINALIZE_ROLE()}`)
      await withdrawalQueue.finalize(1, { from: steth.address, value: amount })

      assert.equals(await withdrawalQueue.lockedEtherAmount(), amount)
      assert.equals(await withdrawalQueue.lockedEtherAmount(), await ethers.provider.getBalance(withdrawalQueue.address))
    })

    it('One can finalize requests with discount', async () => {
      await withdrawalQueue.finalize(1, { from: steth.address, value: ETH(150) })

      assert.equals(await withdrawalQueue.lockedEtherAmount(), ETH(150))
      assert.equals(await withdrawalQueue.lockedEtherAmount(), await ethers.provider.getBalance(withdrawalQueue.address))
    })

    it('Discount array do not grow if no discount', async () => {
      assert.equals(await withdrawalQueue.lastDiscountIndex(), 0)
      await withdrawalQueue.finalize(1, { from: steth.address, value: ETH(300) })

      assert.equals(await withdrawalQueue.lastDiscountIndex(), 0)
    })

    it('One can finalize a batch of requests at once', async () => {
      await steth.setTotalPooledEther(ETH(600))
      await steth.mintShares(user, shares(1))
      await steth.approve(withdrawalQueue.address, StETH(600), { from: user })

      await withdrawalQueue.requestWithdrawal(amount, recipient, { from: user })
      const batch = await withdrawalQueue.finalizationBatch(2, shareRate(300))
      await withdrawalQueue.finalize(2, { from: steth.address, value: batch.eth })

      assert.equals(batch.shares, shares(2))
      assert.equals(await withdrawalQueue.lastRequestId(), 2)
      assert.equals(await withdrawalQueue.lastFinalizedRequestId(), 2)
      assert.equals(await withdrawalQueue.lockedEtherAmount(), ETH(600))
      assert.equals(await withdrawalQueue.lockedEtherAmount(), await ethers.provider.getBalance(withdrawalQueue.address))
    })

    it('One can finalize part of the queue', async () => {
      await steth.setTotalPooledEther(ETH(600))
      await steth.mintShares(user, shares(1))
      await steth.approve(withdrawalQueue.address, StETH(600), { from: user })

      await withdrawalQueue.requestWithdrawal(amount, recipient, { from: user })

      await withdrawalQueue.finalize(1, { from: steth.address, value: amount })

      assert.equals(await withdrawalQueue.lastRequestId(), 2)
      assert.equals(await withdrawalQueue.lastFinalizedRequestId(), 1)
      assert.equals(await withdrawalQueue.lockedEtherAmount(), ETH(300))
      assert.equals(await withdrawalQueue.lockedEtherAmount(), await ethers.provider.getBalance(withdrawalQueue.address))

      await withdrawalQueue.finalize(2, { from: steth.address, value: amount })

      assert.equals(await withdrawalQueue.lastRequestId(), 2)
      assert.equals(await withdrawalQueue.lastFinalizedRequestId(), 2)
      assert.equals(await withdrawalQueue.lockedEtherAmount(), ETH(600))
      assert.equals(await withdrawalQueue.lockedEtherAmount(), await ethers.provider.getBalance(withdrawalQueue.address))
    })
  })

  context('Claim', async () => {
    let requestId
    const amount = ETH(300)
    beforeEach('Enqueue a request', async () => {
      const receipt = await withdrawalQueue.requestWithdrawal(amount, recipient, { from: user })
      requestId = getEventArgument(receipt, "WithdrawalRequested", "requestId")
    })

    it('One cant claim not finalized request', async () => {
      await assert.reverts(withdrawalQueue.claimWithdrawal(requestId, 0), `RequestNotFinalized(${requestId})`)
    })

    it('One can find a right hint to claim a withdrawal', async () => {
      await withdrawalQueue.finalize(1, { from: steth.address, value: amount })

      assert.equals(await withdrawalQueue.findClaimHintUnbounded(requestId), await withdrawalQueue.lastDiscountIndex())
    })

    it('Cant claim request with a wrong hint', async () => {
      await steth.setTotalPooledEther(ETH(600))
      await steth.mintShares(user, shares(1))
      await steth.approve(withdrawalQueue.address, StETH(600), { from: user })

      await withdrawalQueue.requestWithdrawal(amount, recipient, { from: user })

      await withdrawalQueue.finalize(2, { from: steth.address, value: amount })
      await assert.reverts(withdrawalQueue.claimWithdrawal(requestId, 0), 'InvalidHint(0)')
      await assert.reverts(withdrawalQueue.claimWithdrawal(requestId, 2), 'InvalidHint(2)')
    })

    it('Anyone can claim a finalized token', async () => {
      await withdrawalQueue.finalize(1, { from: steth.address, value: amount })

      const balanceBefore = bn(await ethers.provider.getBalance(recipient))

      await withdrawalQueue.claimWithdrawal(requestId, await withdrawalQueue.findClaimHintUnbounded(requestId), { from: stranger })

      assert.equals(await ethers.provider.getBalance(recipient), balanceBefore.add(bn(amount)))
    })

    it('Cant withdraw token two times', async () => {
      await withdrawalQueue.finalize(1, { from: steth.address, value: amount })
      await withdrawalQueue.claimWithdrawal(requestId, await withdrawalQueue.findClaimHintUnbounded(requestId))

      await assert.reverts(withdrawalQueue.claimWithdrawal(requestId, 1), 'RequestAlreadyClaimed()')
    })

    it('Discounted withdrawals produce less eth', async () => {
      await withdrawalQueue.finalize(1, { from: steth.address, value: ETH(150) })

      const hint = await withdrawalQueue.findClaimHintUnbounded(requestId)
      const balanceBefore = bn(await ethers.provider.getBalance(recipient))
      assert.equals(await withdrawalQueue.lockedEtherAmount(), ETH(150))

      await withdrawalQueue.claimWithdrawal(requestId, hint)
      assert.equals(await withdrawalQueue.lockedEtherAmount(), ETH(0))

      assert.equals(bn(await ethers.provider.getBalance(recipient)).sub(balanceBefore), ETH(150))
    })

    it('One can claim a lot of withdrawals with different discounts', async () => {
      await steth.setTotalPooledEther(ETH(21))
      await steth.mintShares(user, shares(21))
      await steth.approve(withdrawalQueue.address, StETH(21), { from: user })

      assert.equals(await withdrawalQueue.lastDiscountIndex(), 0)
      await withdrawalQueue.finalize(1, { from: steth.address, value: amount })
      assert.equals(await withdrawalQueue.lastDiscountIndex(), 0)

      for (let i = 1; i <= 20; i++) {
        await withdrawalQueue.requestWithdrawal(StETH(1), ZERO_ADDRESS, { from: user })
        await withdrawalQueue.finalize(i + 1, { from: steth.address, value: bn(ETH(1)).div(bn(i * 1000)) })
      }

      assert.equals(await withdrawalQueue.lastDiscountIndex(), 20)

      for (let i = 21; i > 0; i--) {
        await withdrawalQueue.claimWithdrawal(i, await withdrawalQueue.findClaimHintUnbounded(i))
      }

      assert.equals(await withdrawalQueue.lockedEtherAmount(), ETH(0))
    })
  })

  context('Transfer request', async () => {
    const amount = ETH(300)
    let requestId

    beforeEach('Enqueue a request', async () => {
      await withdrawalQueue.requestWithdrawal(amount, user, { from: user })
      requestId = (await withdrawalQueue.lastRequestId()).toNumber()
    })

    it('One can change the recipient', async () => {
      const senderWithdrawalsBefore = await withdrawalQueue.getWithdrawalRequests(user)
      const recipientWithdrawalsBefore = await withdrawalQueue.getWithdrawalRequests(recipient)

      assert.isTrue(senderWithdrawalsBefore.map(v => v.toNumber()).includes(requestId))
      assert.isFalse(recipientWithdrawalsBefore.map(v => v.toNumber()).includes(requestId))

      await withdrawalQueue.changeRecipient(requestId, recipient, { from: user })

      const senderWithdrawalAfter = await withdrawalQueue.getWithdrawalRequests(user)
      const recipientWithdrawalsAfter = await withdrawalQueue.getWithdrawalRequests(recipient)

      assert.isFalse(senderWithdrawalAfter.map(v => v.toNumber()).includes(requestId))
      assert.isTrue(recipientWithdrawalsAfter.map(v => v.toNumber()).includes(requestId))
    })

    it("One can't change someone else's request", async () => {
      await assert.reverts(withdrawalQueue.changeRecipient(requestId, stranger, { from: recipient }), `RecipientExpected("${user}", "${recipient}")`)
    })

    it("One can't change claimed request", async () => {
      await withdrawalQueue.finalize(requestId, { from: steth.address, value: amount })
      await withdrawalQueue.claimWithdrawal(requestId, await withdrawalQueue.findClaimHintUnbounded(requestId), { from: user })

      await assert.reverts(withdrawalQueue.changeRecipient(requestId, recipient, { from: user }), `RequestAlreadyClaimed()`)
    })

    it("One can't pass the same recipient", async () => {
      await assert.reverts(withdrawalQueue.changeRecipient(requestId, user, { from: user }), `InvalidRecipient("${user}")`)
    })

    it("Changing recipient doesn't work with wrong request id", async () => {
      const wrongRequestId = requestId + 1
      await assert.reverts(withdrawalQueue.changeRecipient(wrongRequestId, stranger, { from: user }), `InvalidRequestId(${wrongRequestId})`)
    })

    it("NOP Changing recipient is forbidden", async () => {
      await assert.reverts(withdrawalQueue.changeRecipient(requestId, recipient, { from: recipient }), `InvalidRecipient("${recipient}")`)
    })
  })

  context('Transfer request performance', function () {
    const firstRequestCount = 1000
    const secondRequestCount = 10000
    
    this.timeout(1000000)

    it.skip('Can perform a lots of requests', async () => {
      for (let i = 0; i < firstRequestCount; i++) {
        await withdrawalQueue.requestWithdrawal(bn(ETH(1 / secondRequestCount)), user, { from: user })
      }
      const firstGasUsed = (await withdrawalQueue.changeRecipient(firstRequestCount - 1, recipient, { from: user })).receipt.gasUsed

      for (let i = firstRequestCount; i < secondRequestCount; i++) {
        await withdrawalQueue.requestWithdrawal(bn(ETH(1 / secondRequestCount)), user, { from: user })
      }
      const secondGasUsed = (await withdrawalQueue.changeRecipient(secondRequestCount / 2, recipient, { from: user })).receipt.gasUsed

      assert.isTrue(firstGasUsed >= secondGasUsed)
    })
  })
})
