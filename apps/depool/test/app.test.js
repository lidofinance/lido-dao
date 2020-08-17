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


const DePool = artifacts.require('TestDePool.sol');
const OracleMock = artifacts.require('OracleMock.sol');
const ValidatorRegistrationMock = artifacts.require('ValidatorRegistrationMock.sol');


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


contract('DePool', ([appManager, voting, user1, user2, user3, nobody]) => {
  let appBase, app, token, oracle, validatorRegistration;

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await DePool.new();
    stEthBase = await StETH.new();
    oracle = await OracleMock.new();
    validatorRegistration = await ValidatorRegistrationMock.new();
  })

  beforeEach('deploy dao and app', async () => {
    const { dao, acl } = await newDao(appManager)

    // token
    let proxyAddress = await newApp(dao, 'steth', stEthBase.address, appManager);
    token = await StETH.at(proxyAddress);
    await token.initialize();

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    proxyAddress = await newApp(dao, 'depool', appBase.address, appManager);
    app = await DePool.at(proxyAddress);

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.PAUSE_ROLE(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.MANAGE_FEE(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.MANAGE_WITHDRAWAL_KEY(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.MANAGE_SIGNING_KEYS(), appManager, {from: appManager});

    await acl.createPermission(app.address, token.address, await token.MINT_ROLE(), appManager, {from: appManager});
    await acl.createPermission(app.address, token.address, await token.BURN_ROLE(), appManager, {from: appManager});

    // Initialize the app's proxy.
    await app.initialize(token.address, validatorRegistration.address, oracle.address);

    await oracle.setPool(app.address);
    await validatorRegistration.reset();
  })

  const checkStat = async ({deposited, remote, liabilities}) => {
    const stat = await app.getEther2Stat();
    assertBn(stat.deposited, deposited, 'deposited ether check');
    assertBn(stat.remote, remote, 'remote ether check');
    assertBn(stat.liabilities, liabilities, 'ether liabilities check');
  };

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

  it('setWithdrawalCredentials resets unused keys', async () => {
    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});

    await app.addSigningKeys(1, pad("0x010203", 48), pad("0x01", 96), {from: voting});
    assertBn(await app.getTotalSigningKeyCount({from: nobody}), 1);
    assertBn(await app.getUnusedSigningKeyCount({from: nobody}), 1);

    await app.setWithdrawalCredentials(pad("0x0203", 32), {from: voting});

    assertBn(await app.getTotalSigningKeyCount({from: nobody}), 0);
    assertBn(await app.getUnusedSigningKeyCount({from: nobody}), 0);
    assert.equal(await app.getWithdrawalCredentials({from: nobody}), pad("0x0203", 32));
  });

  it('addSigningKeys works', async () => {
    // first
    await assertRevert(app.addSigningKeys(1, pad("0x01", 48), pad("0x01", 96), {from: user1}), 'APP_AUTH_FAILED');
    await assertRevert(app.addSigningKeys(1, pad("0x01", 48), pad("0x01", 96), {from: nobody}), 'APP_AUTH_FAILED');

    await assertRevert(app.addSigningKeys(0, "0x", "0x", {from: voting}), 'NO_KEYS');
    await assertRevert(app.addSigningKeys(1, pad("0x00", 48), pad("0x01", 96), {from: voting}), 'EMPTY_KEY');
    await assertRevert(app.addSigningKeys(1, pad("0x01", 32), pad("0x01", 96), {from: voting}), 'INVALID_LENGTH');
    await assertRevert(app.addSigningKeys(1, pad("0x01", 48), pad("0x01", 90), {from: voting}), 'INVALID_LENGTH');

    await app.addSigningKeys(1, pad("0x010203", 48), pad("0x01", 96), {from: voting});

    // second
    await assertRevert(app.addSigningKeys(1, pad("0x01", 48), pad("0x01", 96), {from: user1}), 'APP_AUTH_FAILED');
    await assertRevert(app.addSigningKeys(1, pad("0x01", 48), pad("0x01", 96), {from: nobody}), 'APP_AUTH_FAILED');

    await assertRevert(app.addSigningKeys(1, pad("0x01", 32), pad("0x01", 96), {from: voting}), 'INVALID_LENGTH');
    await assertRevert(app.addSigningKeys(1, pad("0x01", 48), pad("0x01", 90), {from: voting}), 'INVALID_LENGTH');

    await app.addSigningKeys(2, hexConcat(pad("0x050505", 48), pad("0x060606", 48)),
                            hexConcat(pad("0x02", 96), pad("0x03", 96)), {from: voting});
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
    await app.addSigningKeys(2, hexConcat(pad("0x050505", 48), pad("0x060606", 48)),
                            hexConcat(pad("0x02", 96), pad("0x03", 96)), {from: voting});

    assertBn(await app.getTotalSigningKeyCount({from: nobody}), 3);
    assertBn(await app.getUnusedSigningKeyCount({from: nobody}), 3);
    assert.equal((await app.getSigningKey(0, {from: nobody})).key, pad("0x010203", 48));

    {const {key, used} = await app.getSigningKey(1, {from: nobody});
    assert.equal(key, pad("0x050505", 48));
    assert.equal(used, false);}
    {const {key, used} = await app.getSigningKey(2, {from: nobody});
    assert.equal(key, pad("0x060606", 48));
    assert.equal(used, false);}

    await assertRevert(app.getSigningKey(3, {from: nobody}), 'KEY_NOT_FOUND');
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

  it('deposit works', async () => {
    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await app.addSigningKeys(1, pad("0x010203", 48), pad("0x01", 96), {from: voting});
    await app.addSigningKeys(3,
        hexConcat(pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48)),
        hexConcat(pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)),
        {from: voting});

    // +1 ETH
    await web3.eth.sendTransaction({to: app.address, from: user1, value: ETH(1)});
    await checkStat({deposited: 0, remote: 0, liabilities: 0});
    assertBn(await validatorRegistration.totalCalls(), 0);
    assertBn(await app.getTotalControlledEther(), ETH(1));
    assertBn(await app.getBufferedEther(), ETH(1));
    assertBn(await token.balanceOf(user1), tokens(1));

    // +2 ETH
    await app.submit({from: user2, value: ETH(2)});     // another form of a deposit call
    await checkStat({deposited: 0, remote: 0, liabilities: 0});
    assertBn(await validatorRegistration.totalCalls(), 0);
    assertBn(await app.getTotalControlledEther(), ETH(3));
    assertBn(await app.getBufferedEther(), ETH(3));
    assertBn(await token.balanceOf(user2), tokens(2));

    // +30 ETH
    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(30)});
    await checkStat({deposited: ETH(32), remote: 0, liabilities: 0});
    assertBn(await app.getTotalControlledEther(), ETH(33));
    assertBn(await app.getBufferedEther(), ETH(1));
    assertBn(await token.balanceOf(user1), tokens(1));
    assertBn(await token.balanceOf(user2), tokens(2));
    assertBn(await token.balanceOf(user3), tokens(30));

    assertBn(await validatorRegistration.totalCalls(), 1);
    const c0 = await validatorRegistration.calls.call(0);
    assert.equal(c0.pubkey, pad("0x010203", 48));
    assert.equal(c0.withdrawal_credentials, pad("0x0202", 32));
    assert.equal(c0.signature, pad("0x01", 96));
    assertBn(c0.value, ETH(32));

    // +100 ETH
    await web3.eth.sendTransaction({to: app.address, from: user1, value: ETH(100)});
    await checkStat({deposited: ETH(128), remote: 0, liabilities: 0});
    assertBn(await app.getTotalControlledEther(), ETH(133));
    assertBn(await app.getBufferedEther(), ETH(5));
    assertBn(await token.balanceOf(user1), tokens(101));
    assertBn(await token.balanceOf(user2), tokens(2));
    assertBn(await token.balanceOf(user3), tokens(30));
    assertBn(await token.totalSupply(), tokens(133));

    assertBn(await validatorRegistration.totalCalls(), 4);
    const calls = {};
    for (const i of [1, 2, 3]) {
        calls[i] = await validatorRegistration.calls.call(i);
        assert.equal(calls[i].withdrawal_credentials, pad("0x0202", 32));
        assert.equal(calls[i].signature, pad("0x01", 96));
        assertBn(calls[i].value, ETH(32));
    }
    assert.equal(calls[1].pubkey, pad("0x010204", 48));
    assert.equal(calls[2].pubkey, pad("0x010205", 48));
    assert.equal(calls[3].pubkey, pad("0x010206", 48));
  });

  it('key removal is taken into account during deposit', async () => {
    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await app.addSigningKeys(1, pad("0x010203", 48), pad("0x01", 96), {from: voting});
    await app.addSigningKeys(3,
        hexConcat(pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48)),
        hexConcat(pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)),
        {from: voting});

    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(33)});
    assertBn(await validatorRegistration.totalCalls(), 1);
    await assertRevert(app.removeSigningKey(0, {from: voting}), 'KEY_WAS_USED');

    await app.removeSigningKey(1, {from: voting});

    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(100)});
    await assertRevert(app.removeSigningKey(1, {from: voting}), 'KEY_WAS_USED');
    await assertRevert(app.removeSigningKey(2, {from: voting}), 'KEY_WAS_USED');
    assertBn(await validatorRegistration.totalCalls(), 3);
    assertBn(await app.getTotalControlledEther(), ETH(133));
    assertBn(await app.getBufferedEther(), ETH(37));
  });

  it('out of signing keys doesn\'t revert but buffers', async () => {
    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await app.addSigningKeys(1, pad("0x010203", 48), pad("0x01", 96), {from: voting});

    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(100)});
    await checkStat({deposited: ETH(32), remote: 0, liabilities: 0});
    assertBn(await validatorRegistration.totalCalls(), 1);
    assertBn(await app.getTotalControlledEther(), ETH(100));
    assertBn(await app.getBufferedEther(), ETH(100-32));

    // buffer unwinds
    await app.addSigningKeys(3,
        hexConcat(pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48)),
        hexConcat(pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)),
        {from: voting});
    await web3.eth.sendTransaction({to: app.address, from: user1, value: ETH(1)});
    await checkStat({deposited: ETH(96), remote: 0, liabilities: 0});
    assertBn(await validatorRegistration.totalCalls(), 3);
    assertBn(await app.getTotalControlledEther(), ETH(101));
    assertBn(await app.getBufferedEther(), ETH(5));
  });

  it('withdrawal works from buffer', async () => {
    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await app.addSigningKeys(6,
        hexConcat(pad("0x010203", 48), pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48), pad("0x010207", 48), pad("0x010208", 48)),
        hexConcat(pad("0x01", 96), pad("0x01", 96), pad("0x01", 96), pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)),
        {from: voting});

    await web3.eth.sendTransaction({to: app.address, from: user1, value: ETH(1)});
    await web3.eth.sendTransaction({to: app.address, from: user2, value: ETH(2)});
    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(3)});
    assertBn(await app.getTotalControlledEther(), ETH(6));
    assertBn(await token.totalSupply(), tokens(6));
    assertBn(await app.getBufferedEther(), ETH(6));

    await checkStat({deposited: 0, remote: 0, liabilities: 0});

    await assertRevert(app.withdraw(tokens(1), pad("0x1000", 32), {from: nobody}));
    await assertRevert(app.withdraw(tokens(20), pad("0x200", 32), {from: user2}));

    // -2
    await app.withdraw(tokens(2), pad("0x200", 32), {from: user2});
    assertBn(await token.balanceOf(user1), tokens(1));
    assertBn(await token.balanceOf(user2), 0);
    assertBn(await token.balanceOf(user3), tokens(3));
    assertBn(await app.getTotalControlledEther(), ETH(4));
    assertBn(await token.totalSupply(), tokens(4));

    await checkStat({deposited: 0, remote: 0, liabilities: 0});

    assertBn(await app.totalWithdrawalRequests(), 0);

    // -1
    await app.withdraw(tokens(1), pad("0x300", 32), {from: user3});
    assertBn(await token.balanceOf(user1), tokens(1));
    assertBn(await token.balanceOf(user2), 0);
    assertBn(await token.balanceOf(user3), tokens(2));
    assertBn(await app.getTotalControlledEther(), ETH(3));
    assertBn(await token.totalSupply(), tokens(3));

    await checkStat({deposited: 0, remote: 0, liabilities: 0});

    assertBn(await app.totalWithdrawalRequests(), 0);
  });

  it('withdrawal works from Ethereum 2', async () => {
    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await app.addSigningKeys(6,
        hexConcat(pad("0x010203", 48), pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48), pad("0x010207", 48), pad("0x010208", 48)),
        hexConcat(pad("0x01", 96), pad("0x01", 96), pad("0x01", 96), pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)),
        {from: voting});

    await web3.eth.sendTransaction({to: app.address, from: user1, value: ETH(1*32)});
    await web3.eth.sendTransaction({to: app.address, from: user2, value: ETH(2*32)});
    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(3*32)});
    assertBn(await app.getTotalControlledEther(), ETH(6*32));
    assertBn(await token.totalSupply(), tokens(6*32));
    assertBn(await app.getBufferedEther(), 0);

    await checkStat({deposited: ETH(6*32), remote: 0, liabilities: 0});

    await assertRevert(app.withdraw(tokens(1*32), pad("0x1000", 32), {from: nobody}));
    await assertRevert(app.withdraw(tokens(20*32), pad("0x200", 32), {from: user2}));

    // -2*32
    await app.withdraw(tokens(2*32), pad("0x200", 32), {from: user2});
    assertBn(await token.balanceOf(user1), tokens(1*32));
    assertBn(await token.balanceOf(user2), 0);
    assertBn(await token.balanceOf(user3), tokens(3*32));
    assertBn(await app.getTotalControlledEther(), ETH(4*32));
    assertBn(await token.totalSupply(), tokens(4*32));

    assertBn(await app.totalWithdrawalRequests(), 1);
    const r0 = await app.getWithdrawalRequest.call(0);
    assertBn(r0.amount, ETH(2*32));
    assertBn(r0.pubkeyHash, pad("0x200", 32));

    await checkStat({deposited: ETH(6*32), remote: 0, liabilities: ETH(2*32)});

    // -1*32
    await app.withdraw(tokens(1*32), pad("0x300", 32), {from: user3});
    assertBn(await token.balanceOf(user1), tokens(1*32));
    assertBn(await token.balanceOf(user2), 0);
    assertBn(await token.balanceOf(user3), tokens(2*32));
    assertBn(await app.getTotalControlledEther(), ETH(3*32));
    assertBn(await token.totalSupply(), tokens(3*32));

    assertBn(await app.totalWithdrawalRequests(), 2);
    const r1 = await app.getWithdrawalRequest.call(1);
    assertBn(r1.amount, ETH(1*32));
    assertBn(r1.pubkeyHash, pad("0x300", 32));

    await checkStat({deposited: ETH(6*32), remote: 0, liabilities: ETH(3*32)});
  });

  it('withdrawal works from buffer and Ethereum 2', async () => {
    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await app.addSigningKeys(6,
        hexConcat(pad("0x010203", 48), pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48), pad("0x010207", 48), pad("0x010208", 48)),
        hexConcat(pad("0x01", 96), pad("0x01", 96), pad("0x01", 96), pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)),
        {from: voting});

    await web3.eth.sendTransaction({to: app.address, from: user1, value: ETH(1*32)});
    await web3.eth.sendTransaction({to: app.address, from: user2, value: ETH(2*32)});
    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(10)});
    assertBn(await app.getBufferedEther(), ETH(10));

    await checkStat({deposited: ETH(96), remote: 0, liabilities: 0});

    // buffer + withdrawal request
    await app.withdraw(tokens(20), pad("0x200", 32), {from: user2});
    assertBn(await token.balanceOf(user1), tokens(1*32));
    assertBn(await token.balanceOf(user2), tokens(44));
    assertBn(await token.balanceOf(user3), tokens(10));
    assertBn(await app.getTotalControlledEther(), ETH(86));
    assertBn(await token.totalSupply(), tokens(86));

    await checkStat({deposited: ETH(96), remote: 0, liabilities: ETH(10)});
    assertBn(await app.getBufferedEther(), 0);

    assertBn(await app.totalWithdrawalRequests(), 1);
    const r0 = await app.getWithdrawalRequest.call(0);
    assertBn(r0.amount, ETH(10));
    assertBn(r0.pubkeyHash, pad("0x200", 32));

    // buffer is empty
    await app.withdraw(tokens(1), pad("0x300", 32), {from: user3});
    assertBn(await token.balanceOf(user1), tokens(1*32));
    assertBn(await token.balanceOf(user2), tokens(44));
    assertBn(await token.balanceOf(user3), tokens(9));
    assertBn(await app.getTotalControlledEther(), ETH(85));
    assertBn(await token.totalSupply(), tokens(85));

    await checkStat({deposited: ETH(96), remote: 0, liabilities: ETH(11)});
    assertBn(await app.getBufferedEther(), 0);

    assertBn(await app.totalWithdrawalRequests(), 2);
    const r1 = await app.getWithdrawalRequest.call(1);
    assertBn(r1.amount, ETH(1));
    assertBn(r1.pubkeyHash, pad("0x300", 32));
  });

  it('reportEther2 works', async () => {
    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await app.addSigningKeys(1, pad("0x010203", 48), pad("0x01", 96), {from: voting});
    await app.addSigningKeys(3,
        hexConcat(pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48)),
        hexConcat(pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)),
        {from: voting});

    await web3.eth.sendTransaction({to: app.address, from: user2, value: ETH(34)});
    await checkStat({deposited: ETH(32), remote: 0, liabilities: 0});

    await assertRevert(app.reportEther2(100, ETH(30), {from: appManager}), 'APP_AUTH_FAILED');

    await oracle.reportEther2(100, ETH(30));
    await checkStat({deposited: ETH(32), remote: ETH(30), liabilities: 0});

    await assertRevert(app.reportEther2(100, ETH(29), {from: nobody}), 'APP_AUTH_FAILED');
    await assertRevert(oracle.reportEther2(0, ETH(29)), 'ZERO_EPOCH');

    await oracle.reportEther2(50, ETH(100));    // stale data
    await checkStat({deposited: ETH(32), remote: ETH(30), liabilities: 0});

    await oracle.reportEther2(200, ETH(33));
    await checkStat({deposited: ETH(32), remote: ETH(33), liabilities: 0});
  });

  it('oracle data affects deposits', async () => {
    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await app.addSigningKeys(1, pad("0x010203", 48), pad("0x01", 96), {from: voting});
    await app.addSigningKeys(3,
        hexConcat(pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48)),
        hexConcat(pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)),
        {from: voting});

    await web3.eth.sendTransaction({to: app.address, from: user2, value: ETH(34)});
    await checkStat({deposited: ETH(32), remote: 0, liabilities: 0});
    assertBn(await validatorRegistration.totalCalls(), 1);
    assertBn(await app.getTotalControlledEther(), ETH(34));
    assertBn(await app.getBufferedEther(), ETH(2));

    // down
    await oracle.reportEther2(100, ETH(15));

    await checkStat({deposited: ETH(32), remote: ETH(15), liabilities: 0});
    assertBn(await validatorRegistration.totalCalls(), 1);
    assertBn(await app.getTotalControlledEther(), ETH(17));
    assertBn(await app.getBufferedEther(), ETH(2));
    assertBn(await token.totalSupply(), tokens(34));

    // deposit, ratio is 0.5
    await web3.eth.sendTransaction({to: app.address, from: user1, value: ETH(2)});

    await checkStat({deposited: ETH(32), remote: ETH(15), liabilities: 0});
    assertBn(await validatorRegistration.totalCalls(), 1);
    assertBn(await app.getTotalControlledEther(), ETH(19));
    assertBn(await app.getBufferedEther(), ETH(4));
    assertBn(await token.balanceOf(user1), tokens(4));
    assertBn(await token.totalSupply(), tokens(38));

    // up
    await oracle.reportEther2(200, ETH(72));

    await checkStat({deposited: ETH(32), remote: ETH(72), liabilities: 0});
    assertBn(await validatorRegistration.totalCalls(), 1);
    assertBn(await app.getTotalControlledEther(), ETH(76));
    assertBn(await app.getBufferedEther(), ETH(4));
    assertBn(await token.totalSupply(), tokens(38));

    // 2nd deposit, ratio is 2
    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(2)});

    await checkStat({deposited: ETH(32), remote: ETH(72), liabilities: 0});
    assertBn(await validatorRegistration.totalCalls(), 1);
    assertBn(await app.getTotalControlledEther(), ETH(78));
    assertBn(await app.getBufferedEther(), ETH(6));
    assertBn(await token.balanceOf(user1), tokens(4));
    assertBn(await token.balanceOf(user3), tokens(1));
    assertBn(await token.totalSupply(), tokens(39));
  });

  it('oracle data affects withdrawals', async () => {
    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await app.addSigningKeys(6,
        hexConcat(pad("0x010203", 48), pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48), pad("0x010207", 48), pad("0x010208", 48)),
        hexConcat(pad("0x01", 96), pad("0x01", 96), pad("0x01", 96), pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)),
        {from: voting});

    await web3.eth.sendTransaction({to: app.address, from: user1, value: ETH(1*32)});
    await web3.eth.sendTransaction({to: app.address, from: user2, value: ETH(2*32)});
    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(4)});
    assertBn(await app.getBufferedEther(), ETH(4));

    await checkStat({deposited: ETH(96), remote: 0, liabilities: 0});

    // down
    await oracle.reportEther2(100, ETH(71));

    await checkStat({deposited: ETH(96), remote: ETH(71), liabilities: 0});
    assertBn(await token.totalSupply(), tokens(100));

    // buffer + withdrawal request, ratio is 0.5
    await app.withdraw(tokens(20), pad("0x200", 32), {from: user2});
    assertBn(await token.balanceOf(user1), tokens(1*32));
    assertBn(await token.balanceOf(user2), tokens(44));
    assertBn(await token.balanceOf(user3), tokens(4));
    assertBn(await app.getTotalControlledEther(), ETH(60));
    assertBn(await token.totalSupply(), tokens(80));

    await checkStat({deposited: ETH(96), remote: ETH(71), liabilities: ETH(11)});
    assertBn(await app.getBufferedEther(), 0);

    assertBn(await app.totalWithdrawalRequests(), 1);
    const r0 = await app.getWithdrawalRequest.call(0);
    assertBn(r0.amount, ETH(11));
    assertBn(r0.pubkeyHash, pad("0x200", 32));

    // up
    await oracle.reportEther2(200, ETH(171));

    await checkStat({deposited: ETH(96), remote: ETH(171), liabilities: ETH(11)});

    // withdrawal request goes straight to Eth2, ratio is 2
    await app.withdraw(tokens(1), pad("0x100", 32), {from: user1});
    assertBn(await token.balanceOf(user1), tokens(31));
    assertBn(await token.balanceOf(user2), tokens(44));
    assertBn(await token.balanceOf(user3), tokens(4));
    assertBn(await app.getTotalControlledEther(), ETH(158));
    assertBn(await token.totalSupply(), tokens(79));

    await checkStat({deposited: ETH(96), remote: ETH(171), liabilities: ETH(13)});
    assertBn(await app.getBufferedEther(), 0);

    assertBn(await app.totalWithdrawalRequests(), 2);
    const r1 = await app.getWithdrawalRequest.call(1);
    assertBn(r1.amount, ETH(2));
    assertBn(r1.pubkeyHash, pad("0x100", 32));
  });
});
