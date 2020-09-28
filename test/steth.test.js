const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { ONE_DAY, ZERO_ADDRESS, MAX_UINT64, bn, getEventArgument, injectWeb3, injectArtifacts } = require('@aragon/contract-helpers-test')

const StETH = artifacts.require('StETH')


const tokens = (value) => web3.utils.toWei(value + '', 'ether');


contract('StETH', ([appManager, pool, user1, user2, user3, nobody]) => {
  let appBase, app, token

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await StETH.new()
  });

  beforeEach('deploy dao and app', async () => {
    const { dao, acl } = await newDao(appManager);

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    const proxyAddress = await newApp(dao, 'steth', appBase.address, appManager);
    app = await StETH.at(proxyAddress);

    // Set up the app's permissions.
    await acl.createPermission(pool, app.address, await app.PAUSE_ROLE(), appManager, {from: appManager});
    await acl.createPermission(pool, app.address, await app.MINT_ROLE(), appManager, {from: appManager});
    await acl.createPermission(pool, app.address, await app.BURN_ROLE(), appManager, {from: appManager});

    // Initialize the app's proxy.
    await app.initialize();
    token = app;

    // Mint some tokens
    await app.mint(user1, tokens(1000), {from: pool});
  });

  it('ERC20 info is accessible', async () => {
    assert.equal(await app.name(), "Liquid staked Ether 2.0");
    assert.equal(await app.symbol(), "StETH");
    assert.equal(await app.decimals(), 18);
  });

  it('ERC20 methods are supported', async () => {
    assertBn(await token.totalSupply({from: nobody}), tokens(1000));
    assertBn(await token.balanceOf(user1, {from: nobody}), tokens(1000));

    // transfer
    await token.transfer(user2, tokens(2), {from: user1});
    assertBn(await token.balanceOf(user1, {from: nobody}), tokens(998));
    assertBn(await token.balanceOf(user2, {from: nobody}), tokens(2));

    await assertRevert(token.transfer(user2, tokens(2), {from: user3}));
    await assertRevert(token.transfer(user3, tokens(2000), {from: user1}));

    // approve
    await token.approve(user2, tokens(3), {from: user1});
    assertBn(await token.allowance(user1, user2, {from: nobody}), tokens(3));
    await token.transferFrom(user1, user3, tokens(2), {from: user2});
    assertBn(await token.allowance(user1, user2, {from: nobody}), tokens(1));
    assertBn(await token.balanceOf(user1, {from: nobody}), tokens(996));
    assertBn(await token.balanceOf(user2, {from: nobody}), tokens(2));
    assertBn(await token.balanceOf(user3, {from: nobody}), tokens(2));

    await assertRevert(token.transferFrom(user1, user3, tokens(2), {from: user2}));
    await assertRevert(token.transferFrom(user2, user3, tokens(2), {from: user2}));
    await assertRevert(token.transferFrom(user1, user3, tokens(2), {from: user3}));
    await assertRevert(token.transferFrom(user2, user3, tokens(2), {from: user3}));
  });

  it('minting works', async () => {
    await token.mint(user1, tokens(12), {from: pool});
    await token.mint(user2, tokens(4), {from: pool});
    assertBn(await token.totalSupply(), tokens(1016));
    assertBn(await token.balanceOf(user1, {from: nobody}), tokens(1012));
    assertBn(await token.balanceOf(user2, {from: nobody}), tokens(4));

    for (const acc of [user1, user2, user3, nobody])
        await assertRevert(token.mint(user2, tokens(4), {from: acc}), 'APP_AUTH_FAILED');
  });

  it('stop/resume works', async () => {
    await token.transfer(user2, tokens(2), {from: user1});
    assert.equal(await token.isStopped(), false);

    await assertRevert(token.stop({from: user1}));
    await token.stop({from: pool});
    await assertRevert(token.stop({from: pool}));
    assert(await token.isStopped());

    await assertRevert(token.transfer(user2, tokens(2), {from: user1}), 'CONTRACT_IS_STOPPED');
    await assertRevert(token.transfer(user2, tokens(2), {from: user3}));
    await assertRevert(token.transferFrom(user1, user3, tokens(2), {from: user2}));

    await assertRevert(token.resume({from: user1}));
    await token.resume({from: pool});
    await assertRevert(token.resume({from: pool}));
    assert.equal(await token.isStopped(), false);

    await token.transfer(user2, tokens(2), {from: user1});
    assertBn(await token.balanceOf(user1, {from: nobody}), tokens(996));
    assertBn(await token.balanceOf(user2, {from: nobody}), tokens(4));
  });

  it('burning works', async () => {
    await token.transfer(user2, tokens(2), {from: user1});

    await token.burn(user1, tokens(2), {from: pool});
    await token.burn(user2, tokens(1), {from: pool});

    assertBn(await token.totalSupply(), tokens(997));
    assertBn(await token.balanceOf(user1, {from: nobody}), tokens(996));
    assertBn(await token.balanceOf(user2, {from: nobody}), tokens(1));

    for (const acc of [user1, user2, user3, nobody]) {
      await assertRevert(token.burn(user1, tokens(4), {from: acc}), 'APP_AUTH_FAILED');
      await assertRevert(token.burn(user3, tokens(4), {from: acc}), 'APP_AUTH_FAILED');
    }

    await assertRevert(token.burn(user2, tokens(4), {from: pool}));

    await token.burn(user1, tokens(96), {from: pool});
    await token.burn(user2, tokens(1), {from: pool});

    assertBn(await token.totalSupply(), tokens(900));
    assertBn(await token.balanceOf(user1, {from: nobody}), tokens(900));
    assertBn(await token.balanceOf(user2, {from: nobody}), 0);
  });
});
