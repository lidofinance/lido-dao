const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn, assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const StETH = artifacts.require('MockStETH')

const tokens = (value) => web3.utils.toWei(value + '', 'ether')

contract('StETH', ([appManager, pool, user1, user2, user3, nobody]) => {
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

    it('initial balances are correct', async () => {
      assertBn(await stEth.totalSupply(), tokens(0))
      assertBn(await stEth.balanceOf(user1), tokens(0))
    })

    context('with non-zero supply', async () => {
      beforeEach(async () => {
        await web3.eth.sendTransaction({ to: stEth.address, from: user1, value: tokens(100) })
      })

      it('balances are correct', async () => {
        assertBn(await stEth.totalSupply({ from: nobody }), tokens(100))
        assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(100))
      })

      context('transfer', async () => {
        it('reverts when recipient is zero address', async () => {
          await assertRevert(stEth.transfer(ZERO_ADDRESS, tokens(1), { from: user1 }))
        })

        it('reverts when the sender does not have enough balance', async () => {
          await assertRevert(stEth.transfer(user2, tokens(101), { from: user1 }))
          await assertRevert(stEth.transfer(user1, bn('1'), { from: user2 }))
        })

        it('transfer all balance works and emits event', async () => {
          const amount = await stEth.balanceOf(user1)
          const receipt = await stEth.transfer(user2, amount, { from: user1 })
          assertEvent(receipt, 'Transfer', { expectedArgs: { from: user1, to: user2, value: amount } })
          assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(0))
          assertBn(await stEth.balanceOf(user2, { from: nobody }), tokens(100))
        })

        it('transfer zero tokens works and emits event', async () => {
          const amount = bn('0')
          const receipt = await stEth.transfer(user2, amount, { from: user1 })
          assertEvent(receipt, 'Transfer', { expectedArgs: { from: user1, to: user2, value: amount } })
          assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(100))
          assertBn(await stEth.balanceOf(user2, { from: nobody }), tokens(0))
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
          assertBn(await stEth.allowance(user2, user1, { from: nobody }), amount)
        })

        context('when the spender had no approved amount before', () => {
          it('approve requested amount works and emits event', async () => {
            const amount = tokens(50)
            const receipt = await stEth.approve(user2, amount, { from: user1 })
            assertEvent(receipt, 'Approval', { expectedArgs: { owner: user1, spender: user2, value: amount } })
            assertBn(await stEth.allowance(user1, user2, { from: nobody }), amount)
          })

          context('when the spender had an approved amount', () => {
            it('approve requested amount replaces old allowance and emits event', async () => {
              const amount = tokens(100)
              const receipt = await stEth.approve(user2, amount, { from: user1 })
              assertEvent(receipt, 'Approval', { expectedArgs: { owner: user1, spender: user2, value: amount } })
              assertBn(await stEth.allowance(user1, user2, { from: nobody }), amount)
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
          await assertRevert(stEth.transferFrom(user1, ZERO_ADDRESS, tokens(1), { from: user2 }))
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
          // assertEvent(receipt, 'Approval', { expectedArgs: { owner: user1, spender: user2, value: bn(0)}})
          assertEvent(receipt, 'Transfer', { expectedArgs: { from: user1, to: user3, value: amount } })
          assertBn(await stEth.allowance(user2, user1, { from: nobody }), bn(0))
          assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(50))
          assertBn(await stEth.balanceOf(user3, { from: nobody }), tokens(50))
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
          assertBn(await stEth.allowance(user2, user1, { from: nobody }), amount)
        })

        context('when the spender had no approved amount before', () => {
          it('increaseAllowance with requested amount works and emits event', async () => {
            const amount = tokens(50)
            const receipt = await stEth.increaseAllowance(user2, amount, { from: user1 })
            assertEvent(receipt, 'Approval', { expectedArgs: { owner: user1, spender: user2, value: amount } })
            assertBn(await stEth.allowance(user1, user2, { from: nobody }), amount)
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
            assertBn(await stEth.allowance(user1, user2, { from: nobody }), increased_amount)
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
          assertBn(await stEth.allowance(user2, user1, { from: nobody }), decreased_amount)
        })

        it('decreaseAllowance with requested amount subs it from allowance and emits event', async () => {
          const decrease_amount = tokens(50)
          const decreased_amount = tokens(50)
          const receipt = await stEth.decreaseAllowance(user2, decrease_amount, { from: user1 })
          assertEvent(receipt, 'Approval', { expectedArgs: { owner: user1, spender: user2, value: decreased_amount } })
          assertBn(await stEth.allowance(user1, user2, { from: nobody }), decreased_amount)
        })
      })
    })
  })

  context('with non-zero supply', async () => {
    beforeEach(async () => {
      await web3.eth.sendTransaction({ to: stEth.address, from: user1, value: tokens(100) })
    })

    it('stop/resume works', async () => {
      await stEth.transfer(user2, tokens(2), { from: user1 })
      await stEth.approve(user2, tokens(2), { from: user1 })
      await stEth.approve(user1, tokens(2), { from: user2 })
      assertBn(await stEth.allowance(user1, user2), tokens(2))

      assert.equal(await stEth.isStopped(), false)

      await stEth.stop({ from: user1 })
      assert(await stEth.isStopped())

      await assertRevert(stEth.stop({ from: user1 }))
      assert(await stEth.isStopped())

      await assertRevert(stEth.transfer(user2, tokens(2), { from: user1 }), 'CONTRACT_IS_STOPPED')
      await assertRevert(stEth.approve(user2, tokens(2), { from: user1 }), 'CONTRACT_IS_STOPPED')
      await assertRevert(stEth.transferFrom(user2, user3, tokens(2), { from: user1 }), 'CONTRACT_IS_STOPPED')
      await assertRevert(stEth.increaseAllowance(user2, tokens(2), { from: user1 }), 'CONTRACT_IS_STOPPED')
      await assertRevert(stEth.decreaseAllowance(user2, tokens(2), { from: user1 }), 'CONTRACT_IS_STOPPED')

      await stEth.resume({ from: user1 })
      assert.equal(await stEth.isStopped(), false)

      await assertRevert(stEth.resume({ from: pool }))
      assert.equal(await stEth.isStopped(), false)

      await stEth.transfer(user2, tokens(2), { from: user1 })
      assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(96))
      assertBn(await stEth.balanceOf(user2, { from: nobody }), tokens(4))
    })

    it('allowance behavior is correct after slashing', async () => {
      await stEth.approve(user2, tokens(75), { from: user1 })

      await stEth.setTotalPooledEther(tokens(50))

      assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(50))
      assertBn(await stEth.getSharesOf(user1, { from: nobody }), tokens(100))

      assertBn(await stEth.allowance(user1, user2, { from: nobody }), tokens(75))

      await assertRevert(stEth.transferFrom(user1, user2, tokens(75), { from: user2 }))
      await assertRevert(stEth.transferFrom(user1, user2, bn(tokens(50)).addn(10), { from: user2 }))
      await stEth.transferFrom(user1, user2, tokens(50), { from: user2 })

      assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(0))
      assertBn(await stEth.getSharesOf(user1, { from: nobody }), tokens(0))
      assertBn(await stEth.balanceOf(user2, { from: nobody }), tokens(50))
      assertBn(await stEth.getSharesOf(user2, { from: nobody }), tokens(100))
    })

    //TODO: move to Lido tests
    // context('mint', () => {
    //   it('mint works', async () => {
    //     await stEth.mintShares(user1, tokens(12), { from: pool })
        
    //     await lido.setTotalPooledEther(tokens(1012)) // done dy lido

    //     assertBn(await stEth.totalSupply(), tokens(1012))
    //     assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(1012))
    //     assertBn(await stEth.balanceOf(user2, { from: nobody }), tokens(0))
    //     assertBn(await stEth.getTotalShares(), tokens(1012))
    //     assertBn(await stEth.getSharesOf(user1, { from: nobody }), tokens(1012))
    //     assertBn(await stEth.getSharesOf(user2, { from: nobody }), tokens(0))

    //     await stEth.mintShares(user2, tokens(4), { from: pool })
    //     await lido.setTotalPooledEther(tokens(1016)) // done dy lido

    //     assertBn(await stEth.totalSupply(), tokens(1016))
    //     assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(1012))
    //     assertBn(await stEth.balanceOf(user2, { from: nobody }), tokens(4))
    //     assertBn(await stEth.getTotalShares(), tokens(1016))
    //     assertBn(await stEth.getSharesOf(user1, { from: nobody }), tokens(1012))
    //     assertBn(await stEth.getSharesOf(user2, { from: nobody }), tokens(4))
    //   })

    //   it('reverts when trying to mint without permission', async () => {
    //     for (const acc of [user1, user2, user3, nobody])
    //       await assertRevert(stEth.mintShares(user2, tokens(1), { from: acc }), 'APP_AUTH_FAILED')
    //   })

    //   it('reverts when mint to zero address', async () => {
    //     await assertRevert(stEth.mintShares(ZERO_ADDRESS, tokens(1), { from: pool }))
    //   })
    // })

    // context('burn', () => {
    //   beforeEach(async () => {
    //     // user1 already had 100 tokens
    //     // 100 + 100 + 100 = 300

    //     await web3.eth.sendTransaction({ to: stEth.address, from: user2, value: tokens(100) })
    //     await web3.eth.sendTransaction({ to: stEth.address, from: user3, value: tokens(100) })
    //     await stEth.mintShares(user2, tokens(100), { from: pool })
    //     await lido.setTotalPooledEther(tokens(200)) // assume this is done by lido
    //     await stEth.mintShares(user3, tokens(100), { from: pool })
    //     await lido.setTotalPooledEther(tokens(300)) // assume this is done by lido
    //   })

    //   it('reverts when burn from zero address', async () => {
    //     await assertRevert(stEth.burnShares(ZERO_ADDRESS, tokens(1), { from: pool }))
    //   })

    //   it('reverts when trying to burn without permission', async () => {
    //     for (const acc of [user1, user2, user3, nobody])
    //       await assertRevert(stEth.burnShares(user2, tokens(1), { from: acc }), 'APP_AUTH_FAILED')
    //   })

    //   it('burning zero value works', async () => {
    //     await stEth.burnShares(user1, tokens(0), { from: pool })
    //     assertBn(await stEth.totalSupply(), tokens(300))
    //     assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(100))
    //     assertBn(await stEth.balanceOf(user2, { from: nobody }), tokens(100))
    //     assertBn(await stEth.balanceOf(user3, { from: nobody }), tokens(100))
    //     assertBn(await stEth.getTotalShares(), tokens(300))
    //     assertBn(await stEth.getSharesOf(user1, { from: nobody }), tokens(100))
    //     assertBn(await stEth.getSharesOf(user2, { from: nobody }), tokens(100))
    //     assertBn(await stEth.getSharesOf(user3, { from: nobody }), tokens(100))
    //   })

    //   it('burning works (redistributes tokens)', async () => {
    //     const totalShares = await stEth.getTotalShares()
    //     const totalSupply = await stEth.totalSupply()
    //     const user1Balance = await stEth.balanceOf(user1)
    //     const user1Shares = await stEth.getSharesOf(user1)

    //     const sharesToBurn = totalShares.sub(
    //       totalSupply.mul(totalShares.sub(user1Shares)).div(totalSupply.sub(user1Balance).add(bn(tokens(10))))
    //     )

    //     await stEth.burnShares(user1, sharesToBurn, { from: pool })
    //     assertBn(await stEth.totalSupply(), tokens(300))
    //     assertBn(await stEth.balanceOf(user1, { from: nobody }), bn(tokens(90)).subn(1)) // expected round error
    //     assertBn(await stEth.balanceOf(user2, { from: nobody }), tokens(105))
    //     assertBn(await stEth.balanceOf(user3, { from: nobody }), tokens(105))
    //     assertBn(await stEth.getTotalShares(), bn('2857142857142857142857'))
    //     assertBn(await stEth.getSharesOf(user1, { from: nobody }), bn('857142857142857142857'))
    //     assertBn(await stEth.getSharesOf(user2, { from: nobody }), tokens(100))
    //     assertBn(await stEth.getSharesOf(user3, { from: nobody }), tokens(100))
    //   })

    //   it('allowance behavior is correct after burning', async () => {
    //     await stEth.approve(user2, tokens(75), { from: user1 })

    //     const totalShares = await stEth.getTotalShares()
    //     const totalSupply = await stEth.totalSupply()
    //     const user1Balance = await stEth.balanceOf(user1)
    //     const user1Shares = await stEth.getSharesOf(user1)

    //     const sharesToBurn = totalShares.sub(
    //       totalSupply.mul(totalShares.sub(user1Shares)).div(totalSupply.sub(user1Balance).add(bn(tokens(50))))
    //     )

    //     await stEth.burnShares(user1, sharesToBurn, { from: pool })
    //     assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(50))

    //     assertBn(await stEth.allowance(user1, user2, { from: nobody }), tokens(75))

    //     await assertRevert(stEth.transferFrom(user1, user2, tokens(75), { from: user2 }))
    //     await assertRevert(stEth.transferFrom(user1, user2, bn(tokens(50)).addn(10), { from: user2 }))
    //     await stEth.transferFrom(user1, user2, tokens(50), { from: user2 })
    //   })
    // })
  })

  context('share-related getters', async () => {
    context('with zero totalPooledEther (supply)', async () => {
      it('getTotalSupply', async () => {
        assertBn(await stEth.totalSupply({ from: nobody }), tokens(0))
      })

      it('getTotalShares', async () => {
        assertBn(await stEth.getTotalShares(), tokens(0))
      })

      it('getSharesOf', async () => {
        assertBn(await stEth.getSharesOf(nobody), tokens(0))
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
        await web3.eth.sendTransaction({ to: stEth.address, from: user1, value: tokens(100) })
      })

      it('getTotalSupply', async () => {
        assertBn(await stEth.totalSupply({ from: nobody }), tokens(100))
      })

      it('getTotalShares', async () => {
        assertBn(await stEth.getTotalShares(), tokens(100))
      })

      it('getSharesOf', async () => {
        assertBn(await stEth.getSharesOf(user1), tokens(100))
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
