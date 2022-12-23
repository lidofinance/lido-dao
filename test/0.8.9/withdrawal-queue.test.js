const { artifacts, contract } = require('hardhat')
const { bn } = require('@aragon/contract-helpers-test')
const { assertBn, assertRevert } = require('@aragon/contract-helpers-test/src/asserts')
const { assert } = require('chai')

const WithdrawalQueue = artifacts.require('WithdrawalQueue.sol')
const Owner = artifacts.require('Owner.sol')
const StETHMock = artifacts.require('StETHMockForWithdrawalQueue.sol')
const WstETH = artifacts.require('WstETH.sol')
const OssifiableProxy = artifacts.require('OssifiableProxy.sol')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')

contract.only('WithdrawalQueue', ([recipient, stranger, daoAgent]) => {
  let withdrawal, withdrawalImpl, owner, steth, wsteth

  beforeEach('Deploy', async () => {
    owner = (await Owner.new({ value: ETH(300) })).address
    await ethers.provider.send('hardhat_impersonateAccount', [owner])
    steth = await StETHMock.new()
    wsteth = await WstETH.new(steth.address)

    withdrawalImpl = (await WithdrawalQueue.new(owner, steth.address, wsteth.address)).address
    console.log({withdrawalImpl})
    let withdrawalProxy = await OssifiableProxy.new(withdrawalImpl, daoAgent, '0x')
    withdrawal = await WithdrawalQueue.at(withdrawalProxy.address)
    await withdrawal.initialize(daoAgent)
    await withdrawal.resumeRequestsPlacement({from: daoAgent})
  })

  context('Enqueue', async () => {
    let requestId

    beforeEach('Read some state', async () => {
      requestId = await withdrawal.queueLength()
    })

    it.only('Owner can enqueue a request', async () => {
      // await withdrawal.enqueue(recipient, ETH(1), 1, { from: owner })
      await withdrawal.requestWithdrawal(ETH(1), recipient, { from: owner })

      assertBn(await withdrawal.queueLength(), +requestId + 1)
      assert(requestId >= (await withdrawal.finalizedRequestsCounter()))
      const request = await withdrawal.queue(requestId)
      assert.equal(request.recipient, recipient)
      assertBn(request.cumulativeEther, bn(ETH(1)))
      assertBn(request.cumulativeShares, bn(1))
      assert.equal(request.claimed, false)
    })

    it('Only owner can enqueue a request', async () => {
      await assertRevert(withdrawal.enqueue(recipient, 1, 1, { from: stranger }), 'NOT_OWNER')

      assertBn(await withdrawal.queueLength(), requestId)
    })
  })

  context('Finalization', async () => {
    let requestId
    const amount = ETH(100)
    const shares = 1

    beforeEach('Enqueue a request', async () => {
      requestId = await withdrawal.queueLength()
      await withdrawal.enqueue(recipient, amount, shares, { from: owner })
    })

    it('Calculate one request batch', async () => {
      const batch = await withdrawal.calculateFinalizationParams(0, ETH(100), 1)

      assertBn(bn(batch[0]), bn(ETH(100)))
      assertBn(bn(batch[1]), bn(1))
    })

    it('Only owner can finalize a request', async () => {
      await withdrawal.finalize(0, amount, amount, shares, { from: owner, value: amount })
      await assertRevert(withdrawal.finalize(0, amount, amount, shares, { from: stranger, value: amount }), 'NOT_OWNER')

      assertBn(await withdrawal.lockedEtherAmount(), bn(amount))
      assertBn(await web3.eth.getBalance(withdrawal.address), bn(amount))
    })

    it('One cannot finalize requests with no ether', async () => {
      assertBn(await withdrawal.lockedEtherAmount(), bn(0))
      assertBn(await web3.eth.getBalance(withdrawal.address), bn(0))

      await assertRevert(
        withdrawal.finalize(0, amount, amount, shares, { from: owner, value: bn(ETH(100)).sub(bn(1)) }),
        'NOT_ENOUGH_ETHER'
      )

      assertBn(await withdrawal.lockedEtherAmount(), bn(0))
      assertBn(await web3.eth.getBalance(withdrawal.address), bn(0))
    })

    it('One can finalize requests with discount', async () => {
      await withdrawal.finalize(0, bn(amount / 2), amount, 2, { from: owner, value: amount / 2 })

      assertBn(await withdrawal.lockedEtherAmount(), bn(amount / 2))
    })

    it('One can finalize part of the queue', async () => {
      await withdrawal.enqueue(recipient, amount, shares, { from: owner })

      await withdrawal.finalize(0, amount, amount, shares, { from: owner, value: amount })

      assertBn(await withdrawal.queueLength(), +requestId + 2)
      assertBn(await withdrawal.finalizedRequestsCounter(), +requestId + 1)
      assertBn(await withdrawal.lockedEtherAmount(), bn(amount))
    })

    it('One can restake after finalization', async () => {
      const balanceBefore = bn(await web3.eth.getBalance(owner))
      await withdrawal.finalize(0, amount, amount, shares, { from: owner, value: bn(amount).mul(bn(2)) })
      await withdrawal.restake(amount, { from: owner })

      assertBn(await withdrawal.lockedEtherAmount(), bn(amount))
      assertBn(await web3.eth.getBalance(withdrawal.address), bn(amount))
      assertBn(await web3.eth.getBalance(owner), balanceBefore.sub(bn(amount)))
    })
  })

  context('Claim', async () => {
    let requestId
    const amount = ETH(100)
    beforeEach('Enqueue a request', async () => {
      requestId = await withdrawal.queueLength()
      await withdrawal.enqueue(recipient, amount, 1, { from: owner })
    })

    it('One cant claim not finalized request', async () => {
      await assertRevert(withdrawal.claim(requestId, 0, { from: owner }), 'REQUEST_NOT_FINALIZED')
    })

    it('Anyone can claim a finalized token', async () => {
      const balanceBefore = bn(await web3.eth.getBalance(recipient))
      await withdrawal.finalize(0, amount, amount, 1, { from: owner, value: amount })

      await withdrawal.claim(requestId, 0, { from: stranger })

      assertBn(await web3.eth.getBalance(recipient), balanceBefore.add(bn(amount)))
    })

    it('Cant withdraw token two times', async () => {
      await withdrawal.finalize(0, amount, amount, 1, { from: owner, value: amount })
      await withdrawal.claim(requestId, 0)

      await assertRevert(withdrawal.claim(requestId, 0, { from: stranger }), 'REQUEST_ALREADY_CLAIMED')
    })

    it('Discounted withdrawals produce less eth', async () => {
      const balanceBefore = bn(await web3.eth.getBalance(recipient))
      await withdrawal.finalize(0, ETH(50), ETH(100), 2, { from: owner, value: ETH(50) })

      await withdrawal.claim(requestId, 0, { from: stranger })

      assertBn(await web3.eth.getBalance(recipient), balanceBefore.add(bn(ETH(50))))
    })
  })
})
