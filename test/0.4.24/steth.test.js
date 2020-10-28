const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn, assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const StETH = artifacts.require('StETH')
const DePoolMock = artifacts.require('DePoolMock')

const tokens = (value) => web3.utils.toWei(value + '', 'ether')

contract('StETH', ([appManager, pool, user1, user2, user3, nobody]) => {
  let dePool, dePoolBase, stEth, stEthBase

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    stEthBase = await StETH.new()
    dePoolBase = await DePoolMock.new()
  })

  beforeEach('deploy dao and app', async () => {
    const { dao, acl } = await newDao(appManager)

    const stEthProxyAddress = await newApp(dao, 'steth', stEthBase.address, appManager)
    stEth = await StETH.at(stEthProxyAddress)

    // Set up the permissions for token management
    await acl.createPermission(pool, stEth.address, await stEth.PAUSE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(pool, stEth.address, await stEth.MINT_ROLE(), appManager, { from: appManager })
    await acl.createPermission(pool, stEth.address, await stEth.BURN_ROLE(), appManager, { from: appManager })

    const dePoolProxyAddress = await newApp(dao, 'depool', dePoolBase.address, appManager)
    dePool = await DePoolMock.at(dePoolProxyAddress)

    // Initialize the app's proxy.
    await stEth.initialize(dePool.address)
    await dePool.initialize(stEth.address)
  })

  context('ERC20 methods', () => {
    it('info is correct', async () => {
      assert.equal(await stEth.name(), 'Liquid staked Ether 2.0')
      assert.equal(await stEth.symbol(), 'StETH')
      assert.equal(await stEth.decimals(), 18)
    })

    it('initial balances are correct', async () => {
      assertBn(await stEth.totalSupply(), tokens(0))
      assertBn(await stEth.balanceOf(user1), tokens(0))
    })

    context('with non-zero supply', async () => {
      beforeEach(async () => {
        await stEth.mint(user1, tokens(1000), { from: pool })
        await dePool.setTotalControlledEther(tokens(1000))
      })

      it('balances are correct', async () => {
        assertBn(await stEth.totalSupply({ from: nobody }), tokens(1000))
        assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(1000))
      })

      context('transfer', async () => {
        it('reverts when recipient is zero address', async () => {
          await assertRevert(stEth.transfer(ZERO_ADDRESS, tokens(1), { from: user1 }))
        })

        it('reverts when the sender does not have enough balance', async () => {
          await assertRevert(stEth.transfer(user2, tokens(1001), { from: user1 }))
          await assertRevert(stEth.transfer(user1, bn('1'), { from: user2 }))
        })

        it('transfer all balance works and emits event', async () => {
          const amount = await stEth.balanceOf(user1)
          const receipt = await stEth.transfer(user2, amount, { from: user1 })
          assertEvent(receipt, 'Transfer', { expectedArgs: { from: user1, to: user2, value: amount } })
          assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(0))
          assertBn(await stEth.balanceOf(user2, { from: nobody }), tokens(1000))
        })

        it('transfer zero tokens works and emits event', async () => {
          const amount = bn('0')
          const receipt = await stEth.transfer(user2, amount, { from: user1 })
          assertEvent(receipt, 'Transfer', { expectedArgs: { from: user1, to: user2, value: amount } })
          assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(1000))
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
            const amount = tokens(500)
            const receipt = await stEth.approve(user2, amount, { from: user1 })
            assertEvent(receipt, 'Approval', { expectedArgs: { owner: user1, spender: user2, value: amount } })
            assertBn(await stEth.allowance(user1, user2, { from: nobody }), amount)
          })

          context('when the spender had an approved amount', () => {
            it('approve requested amount replaces old allowance and emits event', async () => {
              const amount = tokens(1000)
              const receipt = await stEth.approve(user2, amount, { from: user1 })
              assertEvent(receipt, 'Approval', { expectedArgs: { owner: user1, spender: user2, value: amount } })
              assertBn(await stEth.allowance(user1, user2, { from: nobody }), amount)
            })
          })
        })
      })

      context('transferFrom', async () => {
        beforeEach(async () => {
          await stEth.approve(user2, tokens(500), { from: user1 })
          await stEth.approve(user2, tokens(500), { from: user3 }) // user3 has no tokens
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
          const amount = tokens(500)
          const receipt = await stEth.transferFrom(user1, user3, amount, { from: user2 })
          // assertEvent(receipt, 'Approval', { expectedArgs: { owner: user1, spender: user2, value: bn(0)}})
          assertEvent(receipt, 'Transfer', { expectedArgs: { from: user1, to: user3, value: amount } })
          assertBn(await stEth.allowance(user2, user1, { from: nobody }), bn(0))
          assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(500))
          assertBn(await stEth.balanceOf(user3, { from: nobody }), tokens(500))
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
            const amount = tokens(500)
            const receipt = await stEth.increaseAllowance(user2, amount, { from: user1 })
            assertEvent(receipt, 'Approval', { expectedArgs: { owner: user1, spender: user2, value: amount } })
            assertBn(await stEth.allowance(user1, user2, { from: nobody }), amount)
          })
        })

        context('when the spender had an approved amount', () => {
          beforeEach(async () => {
            await stEth.approve(user2, tokens(500), { from: user1 })
          })

          it('increaseAllowance with requested amount adds it to allowance and emits event', async () => {
            const increase_amount = tokens(500)
            const increased_amount = tokens(1000)
            const receipt = await stEth.increaseAllowance(user2, increase_amount, { from: user1 })
            assertEvent(receipt, 'Approval', { expectedArgs: { owner: user1, spender: user2, value: increased_amount } })
            assertBn(await stEth.allowance(user1, user2, { from: nobody }), increased_amount)
          })
        })
      })

      context('decrease allowance', async () => {
        beforeEach(async () => {
          await stEth.approve(user2, tokens(1000), { from: user1 })
          await stEth.approve(user1, tokens(1000), { from: user2 }) // user2 has no tokens
        })

        it('reverts when spender is zero address', async () => {
          await assertRevert(stEth.decreaseAllowance(ZERO_ADDRESS, tokens(1), { from: user1 }))
        })

        it('reverts when requested amount exceeds allowance ', async () => {
          await assertRevert(stEth.decreaseAllowance(user2, tokens(1001), { from: user1 }))
        })

        it('reverts when the spender had no approved amount', async () => {
          await assertRevert(stEth.decreaseAllowance(user3, tokens(1), { from: user1 }))
        })

        it('decreaseAllowance without any tokens works', async () => {
          const decrease_amount = tokens(500)
          const decreased_amount = tokens(500)
          const receipt = await stEth.decreaseAllowance(user1, decrease_amount, { from: user2 })
          assertEvent(receipt, 'Approval', { expectedArgs: { owner: user2, spender: user1, value: decreased_amount } })
          assertBn(await stEth.allowance(user2, user1, { from: nobody }), decreased_amount)
        })

        it('decreaseAllowance with requested amount subs it from allowance and emits event', async () => {
          const decrease_amount = tokens(500)
          const decreased_amount = tokens(500)
          const receipt = await stEth.decreaseAllowance(user2, decrease_amount, { from: user1 })
          assertEvent(receipt, 'Approval', { expectedArgs: { owner: user1, spender: user2, value: decreased_amount } })
          assertBn(await stEth.allowance(user1, user2, { from: nobody }), decreased_amount)
        })
      })
    })
  })

  context('with non-zero supply', async () => {
    beforeEach(async () => {
      await stEth.mint(user1, tokens(1000), { from: pool })
      await dePool.setTotalControlledEther(tokens(1000)) // assume this is done by depool
    })

    it('stop/resume works', async () => {
      await stEth.transfer(user2, tokens(2), { from: user1 })
      await stEth.approve(user2, tokens(2), { from: user1 })
      assertBn(await stEth.allowance(user1, user2), tokens(2))

      assert.equal(await stEth.isStopped(), false)

      await assertRevert(stEth.stop({ from: user1 }))
      assert.equal(await stEth.isStopped(), false)

      await stEth.stop({ from: pool })
      assert(await stEth.isStopped())

      await assertRevert(stEth.stop({ from: pool }))
      assert(await stEth.isStopped())

      await assertRevert(stEth.transfer(user2, tokens(2), { from: user1 }), 'CONTRACT_IS_STOPPED')
      await assertRevert(stEth.approve(user2, tokens(2), { from: user1 }), 'CONTRACT_IS_STOPPED')
      await assertRevert(stEth.transferFrom(user2, user3, tokens(2), { from: user1 }), 'CONTRACT_IS_STOPPED')
      await assertRevert(stEth.mint(user1, tokens(2), { from: pool }), 'CONTRACT_IS_STOPPED')
      await assertRevert(stEth.burn(user1, tokens(2), { from: pool }), 'CONTRACT_IS_STOPPED')
      await assertRevert(stEth.increaseAllowance(user2, tokens(2), { from: user1 }), 'CONTRACT_IS_STOPPED')
      await assertRevert(stEth.decreaseAllowance(user2, tokens(2), { from: user1 }), 'CONTRACT_IS_STOPPED')

      await assertRevert(stEth.resume({ from: user1 }))
      assert(await stEth.isStopped())

      await stEth.resume({ from: pool })
      assert.equal(await stEth.isStopped(), false)

      await assertRevert(stEth.resume({ from: pool }))
      assert.equal(await stEth.isStopped(), false)

      await stEth.transfer(user2, tokens(2), { from: user1 })
      assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(996))
      assertBn(await stEth.balanceOf(user2, { from: nobody }), tokens(4))
    })

    context('mint', () => {
      it('minting works', async () => {
        await stEth.mint(user1, tokens(12), { from: pool })
        await dePool.setTotalControlledEther(tokens(1012)) // done dy depool

        assertBn(await stEth.totalSupply(), tokens(1012))
        assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(1012))
        assertBn(await stEth.balanceOf(user2, { from: nobody }), tokens(0))
        assertBn(await stEth.getTotalShares(), tokens(1012))
        assertBn(await stEth.getSharesByHolder(user1, { from: nobody }), tokens(1012))
        assertBn(await stEth.getSharesByHolder(user2, { from: nobody }), tokens(0))

        await stEth.mint(user2, tokens(4), { from: pool })
        await dePool.setTotalControlledEther(tokens(1016)) // done dy depool

        assertBn(await stEth.totalSupply(), tokens(1016))
        assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(1012))
        assertBn(await stEth.balanceOf(user2, { from: nobody }), tokens(4))
        assertBn(await stEth.getTotalShares(), tokens(1016))
        assertBn(await stEth.getSharesByHolder(user1, { from: nobody }), tokens(1012))
        assertBn(await stEth.getSharesByHolder(user2, { from: nobody }), tokens(4))
      })

      it('reverts when trying to mint without permission', async () => {
        for (const acc of [user1, user2, user3, nobody]) await assertRevert(stEth.mint(user2, tokens(1), { from: acc }), 'APP_AUTH_FAILED')
      })

      it('reverts when mint to zero address', async () => {
        await assertRevert(stEth.mint(ZERO_ADDRESS, tokens(1), { from: pool }))
      })
    })

    context('burn', () => {
      beforeEach(async () => {
        // user1 already had 1000 tokens
        // 1000 + 1000 + 1000 = 3000
        await stEth.mint(user2, tokens(1000), { from: pool })
        await dePool.setTotalControlledEther(tokens(2000)) // assume this is done by depool
        await stEth.mint(user3, tokens(1000), { from: pool })
        await dePool.setTotalControlledEther(tokens(3000)) // assume this is done by depool
      })

      it('reverts when burn from zero address', async () => {
        await assertRevert(stEth.burn(ZERO_ADDRESS, tokens(1), { from: pool }))
      })

      it('reverts when trying to burn without permission', async () => {
        for (const acc of [user1, user2, user3, nobody]) await assertRevert(stEth.burn(user2, tokens(1), { from: acc }), 'APP_AUTH_FAILED')
      })

      it('burning zero value works', async () => {
        await stEth.burn(user1, tokens(0), { from: pool })
        assertBn(await stEth.totalSupply(), tokens(3000))
        assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(1000))
        assertBn(await stEth.balanceOf(user2, { from: nobody }), tokens(1000))
        assertBn(await stEth.balanceOf(user3, { from: nobody }), tokens(1000))
        assertBn(await stEth.getTotalShares(), tokens(3000))
        assertBn(await stEth.getSharesByHolder(user1, { from: nobody }), tokens(1000))
        assertBn(await stEth.getSharesByHolder(user2, { from: nobody }), tokens(1000))
        assertBn(await stEth.getSharesByHolder(user3, { from: nobody }), tokens(1000))
      })

      it('burning works (redistributes tokens)', async () => {
        await stEth.burn(user1, tokens(100), { from: pool })
        assertBn(await stEth.totalSupply(), tokens(3000))
        assertBn(await stEth.balanceOf(user1, { from: nobody }), bn(tokens(900)).subn(1)) // expected round error
        assertBn(await stEth.balanceOf(user2, { from: nobody }), tokens(1050))
        assertBn(await stEth.balanceOf(user3, { from: nobody }), tokens(1050))
        assertBn(await stEth.getTotalShares(), bn('2857142857142857142857'))
        assertBn(await stEth.getSharesByHolder(user1, { from: nobody }), bn('857142857142857142857'))
        assertBn(await stEth.getSharesByHolder(user2, { from: nobody }), tokens(1000))
        assertBn(await stEth.getSharesByHolder(user3, { from: nobody }), tokens(1000))
      })

      it('allowance behavior is correct after burning', async () => {
        await stEth.approve(user2, tokens(750), { from: user1 })

        await stEth.burn(user1, tokens(500), { from: pool })
        assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(500))

        assertBn(await stEth.allowance(user1, user2, { from: nobody }), tokens(750))

        await assertRevert(stEth.transferFrom(user1, user2, tokens(750), { from: user2 }))
        await assertRevert(stEth.transferFrom(user1, user2, bn(tokens(500)).addn(100), { from: user2 }))
        await stEth.transferFrom(user1, user2, tokens(500), { from: user2 })
      })
    })
  })

  context('share-related getters', async () => {
    context('with zero totalControlledEther (supply)', async () => {
      beforeEach(async () => {
        await dePool.setTotalControlledEther(tokens(0))
      })

      it('getTotalSupply', async () => {
        assertBn(await stEth.totalSupply({ from: nobody }), tokens(0))
      })

      it('getTotalShares', async () => {
        assertBn(await stEth.getTotalShares(), tokens(0))
      })

      it('getSharesByHolder', async () => {
        assertBn(await stEth.getSharesByHolder(nobody), tokens(0))
      })

      it('getPooledEthByShares', async () => {
        assertBn(await stEth.getPooledEthByShares(tokens(0)), tokens(0))
        assertBn(await stEth.getPooledEthByShares(tokens(1)), tokens(0))
        assertBn(await stEth.getPooledEthByShares(tokens(1000)), tokens(0))
      })

      it('getPooledEthByHolder', async () => {
        assertBn(await stEth.getPooledEthByHolder(nobody), tokens(0))
      })

      it('getSharesByPooledEth', async () => {
        assertBn(await stEth.getSharesByPooledEth(tokens(1)), tokens(0))
        assertBn(await stEth.getSharesByPooledEth(tokens(0)), tokens(0))
        assertBn(await stEth.getSharesByPooledEth(tokens(1000)), tokens(0))
      })
    })

    context('with non-zero totalControlledEther (supply)', async () => {
      beforeEach(async () => {
        await stEth.mint(user1, tokens(1000), { from: pool })
        await dePool.setTotalControlledEther(tokens(1000))
      })

      it('getTotalSupply', async () => {
        assertBn(await stEth.totalSupply({ from: nobody }), tokens(1000))
      })

      it('getTotalShares', async () => {
        assertBn(await stEth.getTotalShares(), tokens(1000))
      })

      it('getSharesByHolder', async () => {
        assertBn(await stEth.getSharesByHolder(user1), tokens(1000))
      })

      it('getPooledEthByShares', async () => {
        assertBn(await stEth.getPooledEthByShares(tokens(0)), tokens(0))
        assertBn(await stEth.getPooledEthByShares(tokens(1)), tokens(1))
        assertBn(await stEth.getPooledEthByShares(tokens(1000)), tokens(1000))
      })

      it('getPooledEthByHolder', async () => {
        assertBn(await stEth.getPooledEthByHolder(user1), tokens(1000))
        assertBn(await stEth.getPooledEthByHolder(user2), tokens(0))
      })

      it('getSharesByPooledEth', async () => {
        assertBn(await stEth.getSharesByPooledEth(tokens(0)), tokens(0))
        assertBn(await stEth.getSharesByPooledEth(tokens(1)), tokens(1))
        assertBn(await stEth.getSharesByPooledEth(tokens(1000)), tokens(1000))
      })
    })
  })
})
