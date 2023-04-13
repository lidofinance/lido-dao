const { artifacts, contract, ethers } = require('hardhat')
const { assert } = require('../helpers/assert')

const { bn } = require('@aragon/contract-helpers-test')
const { tokens, ETH, shares } = require('./../helpers/utils')
const { EvmSnapshot } = require('../helpers/blockchain')
const { INITIAL_HOLDER, ZERO_ADDRESS, MAX_UINT256 } = require('../helpers/constants')

const StETHMock = artifacts.require('StETHMock')

contract('StETH', ([_, __, user1, user2, user3, nobody]) => {
  let stEth
  const snapshot = new EvmSnapshot(ethers.provider)

  before('deploy mock token', async () => {
    stEth = await StETHMock.new({ value: ETH(1) })
    await stEth.setTotalPooledEther(ETH(1))

    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  context('ERC20 methods', () => {
    it('info is correct', async () => {
      assert.equal(await stEth.name(), 'Liquid staked Ether 2.0')
      assert.equal(await stEth.symbol(), 'stETH')
      assert.equal(await stEth.decimals(), 18)
    })

    context('zero supply', async () => {
      it('initial total supply is correct', async () => {
        assert.equals(await stEth.totalSupply(), tokens(1))
      })

      it('initial balances are correct', async () => {
        assert.equals(await stEth.balanceOf(user1), tokens(0))
        assert.equals(await stEth.balanceOf(user2), tokens(0))
        assert.equals(await stEth.balanceOf(user3), tokens(0))
      })

      it('initial allowances are correct', async () => {
        assert.equals(await stEth.allowance(user1, user1), tokens(0))
        assert.equals(await stEth.allowance(user1, user2), tokens(0))
        assert.equals(await stEth.allowance(user1, user3), tokens(0))
        assert.equals(await stEth.allowance(user2, user2), tokens(0))
        assert.equals(await stEth.allowance(user2, user1), tokens(0))
        assert.equals(await stEth.allowance(user2, user3), tokens(0))
        assert.equals(await stEth.allowance(user3, user3), tokens(0))
        assert.equals(await stEth.allowance(user3, user1), tokens(0))
        assert.equals(await stEth.allowance(user3, user2), tokens(0))
      })

      it('approve works', async () => {
        const receipt = await stEth.approve(user2, tokens(1), { from: user1 })
        assert.emits(receipt, 'Approval', { owner: user1, spender: user2, value: tokens(1) })

        assert.equals(await stEth.allowance(user1, user2), tokens(1))
      })

      it(`balances aren't changed even if total pooled ether increased`, async () => {
        await stEth.setTotalPooledEther(tokens(100))
        assert.equals(await stEth.totalSupply(), tokens(100))

        assert.equals(await stEth.balanceOf(user1), tokens(0))
        assert.equals(await stEth.balanceOf(user2), tokens(0))
        assert.equals(await stEth.balanceOf(user3), tokens(0))
      })
    })

    context('with non-zero supply', async () => {
      beforeEach(async () => {
        await stEth.setTotalPooledEther(tokens(100))
        await stEth.mintShares(user1, tokens(99))
      })

      it('total supply is correct', async () => {
        assert.equals(await stEth.totalSupply(), tokens(100))
      })

      it('balances are correct', async () => {
        assert.equals(await stEth.balanceOf(user1), tokens(99))
        assert.equals(await stEth.balanceOf(user2), tokens(0))
        assert.equals(await stEth.balanceOf(user3), tokens(0))
      })

      context('transfer', async () => {
        it('reverts when recipient is the zero address', async () => {
          await assert.reverts(stEth.transfer(ZERO_ADDRESS, tokens(1), { from: user1 }), 'TRANSFER_TO_ZERO_ADDR')
        })

        it('reverts when recipient is the `stETH` contract itself', async () => {
          await assert.reverts(stEth.transfer(stEth.address, tokens(1), { from: user1 }), 'TRANSFER_TO_STETH_CONTRACT')
        })

        it('reverts when the sender does not have enough balance', async () => {
          await assert.reverts(stEth.transfer(user2, tokens(101), { from: user1 }), 'BALANCE_EXCEEDED')
          await assert.reverts(stEth.transfer(user1, bn('1'), { from: user2 }), 'BALANCE_EXCEEDED')
        })

        it('transfer all balance works and emits event', async () => {
          const amount = await stEth.balanceOf(user1)
          const receipt = await stEth.transfer(user2, amount, { from: user1 })
          const sharesAmount = await stEth.getSharesByPooledEth(amount)
          assert.emitsNumberOfEvents(receipt, 'Transfer', 1)
          assert.emitsNumberOfEvents(receipt, 'TransferShares', 1)
          assert.emits(receipt, 'Transfer', { from: user1, to: user2, value: amount })
          assert.emits(receipt, 'TransferShares', {
            from: user1,
            to: user2,
            sharesValue: sharesAmount,
          })
          assert.equals(await stEth.balanceOf(user1), tokens(0))
          assert.equals(await stEth.balanceOf(user2), tokens(99))
        })

        it('transfer zero tokens works and emits event', async () => {
          const amount = bn('0')
          const sharesAmount = bn('0')
          const receipt = await stEth.transfer(user2, amount, { from: user1 })
          assert.emitsNumberOfEvents(receipt, 'Transfer', 1)
          assert.emitsNumberOfEvents(receipt, 'TransferShares', 1)
          assert.emits(receipt, 'Transfer', { from: user1, to: user2, value: amount })
          assert.emits(receipt, 'TransferShares', {
            from: user1,
            to: user2,
            sharesValue: sharesAmount,
          })
          assert.equals(await stEth.balanceOf(user1), tokens(99))
          assert.equals(await stEth.balanceOf(user2), tokens(0))
        })
      })

      context('approve', async () => {
        it('reverts when spender is zero address', async () => {
          await assert.reverts(stEth.approve(ZERO_ADDRESS, tokens(1), { from: user1 }))
        })

        it('approve without any tokens works', async () => {
          const amount = tokens(1)
          const receipt = await stEth.approve(user1, amount, { from: user2 })
          assert.emits(receipt, 'Approval', { owner: user2, spender: user1, value: amount })
          assert.equals(await stEth.allowance(user2, user1), amount)
        })

        context('when the spender had no approved amount before', () => {
          it('approve requested amount works and emits event', async () => {
            const amount = tokens(50)
            const receipt = await stEth.approve(user2, amount, { from: user1 })
            assert.emits(receipt, 'Approval', { owner: user1, spender: user2, value: amount })
            assert.equals(await stEth.allowance(user1, user2), amount)
          })

          context('when the spender had an approved amount', () => {
            it('approve requested amount replaces old allowance and emits event', async () => {
              const amount = tokens(100)
              const receipt = await stEth.approve(user2, amount, { from: user1 })
              assert.emits(receipt, 'Approval', { owner: user1, spender: user2, value: amount })
              assert.equals(await stEth.allowance(user1, user2), amount)
            })
          })
        })
      })

      context('transferFrom', async () => {
        beforeEach(async () => {
          await stEth.approve(user2, tokens(50), { from: user1 })
          await stEth.approve(user2, tokens(50), { from: user3 }) // user3 has no tokens
        })

        it('reverts when recipient is zero address', async () => {
          await assert.reverts(
            stEth.transferFrom(user1, ZERO_ADDRESS, tokens(1), { from: user2 }),
            'TRANSFER_TO_ZERO_ADDR'
          )
        })

        it('reverts when recipient is the `stETH` contract itself', async () => {
          await assert.reverts(
            stEth.transferFrom(user1, stEth.address, tokens(1), { from: user2 }),
            'TRANSFER_TO_STETH_CONTRACT'
          )
        })

        it('reverts when sender is zero address', async () => {
          await assert.reverts(
            stEth.transferFrom(ZERO_ADDRESS, user3, tokens(0), { from: user2 }),
            'APPROVE_FROM_ZERO_ADDR'
          )
        })

        it('reverts when amount exceeds allowance', async () => {
          await assert.reverts(stEth.transferFrom(user1, user3, tokens(501), { from: user2 }))
        })

        it('reverts if owner has not any tokens', async () => {
          await assert.reverts(stEth.transferFrom(user3, user1, tokens(1), { from: user2 }))
        })

        it('transferFrom works and emits events', async () => {
          const amount = tokens(50)
          const sharesAmount = await stEth.getSharesByPooledEth(amount)
          const receipt = await stEth.transferFrom(user1, user3, amount, { from: user2 })
          assert.emitsNumberOfEvents(receipt, 'Transfer', 1)
          assert.emitsNumberOfEvents(receipt, 'TransferShares', 1)
          assert.emitsNumberOfEvents(receipt, 'Approval', 1)
          assert.emits(receipt, 'Approval', { owner: user1, spender: user2, value: bn(0) })
          assert.emits(receipt, 'Transfer', { from: user1, to: user3, value: amount })
          assert.emits(receipt, 'TransferShares', {
            from: user1,
            to: user3,
            sharesValue: sharesAmount,
          })
          assert.equals(await stEth.allowance(user1, user2), bn(0))
          assert.equals(await stEth.balanceOf(user1), tokens(49))
          assert.equals(await stEth.balanceOf(user3), tokens(50))
        })

        it("doesn't spent allowance if it was set to MAX_UINT256", async () => {
          await stEth.approve(user2, MAX_UINT256, { from: user1 })
          assert.equals(await stEth.allowance(user1, user2), bn(MAX_UINT256))
          const amount = tokens(50)
          const receipt = await stEth.transferFrom(user1, user3, amount, { from: user2 })
          assert.emitsNumberOfEvents(receipt, 'Transfer', 1)
          assert.emitsNumberOfEvents(receipt, 'TransferShares', 1)
          assert.emitsNumberOfEvents(receipt, 'Approval', 0)
          assert.emits(receipt, 'Transfer', { from: user1, to: user3, value: amount })
          const sharesAmount = await stEth.getSharesByPooledEth(amount)
          assert.emits(receipt, 'TransferShares', {
            from: user1,
            to: user3,
            sharesValue: sharesAmount,
          })
          assert.equals(await stEth.allowance(user1, user2), bn(MAX_UINT256))
          assert.equals(await stEth.balanceOf(user1), tokens(49))
          assert.equals(await stEth.balanceOf(user3), tokens(50))
        })
      })

      context('increase allowance', async () => {
        it('reverts when spender is zero address', async () => {
          await assert.reverts(stEth.increaseAllowance(ZERO_ADDRESS, tokens(1), { from: user1 }))
        })

        it('increaseAllowance without any tokens works', async () => {
          const amount = tokens(1)
          const receipt = await stEth.increaseAllowance(user1, amount, { from: user2 })
          assert.emits(receipt, 'Approval', { owner: user2, spender: user1, value: amount })
          assert.equals(await stEth.allowance(user2, user1), amount)
        })

        context('when the spender had no approved amount before', () => {
          it('increaseAllowance with requested amount works and emits event', async () => {
            const amount = tokens(50)
            const receipt = await stEth.increaseAllowance(user2, amount, { from: user1 })
            assert.emits(receipt, 'Approval', { owner: user1, spender: user2, value: amount })
            assert.equals(await stEth.allowance(user1, user2), amount)
          })
        })

        context('when the spender had an approved amount', () => {
          beforeEach(async () => {
            await stEth.approve(user2, tokens(50), { from: user1 })
          })

          it('increaseAllowance with requested amount adds it to allowance and emits event', async () => {
            const increase_amount = tokens(50)
            const increased_amount = tokens(100)
            const receipt = await stEth.increaseAllowance(user2, increase_amount, { from: user1 })
            assert.emits(receipt, 'Approval', {
              owner: user1,
              spender: user2,
              value: increased_amount,
            })
            assert.equals(await stEth.allowance(user1, user2), increased_amount)
          })
        })
      })

      context('decrease allowance', async () => {
        beforeEach(async () => {
          await stEth.approve(user2, tokens(100), { from: user1 })
          await stEth.approve(user1, tokens(100), { from: user2 }) // user2 has no tokens
        })

        it('reverts when spender is zero address', async () => {
          await assert.reverts(stEth.decreaseAllowance(ZERO_ADDRESS, tokens(1), { from: user1 }))
        })

        it('reverts when requested amount exceeds allowance ', async () => {
          await assert.reverts(stEth.decreaseAllowance(user2, tokens(101), { from: user1 }))
        })

        it('reverts when the spender had no approved amount', async () => {
          await assert.reverts(stEth.decreaseAllowance(user3, tokens(1), { from: user1 }))
        })

        it('decreaseAllowance without any tokens works', async () => {
          const decrease_amount = tokens(50)
          const decreased_amount = tokens(50)
          const receipt = await stEth.decreaseAllowance(user1, decrease_amount, { from: user2 })
          assert.emits(receipt, 'Approval', { owner: user2, spender: user1, value: decreased_amount })
          assert.equals(await stEth.allowance(user2, user1), decreased_amount)
        })

        it('decreaseAllowance with requested amount subs it from allowance and emits event', async () => {
          const decrease_amount = tokens(50)
          const decreased_amount = tokens(50)
          const receipt = await stEth.decreaseAllowance(user2, decrease_amount, { from: user1 })
          assert.emits(receipt, 'Approval', { owner: user1, spender: user2, value: decreased_amount })
          assert.equals(await stEth.allowance(user1, user2), decreased_amount)
        })
      })
    })
  })

  context('with non-zero supply', async () => {
    beforeEach(async () => {
      await stEth.setTotalPooledEther(tokens(100))
      await stEth.mintShares(user1, tokens(99)) // 1 ETH is initial hold
    })

    it('stop/resume works', async () => {
      await stEth.transfer(user2, tokens(2), { from: user1 })
      await stEth.approve(user2, tokens(2), { from: user1 })
      await stEth.approve(user1, tokens(2), { from: user2 })
      assert.equals(await stEth.allowance(user1, user2), tokens(2))

      assert.equal(await stEth.isStopped(), false)

      await stEth.stop({ from: user1 })
      assert(await stEth.isStopped())

      // can't stop when stopped
      await assert.reverts(stEth.stop({ from: user1 }))
      assert(await stEth.isStopped())

      await assert.reverts(stEth.transfer(user2, tokens(2), { from: user1 }), 'CONTRACT_IS_STOPPED')
      // NB: can approve if stopped
      await stEth.approve(user2, tokens(2), { from: user1 })
      await assert.reverts(stEth.transferFrom(user2, user3, tokens(2), { from: user1 }), 'CONTRACT_IS_STOPPED')
      // NB: can change allowance if stopped
      await stEth.increaseAllowance(user2, tokens(2), { from: user1 })
      await stEth.decreaseAllowance(user2, tokens(2), { from: user1 })

      await stEth.resume({ from: user1 })
      assert.equal(await stEth.isStopped(), false)

      // can't resume when not stopped
      await assert.reverts(stEth.resume({ from: user1 }))
      assert.equal(await stEth.isStopped(), false)

      await stEth.transfer(user2, tokens(2), { from: user1 })
      assert.equals(await stEth.balanceOf(user1), tokens(95))
      assert.equals(await stEth.balanceOf(user2), tokens(4))
    })

    it('allowance behavior is correct after slashing', async () => {
      await stEth.approve(user2, tokens(75), { from: user1 })

      await stEth.setTotalPooledEther(tokens(50))

      assert.equals(await stEth.balanceOf(user1), tokens(49.5))
      assert.equals(await stEth.sharesOf(user1), tokens(99))

      assert.equals(await stEth.allowance(user1, user2), tokens(75))

      await assert.reverts(stEth.transferFrom(user1, user2, tokens(75), { from: user2 }))
      await assert.reverts(stEth.transferFrom(user1, user2, bn(tokens(50)).addn(10), { from: user2 }))
      await stEth.transferFrom(user1, user2, tokens(49.5), { from: user2 })

      assert.equals(await stEth.balanceOf(user1), tokens(0))
      assert.equals(await stEth.sharesOf(user1), tokens(0))
      assert.equals(await stEth.balanceOf(user2), tokens(49.5))
      assert.equals(await stEth.sharesOf(user2), tokens(99))
    })

    context('mint', () => {
      it('mint works', async () => {
        await stEth.mintShares(user1, tokens(12))

        await stEth.setTotalPooledEther(tokens(112))

        assert.equals(await stEth.totalSupply(), tokens(112))
        assert.equals(await stEth.balanceOf(user1), tokens(111))
        assert.equals(await stEth.balanceOf(user2), tokens(0))
        assert.equals(await stEth.getTotalShares(), tokens(112))
        assert.equals(await stEth.sharesOf(user1), tokens(111))
        assert.equals(await stEth.sharesOf(user2), tokens(0))

        await stEth.mintShares(user2, tokens(4))
        await stEth.setTotalPooledEther(tokens(116))

        assert.equals(await stEth.totalSupply(), tokens(116))
        assert.equals(await stEth.balanceOf(user1), tokens(111))
        assert.equals(await stEth.balanceOf(user2), tokens(4))
        assert.equals(await stEth.getTotalShares(), tokens(116))
        assert.equals(await stEth.sharesOf(user1), tokens(111))
        assert.equals(await stEth.sharesOf(user2), tokens(4))
      })

      it('reverts when mint to zero address', async () => {
        await assert.reverts(stEth.mintShares(ZERO_ADDRESS, tokens(1)))
      })
    })

    context('burn', () => {
      beforeEach(async () => {
        // user1 already had 99 tokens
        // 1 + 99 + 100 + 100 = 300
        await stEth.setTotalPooledEther(ETH(300))
        await stEth.mintShares(user2, tokens(100))
        await stEth.mintShares(user3, tokens(100))
      })

      it('reverts when burn from zero address', async () => {
        await assert.reverts(stEth.burnShares(ZERO_ADDRESS, tokens(1), { from: user1 }), 'BURN_FROM_ZERO_ADDR')
      })

      it('reverts when burn amount exceeds balance', async () => {
        await assert.reverts(stEth.burnShares(user1, tokens(101)), 'BALANCE_EXCEEDED')
      })

      it('burning zero value works', async () => {
        const receipt = await stEth.burnShares(user1, tokens(0))
        assert.emits(receipt, 'SharesBurnt', {
          account: user1,
          preRebaseTokenAmount: tokens(0),
          postRebaseTokenAmount: tokens(0),
          sharesAmount: tokens(0),
        })

        assert.equals(await stEth.totalSupply(), tokens(300))
        assert.equals(await stEth.balanceOf(user1), tokens(99))
        assert.equals(await stEth.balanceOf(user2), tokens(100))
        assert.equals(await stEth.balanceOf(user3), tokens(100))
        assert.equals(await stEth.getTotalShares(), tokens(300))
        assert.equals(await stEth.sharesOf(user1), tokens(99))
        assert.equals(await stEth.sharesOf(user2), tokens(100))
        assert.equals(await stEth.sharesOf(user3), tokens(100))
      })

      it('burning works (redistributes tokens)', async () => {
        const totalShares = await stEth.getTotalShares()
        const totalSupply = await stEth.totalSupply()
        const user2Balance = await stEth.balanceOf(user2)
        const user2Shares = await stEth.sharesOf(user2)

        const sharesToBurn = totalShares.sub(
          totalSupply.mul(totalShares.sub(user2Shares)).div(totalSupply.sub(user2Balance).add(bn(tokens(10))))
        )

        const expectedPreTokenAmount = await stEth.getPooledEthByShares(sharesToBurn)
        const receipt = await stEth.burnShares(user2, sharesToBurn)
        const expectedPostTokenAmount = await stEth.getPooledEthByShares(sharesToBurn)
        assert.emits(receipt, 'SharesBurnt', {
          account: user2,
          preRebaseTokenAmount: expectedPreTokenAmount,
          postRebaseTokenAmount: expectedPostTokenAmount,
          sharesAmount: sharesToBurn,
        })

        assert.equals(await stEth.totalSupply(), tokens(300))
        assert.equals((await stEth.balanceOf(user1)).add(await stEth.balanceOf(INITIAL_HOLDER)), tokens(105))
        assert.equals(await stEth.balanceOf(user2), bn(tokens(90)).subn(1)) // expected round error
        assert.equals(await stEth.balanceOf(user3), tokens(105))
        assert.equals(await stEth.getTotalShares(), bn('285714285714285714285'))
        assert.equals(await stEth.sharesOf(INITIAL_HOLDER), tokens(1))
        assert.equals(await stEth.sharesOf(user1), tokens(99))
        assert.equals(await stEth.sharesOf(user2), bn('85714285714285714285'))
        assert.equals(await stEth.sharesOf(user3), tokens(100))
      })

      it('allowance behavior is correct after burning', async () => {
        await stEth.approve(user3, tokens(75), { from: user2 })

        const totalShares = await stEth.getTotalShares()
        const totalSupply = await stEth.totalSupply()
        const user2Balance = await stEth.balanceOf(user2)
        const user2Shares = await stEth.sharesOf(user2)

        const sharesToBurn = totalShares.sub(
          totalSupply.mul(totalShares.sub(user2Shares)).div(totalSupply.sub(user2Balance).add(bn(tokens(50))))
        )

        const expectedPreTokenAmount = await stEth.getPooledEthByShares(sharesToBurn)
        const receipt = await stEth.burnShares(user2, sharesToBurn)
        const expectedPostTokenAmount = await stEth.getPooledEthByShares(sharesToBurn)
        assert.emits(receipt, 'SharesBurnt', {
          account: user2,
          preRebaseTokenAmount: expectedPreTokenAmount,
          postRebaseTokenAmount: expectedPostTokenAmount,
          sharesAmount: sharesToBurn,
        })

        assert.equals(await stEth.balanceOf(user2), tokens(50))

        assert.equals(await stEth.allowance(user2, user3), tokens(75))

        await assert.reverts(stEth.transferFrom(user2, user3, tokens(75), { from: user3 }))
        await assert.reverts(stEth.transferFrom(user2, user3, bn(tokens(50)).addn(10), { from: user3 }))
        await stEth.transferFrom(user2, user3, tokens(50), { from: user3 })
      })
    })
  })

  context('share-related getters and transfers', async () => {
    context('with initial totalPooledEther (supply)', async () => {
      it('getTotalSupply', async () => {
        assert.equals(await stEth.totalSupply({ from: nobody }), tokens(1))
      })

      it('getTotalShares', async () => {
        assert.equals(await stEth.getTotalShares(), tokens(1))
      })

      it('getTotalPooledEther', async () => {
        assert.equals(await stEth.getTotalPooledEther(), tokens(1))
      })

      it('sharesOf', async () => {
        assert.equals(await stEth.sharesOf(nobody), tokens(0))
      })

      it('getPooledEthByShares', async () => {
        assert.equals(await stEth.getPooledEthByShares(tokens(0)), tokens(0))
        assert.equals(await stEth.getPooledEthByShares(tokens(1)), tokens(1))
        assert.equals(await stEth.getPooledEthByShares(tokens(100)), tokens(100))
      })

      it('balanceOf', async () => {
        assert.equals(await stEth.balanceOf(nobody), tokens(0))
      })

      it('getSharesByPooledEth', async () => {
        assert.equals(await stEth.getSharesByPooledEth(tokens(1)), tokens(1))
        assert.equals(await stEth.getSharesByPooledEth(tokens(0)), tokens(0))
        assert.equals(await stEth.getSharesByPooledEth(tokens(100)), tokens(100))
      })

      it('transferShares', async () => {
        assert.equals(await stEth.balanceOf(nobody), tokens(0))

        const receipt = await stEth.transferShares(user1, tokens(0), { from: nobody })
        assert.emits(receipt, 'Transfer', { from: nobody, to: user1, value: tokens(0) })
        assert.emits(receipt, 'TransferShares', { from: nobody, to: user1, sharesValue: tokens(0) })

        assert.equals(await stEth.balanceOf(nobody), tokens(0))
      })

      it('transferSharesFrom', async () => {
        assert.equals(await stEth.balanceOf(nobody), tokens(0))

        const receipt = await stEth.transferSharesFrom(nobody, user1, tokens(0), { from: user2 })
        assert.emits(receipt, 'Transfer', { from: nobody, to: user1, value: tokens(0) })
        assert.emits(receipt, 'TransferShares', { from: nobody, to: user1, sharesValue: tokens(0) })

        assert.equals(await stEth.balanceOf(nobody), tokens(0))
      })
    })

    context('with additional totalPooledEther (supply)', async () => {
      beforeEach(async () => {
        await stEth.setTotalPooledEther(tokens(100))
        await stEth.mintShares(user1, tokens(99))
      })

      it('getTotalSupply', async () => {
        assert.equals(await stEth.totalSupply(), tokens(100))
      })

      it('getTotalPooledEther', async () => {
        assert.equals(await stEth.getTotalPooledEther(), tokens(100))
      })

      it('getTotalShares', async () => {
        assert.equals(await stEth.getTotalShares(), tokens(100))
      })

      it('sharesOf', async () => {
        assert.equals(await stEth.sharesOf(user1), tokens(99))
      })

      it('getPooledEthByShares', async () => {
        assert.equals(await stEth.getPooledEthByShares(tokens(0)), tokens(0))
        assert.equals(await stEth.getPooledEthByShares(tokens(1)), tokens(1))
        assert.equals(await stEth.getPooledEthByShares(tokens(100)), tokens(100))
      })

      it('balanceOf', async () => {
        assert.equals(await stEth.balanceOf(user1), tokens(99))
        assert.equals(await stEth.balanceOf(user2), tokens(0))
      })

      it('getSharesByPooledEth', async () => {
        assert.equals(await stEth.getSharesByPooledEth(tokens(0)), tokens(0))
        assert.equals(await stEth.getSharesByPooledEth(tokens(1)), tokens(1))
        assert.equals(await stEth.getSharesByPooledEth(tokens(100)), tokens(100))
      })

      it('transferShares', async () => {
        assert.equals(await stEth.balanceOf(user1), tokens(99))
        assert.equals(await stEth.balanceOf(nobody), tokens(0))

        let receipt = await stEth.transferShares(nobody, tokens(0), { from: user1 })
        assert.emitsNumberOfEvents(receipt, 'Transfer', 1)
        assert.emitsNumberOfEvents(receipt, 'TransferShares', 1)
        assert.emits(receipt, 'Transfer', { from: user1, to: nobody, value: tokens(0) })
        assert.emits(receipt, 'TransferShares', { from: user1, to: nobody, sharesValue: tokens(0) })

        assert.equals(await stEth.balanceOf(user1), tokens(99))
        assert.equals(await stEth.balanceOf(nobody), tokens(0))

        receipt = await stEth.transferShares(nobody, tokens(30), { from: user1 })
        assert.emitsNumberOfEvents(receipt, 'Transfer', 1)
        assert.emitsNumberOfEvents(receipt, 'TransferShares', 1)
        assert.emits(receipt, 'Transfer', { from: user1, to: nobody, value: tokens(30) })
        assert.emits(receipt, 'TransferShares', { from: user1, to: nobody, sharesValue: tokens(30) })

        assert.equals(await stEth.balanceOf(user1), tokens(69))
        assert.equals(await stEth.balanceOf(nobody), tokens(30))

        await assert.reverts(stEth.transferShares(nobody, tokens(75), { from: user1 }), 'BALANCE_EXCEEDED')

        await stEth.setTotalPooledEther(tokens(120))

        const tokensToTransfer = tokens((120 * 69) / 100)

        receipt = await stEth.transferShares(nobody, tokens(69), { from: user1 })
        assert.emitsNumberOfEvents(receipt, 'Transfer', 1)
        assert.emitsNumberOfEvents(receipt, 'TransferShares', 1)
        assert.emits(receipt, 'Transfer', { from: user1, to: nobody, value: tokensToTransfer })
        assert.emits(receipt, 'TransferShares', { from: user1, to: nobody, sharesValue: tokens(69) })

        assert.equals(await stEth.balanceOf(user1), tokens(0))
        assert.equals(await stEth.balanceOf(nobody), '118800000000000000000')
      })

      it('transferSharesFrom', async () => {
        assert.equals(await stEth.balanceOf(user1), tokens(99))
        assert.equals(await stEth.balanceOf(nobody), tokens(0))

        let receipt = await stEth.transferSharesFrom(user1, nobody, tokens(0), { from: user2 })
        assert.emitsNumberOfEvents(receipt, 'Transfer', 1)
        assert.emitsNumberOfEvents(receipt, 'TransferShares', 1)
        assert.emits(receipt, 'Transfer', { from: user1, to: nobody, value: tokens(0) })
        assert.emits(receipt, 'TransferShares', { from: user1, to: nobody, sharesValue: tokens(0) })

        assert.equals(await stEth.balanceOf(user1), tokens(99))
        assert.equals(await stEth.balanceOf(nobody), tokens(0))

        await assert.reverts(stEth.transferSharesFrom(user1, nobody, tokens(30), { from: user2 }), `ALLOWANCE_EXCEEDED`)
        await stEth.approve(user2, tokens(30), { from: user1 })
        receipt = await stEth.transferSharesFrom(user1, nobody, tokens(30), { from: user2 })
        assert.emitsNumberOfEvents(receipt, 'Transfer', 1)
        assert.emitsNumberOfEvents(receipt, 'TransferShares', 1)
        assert.emits(receipt, 'Transfer', { from: user1, to: nobody, value: tokens(30) })
        assert.emits(receipt, 'TransferShares', { from: user1, to: nobody, sharesValue: tokens(30) })

        assert.equals(await stEth.balanceOf(user1), tokens(69))
        assert.equals(await stEth.balanceOf(nobody), tokens(30))

        await assert.reverts(stEth.transferSharesFrom(user1, nobody, tokens(75), { from: user2 }), 'ALLOWANCE_EXCEEDED')
        await stEth.approve(user2, tokens(75), { from: user1 })
        await assert.reverts(stEth.transferSharesFrom(user1, nobody, tokens(75), { from: user2 }), 'BALANCE_EXCEEDED')

        await stEth.setTotalPooledEther(tokens(120))

        await assert.reverts(stEth.transferSharesFrom(user1, nobody, tokens(70), { from: user2 }), 'ALLOWANCE_EXCEEDED')

        await stEth.approve(user2, tokens(84), { from: user1 })
        receipt = await stEth.transferSharesFrom(user1, nobody, tokens(69), { from: user2 })
        assert.emitsNumberOfEvents(receipt, 'Transfer', 1)
        assert.emitsNumberOfEvents(receipt, 'TransferShares', 1)
        assert.emits(receipt, 'Transfer', { from: user1, to: nobody, value: '82800000000000000000' })
        assert.emits(receipt, 'TransferShares', { from: user1, to: nobody, sharesValue: tokens(69) })

        assert.equals(await stEth.balanceOf(user1), tokens(0))
        assert.equals(await stEth.balanceOf(nobody), '118800000000000000000')
      })

      it("transferSharesFrom doesn't spent allowance if it was set to MAX_UINT256", async () => {
        await stEth.approve(user2, MAX_UINT256, { from: user1 })
        assert.equals(await stEth.allowance(user1, user2), bn(MAX_UINT256))
        const sharesAmount = shares(50)
        const tokensAmount = await stEth.getPooledEthByShares(sharesAmount)
        const receipt = await stEth.transferSharesFrom(user1, user3, sharesAmount, { from: user2 })
        assert.emitsNumberOfEvents(receipt, 'Transfer', 1)
        assert.emitsNumberOfEvents(receipt, 'TransferShares', 1)
        assert.emitsNumberOfEvents(receipt, 'Approval', 0)
        assert.emits(receipt, 'Transfer', { from: user1, to: user3, value: tokensAmount })
        assert.emits(receipt, 'TransferShares', {
          from: user1,
          to: user3,
          sharesValue: sharesAmount,
        })
        assert.equals(await stEth.allowance(user1, user2), bn(MAX_UINT256))
        assert.equals(await stEth.balanceOf(user1), tokens(49))
        assert.equals(await stEth.balanceOf(user3), tokens(50))
      })
    })
  })
})
