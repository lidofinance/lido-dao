const { join } = require('path')
const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { ONE_DAY, ZERO_ADDRESS, MAX_UINT64, bn, getEventArgument, injectWeb3, injectArtifacts } = require('@aragon/contract-helpers-test')
const { BN } = require('bn.js');

const TestStakingProvidersRegistry = artifacts.require('TestStakingProvidersRegistry.sol');


const ADDRESS_1 = "0x0000000000000000000000000000000000000001";
const ADDRESS_2 = "0x0000000000000000000000000000000000000002";
const ADDRESS_3 = "0x0000000000000000000000000000000000000003";
const ADDRESS_4 = "0x0000000000000000000000000000000000000004";

const UNLIMITED = 1000000000;


const pad = (hex, bytesLength) => {
  const absentZeroes = bytesLength * 2 + 2 - hex.length;
  if (absentZeroes > 0)
    hex = '0x' + ('0'.repeat(absentZeroes)) + hex.substr(2);
  return hex;
}

const hexConcat = (first, ...rest) => {
  let result = first.startsWith('0x') ? first : '0x' + first;
  rest.forEach(item => {
    result += item.startsWith('0x') ? item.substr(2) : item;
  });
  return result;
}

const ETH = (value) => web3.utils.toWei(value + '', 'ether');
const tokens = ETH;


contract('StakingProvidersRegistry', ([appManager, voting, user1, user2, user3, nobody]) => {
  let appBase, app;

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await TestStakingProvidersRegistry.new();
  })

  beforeEach('deploy dao and app', async () => {
    const { dao, acl } = await newDao(appManager)

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    proxyAddress = await newApp(dao, 'staking-providers-registry', appBase.address, appManager);
    app = await TestStakingProvidersRegistry.at(proxyAddress);

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.SET_POOL(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.MANAGE_SIGNING_KEYS(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.ADD_STAKING_PROVIDER_ROLE(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.SET_STAKING_PROVIDER_ACTIVE_ROLE(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.SET_STAKING_PROVIDER_NAME_ROLE(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.SET_STAKING_PROVIDER_ADDRESS_ROLE(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.SET_STAKING_PROVIDER_LIMIT_ROLE(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.REPORT_STOPPED_VALIDATORS_ROLE(), appManager, {from: appManager});

    // Initialize the app's proxy.
    await app.initialize();
  })

  it('addSigningKeys works', async () => {
    await app.addStakingProvider("1", ADDRESS_1, UNLIMITED, {from: voting});
    await app.addStakingProvider("2", ADDRESS_2, UNLIMITED, {from: voting});

    // first
    await assertRevert(app.addSigningKeys(0, 1, pad("0x01", 48), pad("0x01", 96), {from: user1}), 'APP_AUTH_FAILED');
    await assertRevert(app.addSigningKeys(0, 1, pad("0x01", 48), pad("0x01", 96), {from: nobody}), 'APP_AUTH_FAILED');

    await assertRevert(app.addSigningKeys(0, 0, "0x", "0x", {from: voting}), 'NO_KEYS');
    await assertRevert(app.addSigningKeys(0, 1, pad("0x00", 48), pad("0x01", 96), {from: voting}), 'EMPTY_KEY');
    await assertRevert(app.addSigningKeys(0, 1, pad("0x01", 32), pad("0x01", 96), {from: voting}), 'INVALID_LENGTH');
    await assertRevert(app.addSigningKeys(0, 1, pad("0x01", 48), pad("0x01", 90), {from: voting}), 'INVALID_LENGTH');

    await app.addSigningKeys(0, 1, pad("0x010203", 48), pad("0x01", 96), {from: voting});

    // second
    await assertRevert(app.addSigningKeys(0, 1, pad("0x01", 48), pad("0x01", 96), {from: user1}), 'APP_AUTH_FAILED');
    await assertRevert(app.addSigningKeys(0, 1, pad("0x01", 48), pad("0x01", 96), {from: nobody}), 'APP_AUTH_FAILED');

    await assertRevert(app.addSigningKeys(0, 1, pad("0x01", 32), pad("0x01", 96), {from: voting}), 'INVALID_LENGTH');
    await assertRevert(app.addSigningKeys(0, 1, pad("0x01", 48), pad("0x01", 90), {from: voting}), 'INVALID_LENGTH');

    await app.addSigningKeys(0, 2, hexConcat(pad("0x050505", 48), pad("0x060606", 48)),
                            hexConcat(pad("0x02", 96), pad("0x03", 96)), {from: voting});

    // to the second SP
    await app.addSigningKeys(1, 1, pad("0x070707", 48), pad("0x01", 96), {from: voting});
    await assertRevert(app.addSigningKeys(2, 1, pad("0x080808", 48), pad("0x01", 96), {from: voting}), 'STAKING_PROVIDER_NOT_FOUND');
  });

  it('can view keys', async () => {
    await app.addStakingProvider("1", ADDRESS_1, UNLIMITED, {from: voting});
    await app.addStakingProvider("2", ADDRESS_2, UNLIMITED, {from: voting});

    // first
    await app.addSigningKeys(0, 1, pad("0x010203", 48), pad("0x01", 96), {from: voting});

    assertBn(await app.getTotalSigningKeyCount(0, {from: nobody}), 1);
    assertBn(await app.getUnusedSigningKeyCount(0, {from: nobody}), 1);
    {const {key, depositSignature: sig, used} = await app.getSigningKey(0, 0, {from: nobody});
    assert.equal(key, pad("0x010203", 48));
    assert.equal(sig, pad("0x01", 96));
    assert.equal(used, false);}

    // second
    await app.addSigningKeys(0, 2, hexConcat(pad("0x050505", 48), pad("0x060606", 48)),
                            hexConcat(pad("0x02", 96), pad("0x03", 96)), {from: voting});

    assertBn(await app.getTotalSigningKeyCount(0, {from: nobody}), 3);
    assertBn(await app.getUnusedSigningKeyCount(0, {from: nobody}), 3);
    assert.equal((await app.getSigningKey(0, 0, {from: nobody})).key, pad("0x010203", 48));

    {const {key, depositSignature: sig, used} = await app.getSigningKey(0, 1, {from: nobody});
    assert.equal(key, pad("0x050505", 48));
    assert.equal(sig, pad("0x02", 96));
    assert.equal(used, false);}
    {const {key, depositSignature: sig, used} = await app.getSigningKey(0, 2, {from: nobody});
    assert.equal(key, pad("0x060606", 48));
    assert.equal(sig, pad("0x03", 96));
    assert.equal(used, false);}

    await assertRevert(app.getSigningKey(0, 3, {from: nobody}), 'KEY_NOT_FOUND');
    await assertRevert(app.getSigningKey(0, 1000, {from: nobody}), 'KEY_NOT_FOUND');

    // to the second SP
    await app.addSigningKeys(1, 1, pad("0x070707", 48), pad("0x01", 96), {from: voting});
    assertBn(await app.getTotalSigningKeyCount(1, {from: nobody}), 1);
    assertBn(await app.getUnusedSigningKeyCount(1, {from: nobody}), 1);
    {const {key, depositSignature: sig, used} = await app.getSigningKey(1, 0, {from: nobody});
    assert.equal(key, pad("0x070707", 48));
    assert.equal(sig, pad("0x01", 96));
    assert.equal(used, false);}

    // the first is untouched
    assertBn(await app.getTotalSigningKeyCount(0, {from: nobody}), 3);
    assertBn(await app.getUnusedSigningKeyCount(0, {from: nobody}), 3);
    assert.equal((await app.getSigningKey(0, 0, {from: nobody})).key, pad("0x010203", 48));
    assert.equal((await app.getSigningKey(0, 1, {from: nobody})).key, pad("0x050505", 48));

    await assertRevert(app.getTotalSigningKeyCount(2, {from: nobody}), 'STAKING_PROVIDER_NOT_FOUND');
    await assertRevert(app.getUnusedSigningKeyCount(2, {from: nobody}), 'STAKING_PROVIDER_NOT_FOUND');
  });

  it('removeSigningKey works', async () => {
    await app.addStakingProvider("1", ADDRESS_1, UNLIMITED, {from: voting});
    await app.addStakingProvider("2", ADDRESS_2, UNLIMITED, {from: voting});

    await app.addSigningKeys(0, 1, pad("0x010203", 48), pad("0x01", 96), {from: voting});

    await assertRevert(app.removeSigningKey(0, 0, {from: user1}), 'APP_AUTH_FAILED');
    await assertRevert(app.removeSigningKey(0, 0, {from: nobody}), 'APP_AUTH_FAILED');

    await app.removeSigningKey(0, 0, {from: voting});
    assertBn(await app.getTotalSigningKeyCount(0, {from: nobody}), 0);
    assertBn(await app.getUnusedSigningKeyCount(0, {from: nobody}), 0);
    await assertRevert(app.removeSigningKey(0, 0, {from: voting}), 'KEY_NOT_FOUND');

    // to the second SP
    await app.addSigningKeys(1, 1, pad("0x070707", 48), pad("0x01", 96), {from: voting});

    // again to the first
    await app.addSigningKeys(0, 1, pad("0x010204", 48), pad("0x01", 96), {from: voting});
    await app.addSigningKeys(0, 1, pad("0x010205", 48), pad("0x01", 96), {from: voting});
    await app.addSigningKeys(0, 1, pad("0x010206", 48), pad("0x01", 96), {from: voting});
    assertBn(await app.getTotalSigningKeyCount(0, {from: nobody}), 3);
    assertBn(await app.getUnusedSigningKeyCount(0, {from: nobody}), 3);

    await app.removeSigningKey(0, 0, {from: voting});
    assertBn(await app.getTotalSigningKeyCount(0, {from: nobody}), 2);
    assertBn(await app.getUnusedSigningKeyCount(0, {from: nobody}), 2);
    assert.equal((await app.getSigningKey(0, 0, {from: nobody})).key, pad("0x010206", 48));
    assert.equal((await app.getSigningKey(0, 1, {from: nobody})).key, pad("0x010205", 48));

    await app.removeSigningKey(0, 1, {from: voting});
    await assertRevert(app.removeSigningKey(0, 1, {from: voting}), 'KEY_NOT_FOUND');
    await assertRevert(app.removeSigningKey(0, 2, {from: voting}), 'KEY_NOT_FOUND');

    assertBn(await app.getTotalSigningKeyCount(0, {from: nobody}), 1);
    assertBn(await app.getUnusedSigningKeyCount(0, {from: nobody}), 1);
    assert.equal((await app.getSigningKey(0, 0, {from: nobody})).key, pad("0x010206", 48));

    // back to the second SP
    assert.equal((await app.getSigningKey(1, 0, {from: nobody})).key, pad("0x070707", 48));
    await app.removeSigningKey(1, 0, {from: voting});
    await assertRevert(app.getSigningKey(1, 0, {from: nobody}), 'KEY_NOT_FOUND');
  });
});
