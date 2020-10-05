const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { ONE_DAY, ZERO_ADDRESS, MAX_UINT64, bn, getEventArgument, injectWeb3, injectArtifacts } = require('@aragon/contract-helpers-test')

const StETH = artifacts.require('StETH')
const DePoolMock = artifacts.require('DePoolMock');


const tokens = (value) => web3.utils.toWei(value + '', 'ether');


contract('StETH', ([appManager, pool, user1, user2, user3, nobody]) => {
  let dePool, dePoolBase, stEth, stEthBase

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    stEthBase = await StETH.new()
    dePoolBase = await DePoolMock.new();
  });

  beforeEach('deploy dao and app', async () => {
    const { dao, acl } = await newDao(appManager);

    const stEthProxyAddress = await newApp(dao, 'steth', stEthBase.address, appManager);
    stEth = await StETH.at(stEthProxyAddress);

    // Set up the permissions for token management
    await acl.createPermission(pool, stEth.address, await stEth.PAUSE_ROLE(), appManager, {from: appManager});
    await acl.createPermission(pool, stEth.address, await stEth.MINT_ROLE(), appManager, {from: appManager});
    await acl.createPermission(pool, stEth.address, await stEth.BURN_ROLE(), appManager, {from: appManager});

    const dePoolProxyAddress = await newApp(dao, 'depool', dePoolBase.address, appManager);
    dePool = await DePoolMock.at(dePoolProxyAddress);

    // Initialize the app's proxy.
    await stEth.initialize(dePool.address);
    await dePool.initialize(stEth.address);

  });

  it('ERC20 info is accessible', async () => {
    assert.equal(await stEth.name(), "Liquid staked Ether 2.0");
    assert.equal(await stEth.symbol(), "StETH");
    assert.equal(await stEth.decimals(), 18);
    assertBn(await stEth.totalSupply(), tokens(0));
    assertBn(await stEth.balanceOf(user1), tokens(0));
  });

  context('with non-zero supply', async () => {
    beforeEach(async () => {
      await stEth.mint(user1, tokens(1000), { from: pool });
    });
    it('ERC20 methods behave correctly', async () => {
      assertBn(await stEth.totalSupply({ from: nobody }), tokens(1000));
      assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(1000));

      // transfer
      await stEth.transfer(user2, tokens(2), { from: user1 });
      assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(998));
      assertBn(await stEth.balanceOf(user2, { from: nobody }), tokens(2));

      await assertRevert(stEth.transfer(user2, tokens(2), { from: user3 }));
      await assertRevert(stEth.transfer(user3, tokens(2000), { from: user1 }));

      // approve
      await stEth.approve(user2, tokens(3), { from: user1 });
      assertBn(await stEth.allowance(user1, user2, { from: nobody }), tokens(3));
      await stEth.transferFrom(user1, user3, tokens(2), { from: user2 });
      assertBn(await stEth.allowance(user1, user2, { from: nobody }), tokens(1));
      assertBn(await stEth.balanceOf(user1, { from: nobody }), tokens(996));
      assertBn(await stEth.balanceOf(user2, { from: nobody }), tokens(2));
      assertBn(await stEth.balanceOf(user3, { from: nobody }), tokens(2));

      await assertRevert(stEth.transferFrom(user1, user3, tokens(2), { from: user2 }));
      await assertRevert(stEth.transferFrom(user2, user3, tokens(2), { from: user2 }));
      await assertRevert(stEth.transferFrom(user1, user3, tokens(2), { from: user3 }));
      await assertRevert(stEth.transferFrom(user2, user3, tokens(2), { from: user3 }));
    });
    it('burning works', async () => {
      await stEth.transfer(user2, tokens(2), {from: user1});
  
      await stEth.burn(user1, tokens(2), {from: pool});
      await stEth.burn(user2, tokens(1), {from: pool});
  
      assertBn(await stEth.totalSupply(), tokens(997));
      assertBn(await stEth.balanceOf(user1, {from: nobody}), tokens(996));
      assertBn(await stEth.balanceOf(user2, {from: nobody}), tokens(1));
  
      for (const acc of [user1, user2, user3, nobody]) {
        await assertRevert(stEth.burn(user1, tokens(4), {from: acc}), 'APP_AUTH_FAILED');
        await assertRevert(stEth.burn(user3, tokens(4), {from: acc}), 'APP_AUTH_FAILED');
      }
  
      await assertRevert(stEth.burn(user2, tokens(4), {from: pool}));
  
      await stEth.burn(user1, tokens(96), {from: pool});
      await stEth.burn(user2, tokens(1), {from: pool});
  
      assertBn(await stEth.totalSupply(), tokens(900));
      assertBn(await stEth.balanceOf(user1, {from: nobody}), tokens(900));
      assertBn(await stEth.balanceOf(user2, {from: nobody}), 0);
    });
    it('minting works', async () => {
      await stEth.mint(user1, tokens(12), {from: pool});
      await stEth.mint(user2, tokens(4), {from: pool});
      assertBn(await stEth.totalSupply(), tokens(1016));
      assertBn(await stEth.balanceOf(user1, {from: nobody}), tokens(1012));
      assertBn(await stEth.balanceOf(user2, {from: nobody}), tokens(4));
  
      for (const acc of [user1, user2, user3, nobody])
          await assertRevert(stEth.mint(user2, tokens(4), {from: acc}), 'APP_AUTH_FAILED');
    });
    it('stop/resume works', async () => {
      await stEth.transfer(user2, tokens(2), {from: user1});
      assert.equal(await stEth.isStopped(), false);
  
      await assertRevert(stEth.stop({from: user1}));
      await stEth.stop({from: pool});
      await assertRevert(stEth.stop({from: pool}));
      assert(await stEth.isStopped());
  
      await assertRevert(stEth.transfer(user2, tokens(2), {from: user1}), 'CONTRACT_IS_STOPPED');
      await assertRevert(stEth.transfer(user2, tokens(2), {from: user3}));
      await assertRevert(stEth.transferFrom(user1, user3, tokens(2), {from: user2}));
  
      await assertRevert(stEth.resume({from: user1}));
      await stEth.resume({from: pool});
      await assertRevert(stEth.resume({from: pool}));
      assert.equal(await stEth.isStopped(), false);
  
      await stEth.transfer(user2, tokens(2), {from: user1});
      assertBn(await stEth.balanceOf(user1, {from: nobody}), tokens(996));
      assertBn(await stEth.balanceOf(user2, {from: nobody}), tokens(4));
    });
  });

  context('share-related getters', async () => {
    context('with zero supply', async () => {
      context('with zero totalControlledEther', async () => {
        beforeEach( async () => {
          await dePool.setTotalControlledEther(tokens(0));
        });
        it('getSharesByHolder', async () => {
          assertBn(await stEth.getSharesByHolder(nobody), tokens(0));
        });
        it('getPooledEthByShares', async () => {
          assertBn(await stEth.getPooledEthByShares(tokens(0)), tokens(0));
          assertBn(await stEth.getPooledEthByShares(tokens(1)), tokens(0));
        });
        it('getPooledEthByHolder', async () => {
          assertBn(await stEth.getPooledEthByHolder(nobody), tokens(0));
        });
        it('getSharesByPooledEth', async () => {
          assertBn(await stEth.getSharesByPooledEth(tokens(1)), tokens(0));
          assertBn(await stEth.getSharesByPooledEth(tokens(0)), tokens(0));
          assertBn(await stEth.getSharesByPooledEth(tokens(1000)), tokens(0));
        });
      });
      context('with non-zero totalControlledEther', async () => {
        beforeEach( async () => {
          await dePool.setTotalControlledEther(tokens(1));
        });
        it('getSharesByHolder', async () => {
          assertBn(await stEth.getSharesByHolder(nobody), tokens(0));
        });
        it('getPooledEthByShares', async () => {
          assertBn(await stEth.getPooledEthByShares(tokens(0)), tokens(0));
          assertBn(await stEth.getPooledEthByShares(tokens(1)), tokens(0));
        });
        it('getPooledEthByHolder', async () => {
          assertBn(await stEth.getPooledEthByHolder(nobody), tokens(0));
        });
        it('getSharesByPooledEth', async () => {
          assertBn(await stEth.getSharesByPooledEth(tokens(1)), tokens(0));
          assertBn(await stEth.getSharesByPooledEth(tokens(0)), tokens(0));
          assertBn(await stEth.getSharesByPooledEth(tokens(1000)), tokens(0));
        });
      });
    });
    context('with non-zero supply', async () => {
      context('with zero totalControlledEther', async () => {
        beforeEach( async () => {
          //ToDo processSubmission here to create amounts
          await dePool.setTotalControlledEther(tokens(0));
        });
        it('getSharesByHolder', async () => {
          assertBn(await stEth.getSharesByHolder(nobody), tokens(0));
        });
        it('getPooledEthByShares', async () => {
          assertBn(await stEth.getPooledEthByShares(tokens(0)), tokens(0));
          assertBn(await stEth.getPooledEthByShares(tokens(1)), tokens(0));
        });
        it('getPooledEthByHolder', async () => {
          assertBn(await stEth.getPooledEthByHolder(nobody), tokens(0));
        });
        it('getSharesByPooledEth', async () => {
          assertBn(await stEth.getSharesByPooledEth(tokens(1)), tokens(0));
          assertBn(await stEth.getSharesByPooledEth(tokens(0)), tokens(0));
          assertBn(await stEth.getSharesByPooledEth(tokens(1000)), tokens(0));
        });
      });
      context('with non-zero totalControlledEther', async () => {
        beforeEach( async () => {
          await dePool.setTotalControlledEther(tokens(1));
        });
        it('getSharesByHolder', async () => {
          assertBn(await stEth.getSharesByHolder(nobody), tokens(0));
        });
        it('getPooledEthByShares', async () => {
          assertBn(await stEth.getPooledEthByShares(tokens(0)), tokens(0));
          assertBn(await stEth.getPooledEthByShares(tokens(1)), tokens(0));
        });
        it('getPooledEthByHolder', async () => {
          assertBn(await stEth.getPooledEthByHolder(nobody), tokens(0));
        });
        it('getSharesByPooledEth', async () => {
          assertBn(await stEth.getSharesByPooledEth(tokens(1)), tokens(0));
          assertBn(await stEth.getSharesByPooledEth(tokens(0)), tokens(0));
          assertBn(await stEth.getSharesByPooledEth(tokens(1000)), tokens(0));
        });
      });
    });
  });
});
