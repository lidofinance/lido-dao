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
const ValidatorRegistrationMock = artifacts.require('ValidatorRegistrationMock.sol')


const pad = (hex, bytesLength) => {
  const absentZeroes = bytesLength * 2 + 2 - hex.length;
  if (absentZeroes > 0)
    hex = '0x' + ('0'.repeat(absentZeroes)) + hex.substr(2);
  return hex;
}


contract('DePool', ([appManager, voting, user1, user2, user3, nobody]) => {
  let appBase, app, validatorRegistration;

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await DePool.new();
    stEthBase = await StETH.new();
    validatorRegistration = await ValidatorRegistrationMock.new();
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
    await app.initialize(token.address, validatorRegistration.address, token.address /* unused */);

    await validatorRegistration.reset();
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

    assert.equal(await app.getWithdrawalCredentials({from: nobody}), pad("0x0202", 32));
  });

  it('addSigningKeys works', async () => {
    // first
    await assertRevert(app.addSigningKeys(1, pad("0x01", 48), pad("0x01", 96), {from: user1}), 'APP_AUTH_FAILED');
    await assertRevert(app.addSigningKeys(1, pad("0x01", 48), pad("0x01", 96), {from: nobody}), 'APP_AUTH_FAILED');

    await assertRevert(app.addSigningKeys(1, pad("0x01", 32), pad("0x01", 96), {from: voting}), 'INVALID_LENGTH');
    await assertRevert(app.addSigningKeys(1, pad("0x01", 48), pad("0x01", 90), {from: voting}), 'INVALID_LENGTH');

    await app.addSigningKeys(1, pad("0x010203", 48), pad("0x01", 96), {from: voting});

    // second
    await assertRevert(app.addSigningKeys(1, pad("0x01", 48), pad("0x01", 96), {from: user1}), 'APP_AUTH_FAILED');
    await assertRevert(app.addSigningKeys(1, pad("0x01", 48), pad("0x01", 96), {from: nobody}), 'APP_AUTH_FAILED');

    await assertRevert(app.addSigningKeys(1, pad("0x01", 32), pad("0x01", 96), {from: voting}), 'INVALID_LENGTH');
    await assertRevert(app.addSigningKeys(1, pad("0x01", 48), pad("0x01", 90), {from: voting}), 'INVALID_LENGTH');

    await app.addSigningKeys(1, pad("0x050505", 48), pad("0x01", 96), {from: voting});
  });

  it('can view keys', async () => {
    // first
    await app.addSigningKeys(1, pad("0x010203", 48), pad("0x01", 96), {from: voting});

    assertBn(await app.getTotalSigningKeyCount({from: nobody}), 1);
    assertBn(await app.getUnusedSigningKeyCount({from: nobody}), 1);
    {const {key, used} = await app.getSigningKey(0, {from: nobody});
    assert.equal(key, pad("0x010203", 48));
    assert.equal(used, false);}

    // second
    await app.addSigningKeys(1, pad("0x050505", 48), pad("0x01", 96), {from: voting});

    assertBn(await app.getTotalSigningKeyCount({from: nobody}), 2);
    assertBn(await app.getUnusedSigningKeyCount({from: nobody}), 2);
    assert.equal((await app.getSigningKey(0, {from: nobody})).key, pad("0x010203", 48));
    {const {key, used} = await app.getSigningKey(1, {from: nobody});
    assert.equal(key, pad("0x050505", 48));
    assert.equal(used, false);}

    await assertRevert(app.getSigningKey(2, {from: nobody}), 'KEY_NOT_FOUND');
    await assertRevert(app.getSigningKey(1000, {from: nobody}), 'KEY_NOT_FOUND');
  });

  it('removeSigningKey works', async () => {
    await app.addSigningKeys(1, pad("0x010203", 48), pad("0x01", 96), {from: voting});

    await assertRevert(app.removeSigningKey(0, {from: user1}), 'APP_AUTH_FAILED');
    await assertRevert(app.removeSigningKey(0, {from: nobody}), 'APP_AUTH_FAILED');

    await app.removeSigningKey(0, {from: voting});
    assertBn(await app.getTotalSigningKeyCount({from: nobody}), 0);
    assertBn(await app.getUnusedSigningKeyCount({from: nobody}), 0);
    await assertRevert(app.removeSigningKey(0, {from: voting}), 'KEY_NOT_FOUND');

    await app.addSigningKeys(1, pad("0x010204", 48), pad("0x01", 96), {from: voting});
    await app.addSigningKeys(1, pad("0x010205", 48), pad("0x01", 96), {from: voting});
    await app.addSigningKeys(1, pad("0x010206", 48), pad("0x01", 96), {from: voting});
    assertBn(await app.getTotalSigningKeyCount({from: nobody}), 3);
    assertBn(await app.getUnusedSigningKeyCount({from: nobody}), 3);

    await app.removeSigningKey(0, {from: voting});
    assertBn(await app.getTotalSigningKeyCount({from: nobody}), 2);
    assertBn(await app.getUnusedSigningKeyCount({from: nobody}), 2);
    assert.equal((await app.getSigningKey(0, {from: nobody})).key, pad("0x010206", 48));
    assert.equal((await app.getSigningKey(1, {from: nobody})).key, pad("0x010205", 48));

    await app.removeSigningKey(1, {from: voting});
    await assertRevert(app.removeSigningKey(1, {from: voting}), 'KEY_NOT_FOUND');
    await assertRevert(app.removeSigningKey(2, {from: voting}), 'KEY_NOT_FOUND');

    assertBn(await app.getTotalSigningKeyCount({from: nobody}), 1);
    assertBn(await app.getUnusedSigningKeyCount({from: nobody}), 1);
    assert.equal((await app.getSigningKey(0, {from: nobody})).key, pad("0x010206", 48));
  });

  it('isEqual works', async () => {
    assert.equal(await app.isEqual("0x", "0x"), true);
    assert.equal(await app.isEqual("0x11", "0x11"), true);
    assert.equal(await app.isEqual("0x1122", "0x1122"), true);
    assert.equal(await app.isEqual("0x112233", "0x112233"), true);

    assert.equal(await app.isEqual("0x", "0x11"), false);
    assert.equal(await app.isEqual("0x", "0x112233"), false);

    assert.equal(await app.isEqual("0x11", "0x12"), false);
    assert.equal(await app.isEqual("0x12", "0x11"), false);
    assert.equal(await app.isEqual("0x11", "0x1112"), false);
    assert.equal(await app.isEqual("0x11", "0x111213"), false);

    assert.equal(await app.isEqual("0x1122", "0x1123"), false);
    assert.equal(await app.isEqual("0x1123", "0x1122"), false);
    assert.equal(await app.isEqual("0x2122", "0x1122"), false);
    assert.equal(await app.isEqual("0x1123", "0x1122"), false);
    assert.equal(await app.isEqual("0x1122", "0x112233"), false);
    assert.equal(await app.isEqual("0x112233", "0x1122"), false);

    assert.equal(await app.isEqual("0x102233", "0x112233"), false);
    assert.equal(await app.isEqual("0x112033", "0x112233"), false);
    assert.equal(await app.isEqual("0x112230", "0x112233"), false);
    assert.equal(await app.isEqual("0x112233", "0x102233"), false);
    assert.equal(await app.isEqual("0x112233", "0x112033"), false);
    assert.equal(await app.isEqual("0x112233", "0x112230"), false);
    assert.equal(await app.isEqual("0x112233", "0x11223344"), false);
    assert.equal(await app.isEqual("0x11223344", "0x112233"), false);
  });

  it('pad64 works', async () => {
    await assertRevert(app.pad64("0x"));
    await assertRevert(app.pad64("0x11"));
    await assertRevert(app.pad64("0x1122"));
    await assertRevert(app.pad64(pad("0x1122", 31)));
    await assertRevert(app.pad64(pad("0x1122", 65)));
    await assertRevert(app.pad64(pad("0x1122", 265)));

    assert.equal(await app.pad64(pad("0x1122", 32)), pad("0x1122", 32) + '0'.repeat(64));
    assert.equal(await app.pad64(pad("0x1122", 36)), pad("0x1122", 36) + '0'.repeat(56));
    assert.equal(await app.pad64(pad("0x1122", 64)), pad("0x1122", 64));
  });

  it('toLittleEndian64 works', async () => {
    await assertRevert(app.toLittleEndian64("0x010203040506070809"));
    assertBn(await app.toLittleEndian64("0x0102030405060708"), bn("0x0807060504030201" + '0'.repeat(48)));
    assertBn(await app.toLittleEndian64("0x0100000000000008"), bn("0x0800000000000001" + '0'.repeat(48)));
    assertBn(await app.toLittleEndian64("0x10"), bn("0x1000000000000000" + '0'.repeat(48)));
  });
});
