const { assert } = require('chai')
const { assertBn, assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const StETH = artifacts.require('StETHMock')

const tokens = (value) => web3.utils.toWei(value + '', 'ether')

contract('StETH', ([_, __, user1, user2, user3, nobody]) => {
  let stEth

  beforeEach('deploy mock token', async () => {
    stEth = await StETH.new()
  })

  context('ERC20 methods', () => {
    it('info is correct', async () => {
      assert.equal(await stEth.name(), 'Liquid staked Ether 2.0')
      assert.equal(await stEth.symbol(), 'stETH')
      assert.equal(await stEth.decimals(), 18)
    })

    context('zero supply', async () => {
      it('initial total supply is correct', async () => {
        assertBn(await stEth.totalSupply(), tokens(0))
      })

      it('initial balances are correct', async () => {
        assertBn(await stEth.balanceOf(user1), tokens(0))
        assertBn(await stEth.balanceOf(user2), tokens(0))
        assertBn(await stEth.balanceOf(user3), tokens(0))
      })

      it('initial allowances are correct', async () => {
        assertBn(await stEth.allowance(user1, user1), tokens(0))
        assertBn(await stEth.allowance(user1, user2), tokens(0))
        assertBn(await stEth.allowance(user1, user3), tokens(0))
        assertBn(await stEth.allowance(user2, user2), tokens(0))
        assertBn(await stEth.allowance(user2, user1), tokens(0))
        assertBn(await stEth.allowance(user2, user3), tokens(0))
        assertBn(await stEth.allowance(user3, user3), tokens(0))
        assertBn(await stEth.allowance(user3, user1), tokens(0))
        assertBn(await stEth.allowance(user3, user2), tokens(0))
      })

      it('approve works', async () => {
        const receipt = await stEth.approve(user2, tokens(1), { from: user1 })
        assertEvent(receipt, 'Approval', { expectedArgs: { owner: user1, spender: user2, value: tokens(1) } })

        assertBn(await stEth.allowance(user1, user2), tokens(1))
      })

      it(`transfers works with no pooled ehter, balances aren't changed`, async () => {
        stEth.transfer(user1, tokens(1), { from: user2 })
        stEth.transfer(user2, tokens(100), { from: user3 })
        stEth.transfer(user3, tokens(1000), { from: user1 })

        assertBn(await stEth.balanceOf(user1), tokens(0))
        assertBn(await stEth.balanceOf(user2), tokens(0))
        assertBn(await stEth.balanceOf(user3), tokens(0))
      })

      it(`balances aren't changed even if total pooled ether increased`, async () => {
        await stEth.setTotalPooledEther(tokens(100))
        assertBn(await stEth.totalSupply(), tokens(100))

        assertBn(await stEth.balanceOf(user1), tokens(0))
        assertBn(await stEth.balanceOf(user2), tokens(0))
        assertBn(await stEth.balanceOf(user3), tokens(0))
      })
    })

    context('with non-zero supply', async () => {
      beforeEach(async () => {
        await stEth.setTotalPooledEther(tokens(100))
        await stEth.mintShares(user1, tokens(100))
      })

      it('total supply is correct', async () => {
        assertBn(await stEth.totalSupply(), tokens(100))
      })

      it('balances are correct', async () => {
        assertBn(await stEth.balanceOf(user1), tokens(100))
        assertBn(await stEth.balanceOf(user2), tokens(0))
        assertBn(await stEth.balanceOf(user3), tokens(0))
      })

      context('transfer', async () => {
        it('reverts when recipient is the zero address', async () => {
          await assertRevert(stEth.transfer(ZERO_ADDRESS, tokens(1), { from: user1 }), 'TRANSFER_TO_THE_ZERO_ADDRESS')
        })

        it('reverts when the sender does not have enough balance', async () => {
          await assertRevert(stEth.transfer(user2, tokens(101), { from: user1 }), 'TRANSFER_AMOUNT_EXCEEDS_BALANCE')
          await assertRevert(stEth.transfer(user1, bn('1'), { from: user2 }), 'TRANSFER_AMOUNT_EXCEEDS_BALANCE')
        })

        it('transfer all balance works and emits event', async () => {
          const amount = await stEth.balanceOf(user1)
          const receipt = await stEth.transfer(user2, amount, { from: user1 })
          assertEvent(receipt, 'Transfer', { expectedArgs: { from: user1, to: user2, value: amount } })
          assertBn(await stEth.balanceOf(user1), tokens(0))
          assertBn(await stEth.balanceOf(user2), tokens(100))
        })

        it('transfer zero tokens works and emits event', async () => {
          const amount = bn('0')
          const receipt = await stEth.transfer(user2, amount, { from: user1 })
          assertEvent(receipt, 'Transfer', { expectedArgs: { from: user1, to: user2, value: amount } })
          assertBn(await stEth.balanceOf(user1), tokens(100))
          assertBn(await stEth.balanceOf(user2), tokens(0))
        })
      })

      context('approve', async () => {
        it('reverts when spender is zero address', async () => {
          await assertRevert(stEth.approve(ZERO_ADDRESS, tokens(1), { from: user1 }))
        })

        it('approve without any tokens works', async () => {
          const amount = tokens(1)
          const receipt = await stEth.approve(user1, amount, { from: user2 })
          assertEvent(receipt, 'Approval', { expectedArgs: { owner: user2, spender: user1, value: amount } })
          assertBn(await stEth.allowance(user2, user1), amount)
        })

        context('when the spender had no approved amount before', () => {
          it('approve requested amount works and emits event', async () => {
            const amount = tokens(50)
            const receipt = await stEth.approve(user2, amount, { from: user1 })
            assertEvent(receipt, 'Approval', { expectedArgs: { owner: user1, spender: user2, value: amount } })
            assertBn(await stEth.allowance(user1, user2), amount)
          })

          context('when the spender had an approved amount', () => {
            it('approve requested amount replaces old allowance and emits event', async () => {
              const amount = tokens(100)
              const receipt = await stEth.approve(user2, amount, { from: user1 })
              assertEvent(receipt, 'Approval', { expectedArgs: { owner: user1, spender: user2, value: amount } })
              assertBn(await stEth.allowance(user1, user2), amount)
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
          await assertRevert(stEth.transferFrom(user1, ZERO_ADDRESS, tokens(1), { from: user2 }), 'TRANSFER_TO_THE_ZERO_ADDRESS')
        })

        it('reverts when sender is zero address', async () => {
          await assertRevert(stEth.transferFrom(ZERO_ADDRESS, user3, tokens(0), { from: user2 }), 'TRANSFER_FROM_THE_ZERO_ADDRESS')
        })

        it('reverts when amount exceeds allowance', async () => {
          await assertRevert(stEth.transferFrom(user1, user3, tokens(501), { from: user2 }))
        })

        it('reverts if owner has not any tokens', async () => {
          await assertRevert(stEth.transferFrom(user3, user1, tokens(1), { from: user2 }))
        })

        it('transferFrom works and emits events', async () => {
          const amount = tokens(50)
          const receipt = await stEth.transferFrom(user1, user3, amount, { from: user2 })
          assertEvent(receipt, 'Approval', { expectedArgs: { owner: user1, spender: user2, value: bn(0) } })
          assertEvent(receipt, 'Transfer', { expectedArgs: { from: user1, to: user3, value: amount } })
          assertBn(await stEth.allowance(user2, user1), bn(0))
          assertBn(await stEth.balanceOf(user1), tokens(50))
          assertBn(await stEth.balanceOf(user3), tokens(50))
        })
      })

      context('increase allowance', async () => {
        it('reverts when spender is zero address', async () => {
          await assertRevert(stEth.increaseAllowance(ZERO_ADDRESS, tokens(1), { from: user1 }))
        })

        it('increaseAllowance without any tokens works', async () => {
          const amount = tokens(1)
          const receipt = await stEth.increaseAllowance(user1, amount, { from: user2 })
          assertEvent(receipt, 'Approval', { expectedArgs: { owner: user2, spender: user1, value: amount } })
          assertBn(await stEth.allowance(user2, user1), amount)
        })

        context('when the spender had no approved amount before', () => {
          it('increaseAllowance with requested amount works and emits event', async () => {
            const amount = tokens(50)
            const receipt = await stEth.increaseAllowance(user2, amount, { from: user1 })
            assertEvent(receipt, 'Approval', { expectedArgs: { owner: user1, spender: user2, value: amount } })
            assertBn(await stEth.allowance(user1, user2), amount)
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
            assertEvent(receipt, 'Approval', { expectedArgs: { owner: user1, spender: user2, value: increased_amount } })
            assertBn(await stEth.allowance(user1, user2), increased_amount)
          })
        })
      })

      context('decrease allowance', async () => {
        beforeEach(async () => {
          await stEth.approve(user2, tokens(100), { from: user1 })
          await stEth.approve(user1, tokens(100), { from: user2 }) // user2 has no tokens
        })

        it('reverts when spender is zero address', async () => {
          await assertRevert(stEth.decreaseAllowance(ZERO_ADDRESS, tokens(1), { from: user1 }))
        })

        it('reverts when requested amount exceeds allowance ', async () => {
          await assertRevert(stEth.decreaseAllowance(user2, tokens(101), { from: user1 }))
        })

        it('reverts when the spender had no approved amount', async () => {
          await assertRevert(stEth.decreaseAllowance(user3, tokens(1), { from: user1 }))
        })

        it('decreaseAllowance without any tokens works', async () => {
          const decrease_amount = tokens(50)
          const decreased_amount = tokens(50)
          const receipt = await stEth.decreaseAllowance(user1, decrease_amount, { from: user2 })
          assertEvent(receipt, 'Approval', { expectedArgs: { owner: user2, spender: user1, value: decreased_amount } })
          assertBn(await stEth.allowance(user2, user1), decreased_amount)
        })

        it('decreaseAllowance with requested amount subs it from allowance and emits event', async () => {
          const decrease_amount = tokens(50)
          const decreased_amount = tokens(50)
          const receipt = await stEth.decreaseAllowance(user2, decrease_amount, { from: user1 })
          assertEvent(receipt, 'Approval', { expectedArgs: { owner: user1, spender: user2, value: decreased_amount } })
          assertBn(await stEth.allowance(user1, user2), decreased_amount)
        })
      })
    })
  })

  context('with non-zero supply', async () => {
    beforeEach(async () => {
      await stEth.setTotalPooledEther(tokens(100))
      await stEth.mintShares(user1, tokens(100))
    })

    it('stop/resume works', async () => {
      await stEth.transfer(user2, tokens(2), { from: user1 })
      await stEth.approve(user2, tokens(2), { from: user1 })
      await stEth.approve(user1, tokens(2), { from: user2 })
      assertBn(await stEth.allowance(user1, user2), tokens(2))

      assert.equal(await stEth.isStopped(), false)

      await stEth.stop({ from: user1 })
      assert(await stEth.isStopped())

      // can't stop when stopped
      await assertRevert(stEth.stop({ from: user1 }))
      assert(await stEth.isStopped())

      await assertRevert(stEth.transfer(user2, tokens(2), { from: user1 }), 'CONTRACT_IS_STOPPED')
      await assertRevert(stEth.approve(user2, tokens(2), { from: user1 }), 'CONTRACT_IS_STOPPED')
      await assertRevert(stEth.transferFrom(user2, user3, tokens(2), { from: user1 }), 'CONTRACT_IS_STOPPED')
      await assertRevert(stEth.increaseAllowance(user2, tokens(2), { from: user1 }), 'CONTRACT_IS_STOPPED')
      await assertRevert(stEth.decreaseAllowance(user2, tokens(2), { from: user1 }), 'CONTRACT_IS_STOPPED')

      await stEth.resume({ from: user1 })
      assert.equal(await stEth.isStopped(), false)

      // can't resume when not stopped
      await assertRevert(stEth.resume({ from: user1 }))
      assert.equal(await stEth.isStopped(), false)

      await stEth.transfer(user2, tokens(2), { from: user1 })
      assertBn(await stEth.balanceOf(user1), tokens(96))
      assertBn(await stEth.balanceOf(user2), tokens(4))
    })

    it('allowance behavior is correct after slashing', async () => {
      await stEth.approve(user2, tokens(75), { from: user1 })

      await stEth.setTotalPooledEther(tokens(50))

      assertBn(await stEth.balanceOf(user1), tokens(50))
      assertBn(await stEth.sharesOf(user1), tokens(100))

      assertBn(await stEth.allowance(user1, user2), tokens(75))

      await assertRevert(stEth.transferFrom(user1, user2, tokens(75), { from: user2 }))
      await assertRevert(stEth.transferFrom(user1, user2, bn(tokens(50)).addn(10), { from: user2 }))
      await stEth.transferFrom(user1, user2, tokens(50), { from: user2 })

      assertBn(await stEth.balanceOf(user1), tokens(0))
      assertBn(await stEth.sharesOf(user1), tokens(0))
      assertBn(await stEth.balanceOf(user2), tokens(50))
      assertBn(await stEth.sharesOf(user2), tokens(100))
    })

    context('mint', () => {
      it('mint works', async () => {
        await stEth.mintShares(user1, tokens(12))

        await stEth.setTotalPooledEther(tokens(112))

        assertBn(await stEth.totalSupply(), tokens(112))
        assertBn(await stEth.balanceOf(user1), tokens(112))
        assertBn(await stEth.balanceOf(user2), tokens(0))
        assertBn(await stEth.getTotalShares(), tokens(112))
        assertBn(await stEth.sharesOf(user1), tokens(112))
        assertBn(await stEth.sharesOf(user2), tokens(0))

        await stEth.mintShares(user2, tokens(4))
        await stEth.setTotalPooledEther(tokens(116))

        assertBn(await stEth.totalSupply(), tokens(116))
        assertBn(await stEth.balanceOf(user1), tokens(112))
        assertBn(await stEth.balanceOf(user2), tokens(4))
        assertBn(await stEth.getTotalShares(), tokens(116))
        assertBn(await stEth.sharesOf(user1), tokens(112))
        assertBn(await stEth.sharesOf(user2), tokens(4))
      })

      it('reverts when mint to zero address', async () => {
        await assertRevert(stEth.mintShares(ZERO_ADDRESS, tokens(1)))
      })
    })

    context('burn', () => {
      beforeEach(async () => {
        // user1 already had 100 tokens
        // 100 + 100 + 100 = 300
        await stEth.setTotalPooledEther(tokens(300))
        await stEth.mintShares(user2, tokens(100))
        await stEth.mintShares(user3, tokens(100))
      })

      it('reverts when burn from zero address', async () => {
        await assertRevert(stEth.burnShares(ZERO_ADDRESS, tokens(1), { from: user1 }), 'BURN_FROM_THE_ZERO_ADDRESS')
      })

      it('reverts when burn amount exceeds balance', async () => {
        await assertRevert(stEth.burnShares(user1, tokens(101)), 'BURN_AMOUNT_EXCEEDS_BALANCE')
      })

      it('burning zero value works', async () => {
        await stEth.burnShares(user1, tokens(0))
        assertBn(await stEth.totalSupply(), tokens(300))
        assertBn(await stEth.balanceOf(user1), tokens(100))
        assertBn(await stEth.balanceOf(user2), tokens(100))
        assertBn(await stEth.balanceOf(user3), tokens(100))
        assertBn(await stEth.getTotalShares(), tokens(300))
        assertBn(await stEth.sharesOf(user1), tokens(100))
        assertBn(await stEth.sharesOf(user2), tokens(100))
        assertBn(await stEth.sharesOf(user3), tokens(100))
      })

      it('burning works (redistributes tokens)', async () => {
        const totalShares = await stEth.getTotalShares()
        const totalSupply = await stEth.totalSupply()
        const user1Balance = await stEth.balanceOf(user1)
        const user1Shares = await stEth.sharesOf(user1)

        const sharesToBurn = totalShares.sub(
          totalSupply.mul(totalShares.sub(user1Shares)).div(totalSupply.sub(user1Balance).add(bn(tokens(10))))
        )

        await stEth.burnShares(user1, sharesToBurn)
        assertBn(await stEth.totalSupply(), tokens(300))
        assertBn(await stEth.balanceOf(user1), bn(tokens(90)).subn(1)) // expected round error
        assertBn(await stEth.balanceOf(user2), tokens(105))
        assertBn(await stEth.balanceOf(user3), tokens(105))
        assertBn(await stEth.getTotalShares(), bn('285714285714285714285'))
        assertBn(await stEth.sharesOf(user1), bn('85714285714285714285'))
        assertBn(await stEth.sharesOf(user2), tokens(100))
        assertBn(await stEth.sharesOf(user3), tokens(100))
      })

      it('allowance behavior is correct after burning', async () => {
        await stEth.approve(user2, tokens(75), { from: user1 })

        const totalShares = await stEth.getTotalShares()
        const totalSupply = await stEth.totalSupply()
        const user1Balance = await stEth.balanceOf(user1)
        const user1Shares = await stEth.sharesOf(user1)

        const sharesToBurn = totalShares.sub(
          totalSupply.mul(totalShares.sub(user1Shares)).div(totalSupply.sub(user1Balance).add(bn(tokens(50))))
        )

        await stEth.burnShares(user1, sharesToBurn)
        assertBn(await stEth.balanceOf(user1), tokens(50))

        assertBn(await stEth.allowance(user1, user2), tokens(75))

        await assertRevert(stEth.transferFrom(user1, user2, tokens(75), { from: user2 }))
        await assertRevert(stEth.transferFrom(user1, user2, bn(tokens(50)).addn(10), { from: user2 }))
        await stEth.transferFrom(user1, user2, tokens(50), { from: user2 })
      })
    })
  })

  context('share-related getters', async () => {
    context('with zero totalPooledEther (supply)', async () => {
      it('getTotalSupply', async () => {
        assertBn(await stEth.totalSupply({ from: nobody }), tokens(0))
      })

      it('getTotalShares', async () => {
        assertBn(await stEth.getTotalShares(), tokens(0))
      })

      it('getTotalPooledEther', async () => {
        assertBn(await stEth.getTotalPooledEther(), tokens(0))
      })

      it('sharesOf', async () => {
        assertBn(await stEth.sharesOf(nobody), tokens(0))
      })

      it('getPooledEthByShares', async () => {
        assertBn(await stEth.getPooledEthByShares(tokens(0)), tokens(0))
        assertBn(await stEth.getPooledEthByShares(tokens(1)), tokens(0))
        assertBn(await stEth.getPooledEthByShares(tokens(100)), tokens(0))
      })

      it('balanceOf', async () => {
        assertBn(await stEth.balanceOf(nobody), tokens(0))
      })

      it('getSharesByPooledEth', async () => {
        assertBn(await stEth.getSharesByPooledEth(tokens(1)), tokens(0))
        assertBn(await stEth.getSharesByPooledEth(tokens(0)), tokens(0))
        assertBn(await stEth.getSharesByPooledEth(tokens(100)), tokens(0))
      })
    })

    context('with non-zero totalPooledEther (supply)', async () => {
      beforeEach(async () => {
        await stEth.setTotalPooledEther(tokens(100))
        await stEth.mintShares(user1, tokens(100))
      })

      it('getTotalSupply', async () => {
        assertBn(await stEth.totalSupply(), tokens(100))
      })

      it('getTotalPooledEther', async () => {
        assertBn(await stEth.getTotalPooledEther(), tokens(100))
      })

      it('getTotalShares', async () => {
        assertBn(await stEth.getTotalShares(), tokens(100))
      })

      it('sharesOf', async () => {
        assertBn(await stEth.sharesOf(user1), tokens(100))
      })

      it('getPooledEthByShares', async () => {
        assertBn(await stEth.getPooledEthByShares(tokens(0)), tokens(0))
        assertBn(await stEth.getPooledEthByShares(tokens(1)), tokens(1))
        assertBn(await stEth.getPooledEthByShares(tokens(100)), tokens(100))
      })

      it('balanceOf', async () => {
        assertBn(await stEth.balanceOf(user1), tokens(100))
        assertBn(await stEth.balanceOf(user2), tokens(0))
      })

      it('getSharesByPooledEth', async () => {
        assertBn(await stEth.getSharesByPooledEth(tokens(0)), tokens(0))
        assertBn(await stEth.getSharesByPooledEth(tokens(1)), tokens(1))
        assertBn(await stEth.getSharesByPooledEth(tokens(100)), tokens(100))
      })
    })
  })
})
