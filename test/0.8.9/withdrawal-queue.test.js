const { artifacts, contract, ethers } = require('hardhat')
const { bn, getEventArgument } = require('@aragon/contract-helpers-test')

const { ETH, StETH, shareRate, shares } = require('../helpers/utils')
const { assert } = require('../helpers/assert')
const withdrawals = require('../helpers/withdrawals')
const {signPermit, makeDomainSeparator} = require('../0.6.12/helpers/permit_helpers')
const { MAX_UINT256, ACCOUNTS_AND_KEYS } = require('../0.6.12/helpers/constants')

const StETHMock = artifacts.require('StETHMock.sol')
const WstETH = artifacts.require('WstETHMock.sol')

contract('WithdrawalQueue', ([recipient, stranger, daoAgent, user]) => {
  let withdrawalQueue, steth, wsteth

  beforeEach('Deploy', async () => {
    steth = await StETHMock.new({ value: ETH(600) })
    wsteth = await WstETH.new(steth.address)

    withdrawalQueue = (await withdrawals.deploy(daoAgent, wsteth.address)).queue

    await withdrawalQueue.initialize(daoAgent, daoAgent, daoAgent, steth.address)
    await withdrawalQueue.resume({ from: daoAgent })

    await steth.setTotalPooledEther(ETH(300))
    await steth.mintShares(user, shares(1))
    await steth.approve(withdrawalQueue.address, StETH(300), { from: user })

    await ethers.provider.send('hardhat_impersonateAccount', [steth.address])
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

    it('Only owner can finalize a request', async () => {
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

      assert.equals(await withdrawalQueue.findClaimHint(requestId), await withdrawalQueue.lastDiscountIndex())
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

      await withdrawalQueue.claimWithdrawal(requestId, 1, { from: stranger })

      assert.equals(await ethers.provider.getBalance(recipient), balanceBefore.add(bn(amount)))
    })

    it('Cant withdraw token two times', async () => {
      await withdrawalQueue.finalize(1, { from: steth.address, value: amount })
      await withdrawalQueue.claimWithdrawal(requestId, 1)

      await assert.reverts(withdrawalQueue.claimWithdrawal(requestId, 1), 'RequestAlreadyClaimed()')
    })

    it('Discounted withdrawals produce less eth', async () => {
      const balanceBefore = bn(await ethers.provider.getBalance(recipient))
      await withdrawalQueue.finalize(1, { from: steth.address, value: ETH(150) })

      await withdrawalQueue.claimWithdrawal(requestId, 1)

      assert.equals(await ethers.provider.getBalance(recipient), balanceBefore.add(bn(ETH(150))))
    })
  })

  context('findClaimHints()', () => {
    let requestId
    const amount = ETH(20)

    beforeEach('Enqueue a request', async () => {
      await withdrawalQueue.requestWithdrawal(amount, recipient, { from: user })
      requestId = await withdrawalQueue.lastRequestId()
    })

    it('returns empty list when passed empty request ids list', async () => {
      const hints = await withdrawalQueue.findClaimHints([])
      assert.equal(hints.length, 0)
    })

    it('returns hints array with one item for list from single request id', async () => {
      await withdrawalQueue.finalize(requestId, { from: steth.address, value: ETH(150) })
      const hints = await withdrawalQueue.findClaimHints([requestId])
      assert.equal(hints.length, 1)
      assert.equals(hints[0], 1)
    })

    it('returns correct hints array for given request ids', async () => {
      await withdrawalQueue.finalize(requestId, { from: steth.address, value: ETH(20) })

      await steth.mintShares(recipient, shares(1))
      await steth.approve(withdrawalQueue.address, StETH(300), { from: recipient })

      const secondRequestAmount = ETH(10)
      await withdrawalQueue.requestWithdrawal(secondRequestAmount, recipient, { from: recipient })
      const secondRequestId = await withdrawalQueue.lastRequestId()

      const thirdRequestAmount = ETH(30)
      await withdrawalQueue.requestWithdrawal(thirdRequestAmount, user, { from: user })
      const thirdRequestId = await withdrawalQueue.lastRequestId()

      await withdrawalQueue.finalize(thirdRequestId, { from: steth.address, value: ETH(40) })

      const hints = await withdrawalQueue.findClaimHints([requestId, secondRequestId, thirdRequestId])
      assert.equal(hints.length, 3)
      assert.equals(hints[0], 1)
      assert.equals(hints[1], 1)
      assert.equals(hints[2], 1)
    })
  })

  context('claimWithdrawals()', () => {
    let requestId
    const amount = ETH(20)

    beforeEach('Enqueue a request', async () => {
      await withdrawalQueue.requestWithdrawal(amount, recipient, { from: user })
      requestId = await withdrawalQueue.lastRequestId()
    })

    it('claims correct requests', async () => {
      await steth.mintShares(recipient, shares(300))
      await steth.approve(withdrawalQueue.address, StETH(300), { from: recipient })
      const secondRequestAmount = ETH(10)
      await withdrawalQueue.requestWithdrawal(secondRequestAmount, recipient, { from: recipient })
      const secondRequestId = await withdrawalQueue.lastRequestId()
      await withdrawalQueue.finalize(secondRequestId, { from: steth.address, value: ETH(40) })

      const balanceBefore = bn(await ethers.provider.getBalance(recipient))
      await withdrawalQueue.claimWithdrawals([requestId, secondRequestId], [1, 1])
      assert.equals(await ethers.provider.getBalance(recipient), balanceBefore.add(bn(ETH(30))))
    })
  })

  context('requestWithdrawals()', () => {
    it('works correctly with non empty payload and different tokens', async () => {
      await wsteth.mint(user, ETH(100))
      await steth.mintShares(wsteth.address, shares(20))
      await steth.mintShares(user, shares(10))
      await steth.approve(withdrawalQueue.address, StETH(300), { from: user })
      await wsteth.approve(withdrawalQueue.address, ETH(300), { from: user })
      const requests = [
        [steth.address, ETH(10), recipient],
        [wsteth.address, ETH(20), stranger]
      ]
      const balancesBefore = await Promise.all([steth.balanceOf(user), wsteth.balanceOf(user)])
      const lastRequestIdBefore = await withdrawalQueue.lastRequestId()
      await withdrawalQueue.requestWithdrawals(requests, { from: user })
      assert.equals(await withdrawalQueue.lastRequestId(), lastRequestIdBefore.add(bn(requests.length)))
      const balancesAfter = await Promise.all([steth.balanceOf(user), wsteth.balanceOf(user)])
      assert.almostEqual(balancesAfter[0], balancesBefore[0].sub(bn(requests[0][1])), 3)
      assert.equals(balancesAfter[1], balancesBefore[1].sub(bn(requests[1][1])))
    })
  })

  context('requestWithdrawalsWithPermit()', () => {
    it('works correctly with non empty payload', async () => {
      await wsteth.mint(user, ETH(100))
      await steth.mintShares(wsteth.address, shares(100))
      await steth.mintShares(user, shares(100))
      await wsteth.approve(withdrawalQueue.address, ETH(300), { from: user })
      const [alice] = ACCOUNTS_AND_KEYS
      await steth.transfer(alice.address, ETH(100), { from: user })
      await wsteth.transfer(alice.address, ETH(100), { from: user })

      const requests = []

      const withdrawalRequestsCount = 5
      for (let i = 0; i < withdrawalRequestsCount; ++i) {
        requests.push([wsteth.address, ETH(10), recipient])
      }

      const permissions = []
      const chainId = await wsteth.getChainId()
      const domainSeparator = makeDomainSeparator('Wrapped liquid staked Ether 2.0', '1', chainId, wsteth.address)
      for (let i = 0; i < withdrawalRequestsCount; ++i) {
        const { v, r, s } = signPermit(
          alice.address,
          withdrawalQueue.address,
          requests[i][1], // amount
          i, // nonce
          MAX_UINT256,
          domainSeparator,
          alice.key
        )
        permissions.push([v, r, s, alice.address, MAX_UINT256])
      }

      const aliceBalancesBefore = await wsteth.balanceOf(alice.address)
      const lastRequestIdBefore = await withdrawalQueue.lastRequestId()
      await withdrawalQueue.requestWithdrawalsWithPermit(requests, permissions, { from: user })
      assert.equals(await withdrawalQueue.lastRequestId(), lastRequestIdBefore.add(bn(requests.length)))
      const aliceBalancesAfter = await wsteth.balanceOf(alice.address)
      assert.equals(aliceBalancesAfter, aliceBalancesBefore.sub(bn(ETH(10)).mul(bn(withdrawalRequestsCount))))
    })
  })
})
