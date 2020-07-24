const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { ONE_DAY, ZERO_ADDRESS, MAX_UINT64, bn, getEventArgument, injectWeb3, injectArtifacts } = require('@aragon/contract-helpers-test')

const DePool = artifacts.require('DePool.sol')


const pad = (hex, bytesLength) => {
  const absentZeroes = bytesLength * 2 + 2 - hex.length;
  if (absentZeroes > 0)
    hex = '0x' + ('0'.repeat(absentZeroes)) + hex.substr(2);
  return hex;
}


contract('DePool', ([appManager, voting, user1, user2, user3, nobody]) => {
  let appBase, app;

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await DePool.new()
  })

  beforeEach('deploy dao and app', async () => {
    const { dao, acl } = await newDao(appManager)

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    const proxyAddress = await newApp(dao, 'depool', appBase.address, appManager)
    app = await DePool.at(proxyAddress)

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.PAUSE_ROLE(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.MANAGE_FEE(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.MANAGE_WITHDRAWAL_KEY(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.MANAGE_SIGNING_KEYS(), appManager, {from: appManager});

    // Initialize the app's proxy.
    await app.initialize()
  })

  it('setWithdrawalCredentials works', async () => {
    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await assertRevert(app.setWithdrawalCredentials("0x0204", {from: voting}), 'INVALID_LENGTH');
    await assertRevert(app.setWithdrawalCredentials(pad("0x0203", 32), {from: user1}), 'APP_AUTH_FAILED');

    await app.addSigningKey(pad("0x01", 48), pad("0x01", 96 * 12), {from: voting});

    await assertRevert(app.setWithdrawalCredentials(pad("0x0205", 32), {from: voting}), 'SIGNING_KEYS_MUST_BE_REMOVED_FIRST');
    await assertRevert(app.setWithdrawalCredentials("0x0204", {from: voting}), 'INVALID_LENGTH');
    await assertRevert(app.setWithdrawalCredentials(pad("0x0206", 32), {from: user1}), 'APP_AUTH_FAILED');
  });

  it('denominations are correct', async () => {
    assertBn(await app.denominations(0), 1);
    assertBn(await app.denominations(1), 5);
    assertBn(await app.denominations(10), 100000);
    assertBn(await app.denominations(11), 500000);
  });
});
