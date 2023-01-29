const { artifacts, contract, ethers } = require('hardhat')
const { bn } = require('@aragon/contract-helpers-test')

const { ETH, StETH, shareRate, shares } = require('../helpers/utils')
const { assert } = require('../helpers/assert')
const withdrawals = require('../helpers/withdrawals')

const StETHMock = artifacts.require('StETHMock.sol')
const WstETH = artifacts.require('WstETH.sol')

contract('WithdrawalQueue', ([recipient, stranger, daoAgent, user]) => {
  let withdrawalQueue, steth, wsteth

  beforeEach('Deploy', async () => {
    steth = await StETHMock.new({ value: ETH(600) })
    wsteth = await WstETH.new(steth.address)

    withdrawalQueue = (await withdrawals.deploy(daoAgent, wsteth.address)).queue

    await withdrawalQueue.initialize(daoAgent, daoAgent, daoAgent, steth.address)
    await withdrawalQueue.resume({ from: daoAgent })

    steth.setTotalPooledEther(ETH(300))
    steth.mintShares(user, shares(1))
    steth.approve(withdrawalQueue.address, StETH(300), { from: user })

    await ethers.provider.send('hardhat_impersonateAccount', [steth.address])
  })

  context('Enqueue', async () => {
    let requestId

    beforeEach('Read some state', async () => {
      requestId = bn(await withdrawalQueue.lastRequestId()).add(bn(1));
    })

    it('One can enqueue a request', async () => {
      await withdrawalQueue.requestWithdrawal(StETH(300), recipient, { from: user })

      assert.equals(await withdrawalQueue.lastRequestId(), requestId)
      assert.equals(await withdrawalQueue.lastFinalizedRequestId(), 0)

      const request = await withdrawalQueue.getWithdrawalRequestStatus(requestId)

      assert.equals(request.recipient, recipient)
      assert.equals(request.amountOfStETH, StETH(300))
      assert.equals(request.amountOfShares, shares(1))
      assert.equals(request.isFinalized, false)
      assert.equals(request.isClaimed, false)
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
      steth.setTotalPooledEther(ETH(600))
      steth.mintShares(user, shares(1))
      steth.approve(withdrawalQueue.address, StETH(600), { from: user })

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
      steth.setTotalPooledEther(ETH(600))
      steth.mintShares(user, shares(1))
      steth.approve(withdrawalQueue.address, StETH(600), { from: user })

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
      requestId = await withdrawalQueue.lastRequestId() + 1; // todo: get from receipt
      await withdrawalQueue.requestWithdrawal(amount, recipient, { from: user })
    })

    it('One cant claim not finalized request', async () => {
      await assert.reverts(withdrawalQueue.claimWithdrawal(requestId, 1), 'RequestNotFinalized()')
    })

    it('Cant claim request with a wrong hint', async () => {
      steth.setTotalPooledEther(ETH(600))
      steth.mintShares(user, shares(1))
      steth.approve(withdrawalQueue.address, StETH(600), { from: user })

      await withdrawalQueue.requestWithdrawal(amount, recipient, { from: user })

      await withdrawalQueue.finalize(2, { from: steth.address, value: amount })
      await assert.reverts(withdrawalQueue.claimWithdrawal(requestId, 0), 'InvalidHint()')
      await assert.reverts(withdrawalQueue.claimWithdrawal(requestId, 2), 'InvalidHint()')
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
})
