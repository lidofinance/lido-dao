const { artifacts, contract, ethers } = require('hardhat')
const { bn } = require('@aragon/contract-helpers-test')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { assert } = require('chai')
const { ETH, StETH, shareRate, shares } = require('../helpers/utils')
const { assertRevert } = require('../helpers/assertThrow')

const WithdrawalQueue = artifacts.require('WithdrawalQueue.sol')
const StETHMock = artifacts.require('StETHMock.sol')
const WstETH = artifacts.require('WstETH.sol')
const OssifiableProxy = artifacts.require('OssifiableProxy.sol')

contract('WithdrawalQueue', ([recipient, stranger, daoAgent, user]) => {
  let withdrawal, withdrawalImplAddress, steth, wsteth

  beforeEach('Deploy', async () => {
    steth = (await StETHMock.new({ value: ETH(600) }))
    await ethers.provider.send('hardhat_impersonateAccount', [steth.address])
    steth.setTotalPooledEther(ETH(300))

    wsteth = await WstETH.new(steth.address)

    withdrawalImplAddress = (await WithdrawalQueue.new(steth.address, wsteth.address)).address
    const withdrawalProxy = await OssifiableProxy.new(withdrawalImplAddress, daoAgent, '0x')
    withdrawal = await WithdrawalQueue.at(withdrawalProxy.address)

    await withdrawal.initialize(daoAgent, daoAgent, daoAgent, steth.address)
    await withdrawal.resume({ from: daoAgent })

    steth.mintShares(user, shares(1))
    steth.approve(withdrawal.address, StETH(300), { from: user })
  })

  context('Enqueue', async () => {
    let requestId

    beforeEach('Read some state', async () => {
      requestId = bn(await withdrawal.lastRequestId()).add(bn(1));
    })

    it('One can enqueue a request', async () => {
      await withdrawal.requestWithdrawal(StETH(300), recipient, { from: user })

      assertBn(await withdrawal.lastRequestId(), requestId)
      assert.equal(await withdrawal.lastFinalizedRequestId(), 0)

      const request = await withdrawal.getWithdrawalRequestStatus(requestId)

      assert.equal(request.recipient, recipient)
      assertBn(request.amountOfStETH, StETH(300))
      assertBn(request.amountOfShares, shares(1))
      assert.equal(request.isFinalized, false)
      assert.equal(request.isClaimed, false)
    })
  })

  context('Finalization', async () => {
    const amount = bn(ETH(300))

    beforeEach('Enqueue a request', async () => {
      await withdrawal.requestWithdrawal(amount, recipient, { from: user })
    })

    it('Calculate one request batch', async () => {
      const batch = await withdrawal.finalizationBatch(1, shareRate(300))

      assertBn(batch.eth, ETH(300))
      assertBn(batch.shares, shares(1))
    })

    it('Only owner can finalize a request', async () => {
      await assertRevert(withdrawal.finalize(1, { from: stranger }),
        `AccessControl: account ${stranger.toLowerCase()} is missing role ${await withdrawal.FINALIZE_ROLE()}`)
      await withdrawal.finalize(1, { from: steth.address, value: amount })

      assertBn(await withdrawal.lockedEtherAmount(), amount)
      assertBn(await withdrawal.lockedEtherAmount(), await ethers.provider.getBalance(withdrawal.address))
    })
    
    it('One can finalize requests with discount', async () => {
      await withdrawal.finalize(1, { from: steth.address, value: ETH(150) })

      assertBn(await withdrawal.lockedEtherAmount(), ETH(150))
      assertBn(await withdrawal.lockedEtherAmount(), await ethers.provider.getBalance(withdrawal.address))
    })

    it('One can finalize a batch of requests at once', async () => {
      steth.setTotalPooledEther(ETH(600))
      steth.mintShares(user, shares(1))
      steth.approve(withdrawal.address, StETH(600), { from: user })

      await withdrawal.requestWithdrawal(amount, recipient, { from: user })
      const batch = await withdrawal.finalizationBatch(2, shareRate(300))
      await withdrawal.finalize(2, { from: steth.address, value: batch.eth })

      assertBn(batch.shares, shares(2))
      assertBn(await withdrawal.lastRequestId(), 2)
      assertBn(await withdrawal.lastFinalizedRequestId(), 2)
      assertBn(await withdrawal.lockedEtherAmount(), ETH(600))
      assertBn(await withdrawal.lockedEtherAmount(), await ethers.provider.getBalance(withdrawal.address))
    })

    it('One can finalize part of the queue', async () => {
      steth.setTotalPooledEther(ETH(600))
      steth.mintShares(user, shares(1))
      steth.approve(withdrawal.address, StETH(600), { from: user })

      await withdrawal.requestWithdrawal(amount, recipient, { from: user })

      await withdrawal.finalize(1, { from: steth.address, value: amount })

      assertBn(await withdrawal.lastRequestId(), 2)
      assertBn(await withdrawal.lastFinalizedRequestId(), 1)
      assertBn(await withdrawal.lockedEtherAmount(), ETH(300))
      assertBn(await withdrawal.lockedEtherAmount(), await ethers.provider.getBalance(withdrawal.address))

      await withdrawal.finalize(2, { from: steth.address, value: amount })

      assertBn(await withdrawal.lastRequestId(), 2)
      assertBn(await withdrawal.lastFinalizedRequestId(), 2)
      assertBn(await withdrawal.lockedEtherAmount(), ETH(600))
      assertBn(await withdrawal.lockedEtherAmount(), await ethers.provider.getBalance(withdrawal.address))
    })
  })

  context('Claim', async () => {
    let requestId
    const amount = ETH(300)
    beforeEach('Enqueue a request', async () => {
      requestId = await withdrawal.lastRequestId() + 1; // todo: get from receipt
      await withdrawal.requestWithdrawal(amount, recipient, { from: user })
    })

    it('One cant claim not finalized request', async () => {
      await assertRevert(withdrawal.claimWithdrawal(requestId, 1), 'RequestNotFinalized()')
    })

    it('Cant claim request with a wrong hint', async () => {
      steth.setTotalPooledEther(ETH(600))
      steth.mintShares(user, shares(1))
      steth.approve(withdrawal.address, StETH(600), { from: user })

      await withdrawal.requestWithdrawal(amount, recipient, { from: user })

      await withdrawal.finalize(2, { from: steth.address, value: amount })
      await assertRevert(withdrawal.claimWithdrawal(requestId, 0), 'InvalidHint()')
      await assertRevert(withdrawal.claimWithdrawal(requestId, 2), 'InvalidHint()')
    })

    it('Anyone can claim a finalized token', async () => {
      await withdrawal.finalize(1, { from: steth.address, value: amount })

      const balanceBefore = bn(await ethers.provider.getBalance(recipient))

      await withdrawal.claimWithdrawal(requestId, 1, { from: stranger })

      assertBn(await ethers.provider.getBalance(recipient), balanceBefore.add(bn(amount)))
    })

    it('Cant withdraw token two times', async () => {
      await withdrawal.finalize(1, { from: steth.address, value: amount })
      await withdrawal.claimWithdrawal(requestId, 1)

      await assertRevert(withdrawal.claimWithdrawal(requestId, 1), 'RequestAlreadyClaimed()')
    })

    it('Discounted withdrawals produce less eth', async () => {
      const balanceBefore = bn(await ethers.provider.getBalance(recipient))
      await withdrawal.finalize(1, { from: steth.address, value: ETH(150) })

      await withdrawal.claimWithdrawal(requestId, 1)

      assertBn(await ethers.provider.getBalance(recipient), balanceBefore.add(bn(ETH(150))))
    })
  })
})
