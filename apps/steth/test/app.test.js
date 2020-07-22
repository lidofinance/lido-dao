const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { setOpenPermission } = require('./helpers/permissions')
const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { ONE_DAY, ZERO_ADDRESS, MAX_UINT64, bn, getEventArgument, injectWeb3, injectArtifacts } = require('@aragon/contract-helpers-test')

const StETH = artifacts.require('StETH')


const tokens = (value) => web3.utils.toWei(value + '', 'ether');


contract('StETH', ([appManager, pool, user1, user2]) => {
  let appBase, app

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

    // Initialize the app's proxy.
    await app.initialize();

    // Mint some tokens
    await app.mint(user1, tokens(1000), {from: pool});
  });

  it('ERC20 info is accessible', async () => {
    assert.equal(await app.name(), "Liquid staked Ether 2.0");
    assert.equal(await app.symbol(), "StETH");
    assert.equal(await app.decimals(), 18);
  });
})
