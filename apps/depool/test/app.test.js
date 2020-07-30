const { join } = require('path')
const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { ONE_DAY, ZERO_ADDRESS, MAX_UINT64, bn, getEventArgument, injectWeb3, injectArtifacts } = require('@aragon/contract-helpers-test')

const oldPath = artifacts._artifactsPath;
// FIXME use template
artifacts._artifactsPath = join(config.paths.root, '..', 'steth/artifacts');

const StETH = artifacts.require('StETH.sol')

artifacts._artifactsPath = oldPath;


const DePool = artifacts.require('TestDePool.sol')


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
    appBase = await DePool.new();
    stEthBase = await StETH.new();
  })

  beforeEach('deploy dao and app', async () => {
    const { dao, acl } = await newDao(appManager)

    // token
    let proxyAddress = await newApp(dao, 'steth', stEthBase.address, appManager);
    const token = await StETH.at(proxyAddress);
    await token.initialize();

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    proxyAddress = await newApp(dao, 'depool', appBase.address, appManager);
    app = await DePool.at(proxyAddress);

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.PAUSE_ROLE(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.MANAGE_FEE(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.MANAGE_WITHDRAWAL_KEY(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.MANAGE_SIGNING_KEYS(), appManager, {from: appManager});

    // Initialize the app's proxy.
    await app.initialize(token.address, token.address /* unused */, token.address /* unused */);
  })

  it('setFee works', async () => {
    await app.setFee(110, {from: voting});
    await assertRevert(app.setFee(110, {from: user1}), 'APP_AUTH_FAILED');
    await assertRevert(app.setFee(110, {from: nobody}), 'APP_AUTH_FAILED');

    assertBn(await app.getFee({from: nobody}), 110);
  });

  it('setWithdrawalCredentials works', async () => {
    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await assertRevert(app.setWithdrawalCredentials("0x0204", {from: voting}), 'INVALID_LENGTH');
    await assertRevert(app.setWithdrawalCredentials(pad("0x0203", 32), {from: user1}), 'APP_AUTH_FAILED');

    await app.addSigningKey(pad("0x01", 48), pad("0x01", 96 * 12), {from: voting});

    await assertRevert(app.setWithdrawalCredentials(pad("0x0205", 32), {from: voting}), 'SIGNING_KEYS_MUST_BE_REMOVED_FIRST');
    await assertRevert(app.setWithdrawalCredentials("0x0204", {from: voting}), 'INVALID_LENGTH');
    await assertRevert(app.setWithdrawalCredentials(pad("0x0206", 32), {from: user1}), 'APP_AUTH_FAILED');

    assert.equal(await app.getWithdrawalCredentials({from: nobody}), pad("0x0202", 32));
  });

  it('denominations are correct', async () => {
    assertBn(await app.denominations(0), 1);
    assertBn(await app.denominations(1), 5);
    assertBn(await app.denominations(10), 100000);
    assertBn(await app.denominations(11), 500000);
  });

  it('addSigningKey works', async () => {
    // first
    await assertRevert(app.addSigningKey(pad("0x01", 48), pad("0x01", 96 * 12), {from: user1}), 'APP_AUTH_FAILED');
    await assertRevert(app.addSigningKey(pad("0x01", 48), pad("0x01", 96 * 12), {from: nobody}), 'APP_AUTH_FAILED');

    await assertRevert(app.addSigningKey(pad("0x01", 32), pad("0x01", 96 * 12), {from: voting}), 'INVALID_LENGTH');
    await assertRevert(app.addSigningKey(pad("0x01", 48), pad("0x01", 96), {from: voting}), 'INVALID_LENGTH');

    await app.addSigningKey(pad("0x010203", 48), pad("0x01", 96 * 12), {from: voting});
    await assertRevert(app.addSigningKey(pad("0x010203", 48), pad("0x01", 96 * 12), {from: voting}), 'KEY_ALREADY_EXISTS');

    // second
    await assertRevert(app.addSigningKey(pad("0x01", 48), pad("0x01", 96 * 12), {from: user1}), 'APP_AUTH_FAILED');
    await assertRevert(app.addSigningKey(pad("0x01", 48), pad("0x01", 96 * 12), {from: nobody}), 'APP_AUTH_FAILED');

    await assertRevert(app.addSigningKey(pad("0x01", 32), pad("0x01", 96 * 12), {from: voting}), 'INVALID_LENGTH');
    await assertRevert(app.addSigningKey(pad("0x01", 48), pad("0x01", 96), {from: voting}), 'INVALID_LENGTH');

    await app.addSigningKey(pad("0x050505", 48), pad("0x01", 96 * 12), {from: voting});
    await assertRevert(app.addSigningKey(pad("0x010203", 48), pad("0x01", 96 * 12), {from: voting}), 'KEY_ALREADY_EXISTS');
    await assertRevert(app.addSigningKey(pad("0x050505", 48), pad("0x01", 96 * 12), {from: voting}), 'KEY_ALREADY_EXISTS');
  });

  it('can view keys', async () => {
    // first
    await app.addSigningKey(pad("0x010203", 48), pad("0x01", 96 * 12), {from: voting});

    assertBn(await app.getActiveSigningKeyCount({from: nobody}), 1);
    {const {key, stakedEther} = await app.getActiveSigningKey(0, {from: nobody});
    assert.equal(key, pad("0x010203", 48));
    assertBn(stakedEther, 0);}

    // second
    await app.addSigningKey(pad("0x050505", 48), pad("0x01", 96 * 12), {from: voting});

    assertBn(await app.getActiveSigningKeyCount({from: nobody}), 2);
    assert.equal((await app.getActiveSigningKey(0, {from: nobody})).key, pad("0x010203", 48));
    {const {key, stakedEther} = await app.getActiveSigningKey(1, {from: nobody});
    assert.equal(key, pad("0x050505", 48));
    assertBn(stakedEther, 0);}

    await assertRevert(app.getActiveSigningKey(2, {from: nobody}), 'KEY_NOT_FOUND');
    await assertRevert(app.getActiveSigningKey(1000, {from: nobody}), 'KEY_NOT_FOUND');
  });

  it('removeSigningKey works', async () => {
    await app.addSigningKey(pad("0x010203", 48), pad("0x01", 96 * 12), {from: voting});

    await assertRevert(app.removeSigningKey(pad("0x010203", 48), {from: user1}), 'APP_AUTH_FAILED');
    await assertRevert(app.removeSigningKey(pad("0x010203", 48), {from: nobody}), 'APP_AUTH_FAILED');

    await app.removeSigningKey(pad("0x010203", 48), {from: voting});
    assertBn(await app.getActiveSigningKeyCount({from: nobody}), 0);
    await assertRevert(app.removeSigningKey(pad("0x010203", 48), {from: voting}), 'KEY_NOT_FOUND');

    await app.addSigningKey(pad("0x010204", 48), pad("0x01", 96 * 12), {from: voting});
    await app.addSigningKey(pad("0x010205", 48), pad("0x01", 96 * 12), {from: voting});
    await app.addSigningKey(pad("0x010206", 48), pad("0x01", 96 * 12), {from: voting});
    assertBn(await app.getActiveSigningKeyCount({from: nobody}), 3);

    await app.removeSigningKey(pad("0x010204", 48), {from: voting});
    assertBn(await app.getActiveSigningKeyCount({from: nobody}), 2);
    assert.equal((await app.getActiveSigningKey(0, {from: nobody})).key, pad("0x010206", 48));
    assert.equal((await app.getActiveSigningKey(1, {from: nobody})).key, pad("0x010205", 48));

    await app.removeSigningKey(pad("0x010205", 48), {from: voting});
    await assertRevert(app.removeSigningKey(pad("0x010203", 48), {from: voting}), 'KEY_NOT_FOUND');
    await assertRevert(app.removeSigningKey(pad("0x010205", 48), {from: voting}), 'KEY_NOT_FOUND');

    assertBn(await app.getActiveSigningKeyCount({from: nobody}), 1);
    assert.equal((await app.getActiveSigningKey(0, {from: nobody})).key, pad("0x010206", 48));
  });
});
