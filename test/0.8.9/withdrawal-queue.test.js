const { assert } = require('../helpers/assert')
const { artifacts, contract, ethers } = require('hardhat')
const { bn } = require('@aragon/contract-helpers-test')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { ETH, StETH, shareRate, shares } = require('../helpers/utils')
const { assertRevert } = require('../helpers/assertThrow')
const { makeDomainSeparator, signPermit } = require('../0.6.12/helpers/permit_helpers')
const withdrawals = require('../helpers/withdrawals')
const { MAX_UINT256, ACCOUNTS_AND_KEYS } = require('../0.6.12/helpers/constants')

const StETHMock = artifacts.require('StETHMock.sol')
const WstETH = artifacts.require('WstETHMock')

contract('WithdrawalQueue', ([recipient, stranger, daoAgent, user]) => {
  let withdrawalQueue, steth, wsteth

  beforeEach('Deploy', async () => {
    steth = await StETHMock.new({ value: ETH(600) })
    wsteth = await WstETH.new(steth.address)

    withdrawalQueue = (await withdrawals.deploy(daoAgent, steth.address, wsteth.address)).queue

    await withdrawalQueue.initialize(daoAgent, daoAgent, daoAgent, steth.address)
    await withdrawalQueue.resume({ from: daoAgent })

    await steth.setTotalPooledEther(ETH(450))
    await steth.mintShares(user, shares(300))
    await steth.mintShares(wsteth.address, shares(150))
    await wsteth.mint(user, shares(150))
    await steth.approve(withdrawalQueue.address, StETH(300), { from: user })
    await wsteth.approve(withdrawalQueue.address, ETH(150), { from: user })

    await ethers.provider.send('hardhat_impersonateAccount', [steth.address])
  })

  context('Enqueue', async () => {
    let requestId

    beforeEach('Read some state', async () => {
      requestId = bn(await withdrawalQueue.lastRequestId()).add(bn(1))
    })

    it('One can enqueue a request', async () => {
      await withdrawalQueue.requestWithdrawal(StETH(300), recipient, { from: user })

      assertBn(await withdrawalQueue.lastRequestId(), requestId)
      assert.equal(await withdrawalQueue.lastFinalizedRequestId(), 0)

      const request = await withdrawalQueue.getWithdrawalRequestStatus(requestId)

      assert.equal(request.recipient, recipient)
      assertBn(request.amountOfStETH, StETH(300))
      assertBn(request.amountOfShares, shares(300))
      assert.equal(request.isFinalized, false)
      assert.equal(request.isClaimed, false)
    })
  })

  context('Finalization', async () => {
    const amount = bn(ETH(30))

    beforeEach('Enqueue a request', async () => {
      await withdrawalQueue.requestWithdrawal(amount, recipient, { from: user })
    })

    it('Calculate one request batch', async () => {
      const batch = await withdrawalQueue.finalizationBatch(1, shareRate(30))

      assertBn(batch.eth, ETH(30))
      assertBn(batch.shares, shares(30))
    })

    it('Only owner can finalize a request', async () => {
      await assertRevert(
        withdrawalQueue.finalize(1, { from: stranger }),
        `AccessControl: account ${stranger.toLowerCase()} is missing role ${await withdrawalQueue.FINALIZE_ROLE()}`
      )
      await withdrawalQueue.finalize(1, { from: steth.address, value: amount })

      assertBn(await withdrawalQueue.lockedEtherAmount(), amount)
      assertBn(await withdrawalQueue.lockedEtherAmount(), await ethers.provider.getBalance(withdrawalQueue.address))
    })

    it('One can finalize requests with discount', async () => {
      await withdrawalQueue.finalize(1, { from: steth.address, value: ETH(15) })

      assertBn(await withdrawalQueue.lockedEtherAmount(), ETH(15))
      assertBn(await withdrawalQueue.lockedEtherAmount(), await ethers.provider.getBalance(withdrawalQueue.address))
    })

    it('One can finalize a batch of requests at once', async () => {
      // await steth.setTotalPooledEther(ETH(600))
      // await steth.mintShares(user, shares(300))
      // await steth.approve(withdrawalQueue.address, StETH(600), { from: user })

      await withdrawalQueue.requestWithdrawal(amount, recipient, { from: user })
      const batch = await withdrawalQueue.finalizationBatch(2, shareRate(1))
      await withdrawalQueue.finalize(2, { from: steth.address, value: batch.eth })

      assertBn(batch.shares, shares(60))
      assertBn(await withdrawalQueue.lastRequestId(), 2)
      assertBn(await withdrawalQueue.lastFinalizedRequestId(), 2)
      assertBn(await withdrawalQueue.lockedEtherAmount(), ETH(60))
      assertBn(await withdrawalQueue.lockedEtherAmount(), await ethers.provider.getBalance(withdrawalQueue.address))
    })

    it('One can finalize part of the queue', async () => {
      // await steth.setTotalPooledEther(ETH(600))
      // await steth.mintShares(user, shares(300))
      // await steth.approve(withdrawalQueue.address, StETH(600), { from: user })

      await withdrawalQueue.requestWithdrawal(amount, recipient, { from: user })

      await withdrawalQueue.finalize(1, { from: steth.address, value: amount })

      assertBn(await withdrawalQueue.lastRequestId(), 2)
      assertBn(await withdrawalQueue.lastFinalizedRequestId(), 1)
      assertBn(await withdrawalQueue.lockedEtherAmount(), ETH(30))
      assertBn(await withdrawalQueue.lockedEtherAmount(), await ethers.provider.getBalance(withdrawalQueue.address))

      await withdrawalQueue.finalize(2, { from: steth.address, value: amount })

      assertBn(await withdrawalQueue.lastRequestId(), 2)
      assertBn(await withdrawalQueue.lastFinalizedRequestId(), 2)
      assertBn(await withdrawalQueue.lockedEtherAmount(), ETH(60))
      assertBn(await withdrawalQueue.lockedEtherAmount(), await ethers.provider.getBalance(withdrawalQueue.address))
    })
  })

  context('Claim', async () => {
    let requestId
    const amount = ETH(30)
    beforeEach('Enqueue a request', async () => {
      requestId = (await withdrawalQueue.lastRequestId()) + 1 // todo: get from receipt
      await withdrawalQueue.requestWithdrawal(amount, recipient, { from: user })
    })

    it('One cant claim not finalized request', async () => {
      await assertRevert(withdrawalQueue.claimWithdrawal(requestId, 1), 'RequestNotFinalized()')
    })

    it('Cant claim request with a wrong hint', async () => {
      await withdrawalQueue.requestWithdrawal(amount, recipient, { from: user })

      await withdrawalQueue.finalize(2, { from: steth.address, value: amount })
      await assertRevert(withdrawalQueue.claimWithdrawal(requestId, 0), 'InvalidHint()')
      await assertRevert(withdrawalQueue.claimWithdrawal(requestId, 2), 'InvalidHint()')
    })

    it('Anyone can claim a finalized token', async () => {
      await withdrawalQueue.finalize(1, { from: steth.address, value: amount })

      const balanceBefore = bn(await ethers.provider.getBalance(recipient))

      await withdrawalQueue.claimWithdrawal(requestId, 1, { from: stranger })

      assertBn(await ethers.provider.getBalance(recipient), balanceBefore.add(bn(amount)))
    })

    it('Cant withdraw token two times', async () => {
      await withdrawalQueue.finalize(1, { from: steth.address, value: amount })
      await withdrawalQueue.claimWithdrawal(requestId, 1)

      await assertRevert(withdrawalQueue.claimWithdrawal(requestId, 1), 'RequestAlreadyClaimed()')
    })

    it('Discounted withdrawals produce less eth', async () => {
      const balanceBefore = bn(await ethers.provider.getBalance(recipient))
      await withdrawalQueue.finalize(1, { from: steth.address, value: ETH(15) })

      await withdrawalQueue.claimWithdrawal(requestId, 1)

      assertBn(await ethers.provider.getBalance(recipient), balanceBefore.add(bn(ETH(15))))
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

      await steth.mintShares(recipient, shares(300))
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
      assertBn(await ethers.provider.getBalance(recipient), balanceBefore.add(bn(ETH(30))))
    })
  })

  context('requestWithdrawals()', () => {
    it('works correctly with non empty payload and different tokens', async () => {
      const requests = [
        [steth.address, ETH(10), recipient],
        [wsteth.address, ETH(20), stranger]
      ]
      const balancesBefore = await Promise.all([steth.balanceOf(user), wsteth.balanceOf(user)])
      const lastRequestIdBefore = await withdrawalQueue.lastRequestId()
      await withdrawalQueue.requestWithdrawals(requests, { from: user })
      assert.equals(await withdrawalQueue.lastRequestId(), lastRequestIdBefore.add(bn(requests.length)))
      const balancesAfter = await Promise.all([steth.balanceOf(user), wsteth.balanceOf(user)])
      assert.equals(balancesAfter[0], balancesBefore[0].sub(bn(requests[0][1])))
      assert.equals(balancesAfter[1], balancesBefore[1].sub(bn(requests[1][1])))
    })
  })

  context('requestWithdrawalsWithPermit()', () => {
    it('works correctly with non empty payload', async () => {
      const [alice] = ACCOUNTS_AND_KEYS
      await steth.transfer(alice.address, ETH(100), { from: user })
      await wsteth.transfer(alice.address, ETH(100), { from: user })

      const requests = []

      const withdrawalRequestsCount = 10
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

      const lastRequestIdBefore = await withdrawalQueue.lastRequestId()
      await withdrawalQueue.requestWithdrawalsWithPermit(requests, permissions, { from: user })
      assert.equals(await withdrawalQueue.lastRequestId(), lastRequestIdBefore.add(bn(requests.length)))
      const aliceBalancesAfter = await wsteth.balanceOf(alice.address)
      assert.equals(aliceBalancesAfter, 0)
    })
  })
})
