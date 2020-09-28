const { join } = require('path')
const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { ONE_DAY, ZERO_ADDRESS, MAX_UINT64, bn, getEventArgument, injectWeb3, injectArtifacts } = require('@aragon/contract-helpers-test')
const { BN } = require('bn.js');

const StETH = artifacts.require('StETH.sol') //we can just import due to StETH imported in test_helpers/Imports.sol
const StakingProvidersRegistry = artifacts.require('StakingProvidersRegistry');

const DePool = artifacts.require('TestDePool.sol');
const OracleMock = artifacts.require('OracleMock.sol');
const ValidatorRegistrationMock = artifacts.require('ValidatorRegistrationMock.sol');


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

// Divides a BN by 1e15
const div15 = bn => bn.div(new BN(1000000)).div(new BN(1000000)).div(new BN(1000));

const ETH = (value) => web3.utils.toWei(value + '', 'ether');
const tokens = ETH;


contract('DePool', ([appManager, voting, user1, user2, user3, nobody]) => {
  let appBase, stEthBase, stakingProvidersRegistryBase, app, token, oracle, validatorRegistration, sps;
  let treasuryAddr, insuranceAddr;

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await DePool.new();
    stEthBase = await StETH.new();
    oracle = await OracleMock.new();
    validatorRegistration = await ValidatorRegistrationMock.new();
    stakingProvidersRegistryBase = await StakingProvidersRegistry.new();
  })

  beforeEach('deploy dao and app', async () => {
    const { dao, acl } = await newDao(appManager)

    // token
    let proxyAddress = await newApp(dao, 'steth', stEthBase.address, appManager);
    token = await StETH.at(proxyAddress);
    await token.initialize();

    // StakingProvidersRegistry
    proxyAddress = await newApp(dao, 'staking-providers-registry', stakingProvidersRegistryBase.address, appManager);
    sps = await StakingProvidersRegistry.at(proxyAddress);
    await sps.initialize();

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    proxyAddress = await newApp(dao, 'depool', appBase.address, appManager);
    app = await DePool.at(proxyAddress);

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.PAUSE_ROLE(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.MANAGE_FEE(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.MANAGE_WITHDRAWAL_KEY(), appManager, {from: appManager});

    await acl.createPermission(app.address, token.address, await token.MINT_ROLE(), appManager, {from: appManager});
    await acl.createPermission(app.address, token.address, await token.BURN_ROLE(), appManager, {from: appManager});

    await acl.createPermission(voting, sps.address, await sps.SET_POOL(), appManager, {from: appManager});
    await acl.createPermission(voting, sps.address, await sps.MANAGE_SIGNING_KEYS(), appManager, {from: appManager});
    await acl.createPermission(voting, sps.address, await sps.ADD_STAKING_PROVIDER_ROLE(), appManager, {from: appManager});
    await acl.createPermission(voting, sps.address, await sps.SET_STAKING_PROVIDER_ACTIVE_ROLE(), appManager, {from: appManager});
    await acl.createPermission(voting, sps.address, await sps.SET_STAKING_PROVIDER_NAME_ROLE(), appManager, {from: appManager});
    await acl.createPermission(voting, sps.address, await sps.SET_STAKING_PROVIDER_ADDRESS_ROLE(), appManager, {from: appManager});
    await acl.createPermission(voting, sps.address, await sps.SET_STAKING_PROVIDER_LIMIT_ROLE(), appManager, {from: appManager});
    await acl.createPermission(voting, sps.address, await sps.REPORT_STOPPED_VALIDATORS_ROLE(), appManager, {from: appManager});

    // Initialize the app's proxy.
    await app.initialize(token.address, validatorRegistration.address, oracle.address, sps.address);
    treasuryAddr = await app.getTreasury();
    insuranceAddr = await app.getInsuranceFund();

    await oracle.setPool(app.address);
    await validatorRegistration.reset();
    await sps.setPool(app.address, {from: voting});
  })

  const checkStat = async ({deposited, remote}) => {
    const stat = await app.getEther2Stat();
    assertBn(stat.deposited, deposited, 'deposited ether check');
    assertBn(stat.remote, remote, 'remote ether check');
  };

  // Assert reward distribution. The values must be divided by 1e15.
  const checkRewards = async ({treasury, insurance, sp}) => {
    assertBn(div15(await token.balanceOf(treasuryAddr)), treasury, 'treasury token balance check');
    assertBn(div15(await token.balanceOf(insuranceAddr)), insurance, 'insurance fund token balance check');
    assertBn(div15(await token.balanceOf(app.address)), sp, 'staking providers token balance check');
  };

  it('setFee works', async () => {
    await app.setFee(110, {from: voting});
    await assertRevert(app.setFee(110, {from: user1}), 'APP_AUTH_FAILED');
    await assertRevert(app.setFee(110, {from: nobody}), 'APP_AUTH_FAILED');
    await assertRevert(app.setFee(11000, {from: voting}), 'VALUE_OVER_100_PERCENT');

    assertBn(await app.getFee({from: nobody}), 110);
  });

  it('setFeeDistribution works', async () => {
    await app.setFeeDistribution(3000, 2000, 5000, {from: voting});
    await assertRevert(app.setFeeDistribution(3000, 2000, 5000, {from: user1}), 'APP_AUTH_FAILED');
    await assertRevert(app.setFeeDistribution(3000, 2000, 5000, {from: nobody}), 'APP_AUTH_FAILED');

    await assertRevert(app.setFeeDistribution(3000, 2000, 5001, {from: voting}), 'FEES_DONT_ADD_UP');
    await assertRevert(app.setFeeDistribution(3000, 2000-1, 5000, {from: voting}), 'FEES_DONT_ADD_UP');
    await assertRevert(app.setFeeDistribution(0, 0, 15000, {from: voting}), 'FEES_DONT_ADD_UP');

    const distribution = await app.getFeeDistribution({from: nobody});
    assertBn(distribution.treasuryFeeBasisPoints, 3000);
    assertBn(distribution.insuranceFeeBasisPoints, 2000);
    assertBn(distribution.SPFeeBasisPoints, 5000);
  });

  it('setWithdrawalCredentials works', async () => {
    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await assertRevert(app.setWithdrawalCredentials("0x0204", {from: voting}), 'INVALID_LENGTH');
    await assertRevert(app.setWithdrawalCredentials(pad("0x0203", 32), {from: user1}), 'APP_AUTH_FAILED');

    assert.equal(await app.getWithdrawalCredentials({from: nobody}), pad("0x0202", 32));
  });

  it('setWithdrawalCredentials resets unused keys', async () => {
    await sps.addStakingProvider("1", ADDRESS_1, UNLIMITED, {from: voting});
    await sps.addStakingProvider("2", ADDRESS_2, UNLIMITED, {from: voting});

    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});

    await sps.addSigningKeys(0, 1, pad("0x010203", 48), pad("0x01", 96), {from: voting});
    await sps.addSigningKeys(1, 2, hexConcat(pad("0x050505", 48), pad("0x060606", 48)),
                            hexConcat(pad("0x02", 96), pad("0x03", 96)), {from: voting});
    assertBn(await sps.getTotalSigningKeyCount(0, {from: nobody}), 1);
    assertBn(await sps.getUnusedSigningKeyCount(0, {from: nobody}), 1);
    assertBn(await sps.getTotalSigningKeyCount(1, {from: nobody}), 2);
    assertBn(await sps.getUnusedSigningKeyCount(1, {from: nobody}), 2);

    await app.setWithdrawalCredentials(pad("0x0203", 32), {from: voting});

    assertBn(await sps.getTotalSigningKeyCount(0, {from: nobody}), 0);
    assertBn(await sps.getUnusedSigningKeyCount(0, {from: nobody}), 0);
    assertBn(await sps.getTotalSigningKeyCount(1, {from: nobody}), 0);
    assertBn(await sps.getUnusedSigningKeyCount(1, {from: nobody}), 0);
    assert.equal(await app.getWithdrawalCredentials({from: nobody}), pad("0x0203", 32));
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
    await sps.addStakingProvider("1", ADDRESS_1, UNLIMITED, {from: voting});
    await sps.addStakingProvider("2", ADDRESS_2, UNLIMITED, {from: voting});

    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await sps.addSigningKeys(0, 1, pad("0x010203", 48), pad("0x01", 96), {from: voting});
    await sps.addSigningKeys(0, 3,
        hexConcat(pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48)),
        hexConcat(pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)),
        {from: voting});

    // +1 ETH
    await web3.eth.sendTransaction({to: app.address, from: user1, value: ETH(1)});
    await checkStat({deposited: 0, remote: 0});
    assertBn(await validatorRegistration.totalCalls(), 0);
    assertBn(await app.getTotalControlledEther(), ETH(1));
    assertBn(await app.getBufferedEther(), ETH(1));
    assertBn(await token.balanceOf(user1), tokens(1));

    // +2 ETH
    await app.submit(ZERO_ADDRESS, {from: user2, value: ETH(2)});     // another form of a deposit call
    await checkStat({deposited: 0, remote: 0});
    assertBn(await validatorRegistration.totalCalls(), 0);
    assertBn(await app.getTotalControlledEther(), ETH(3));
    assertBn(await app.getBufferedEther(), ETH(3));
    assertBn(await token.balanceOf(user2), tokens(2));

    // +30 ETH
    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(30)});
    await checkStat({deposited: ETH(32), remote: 0});
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
    await checkStat({deposited: ETH(128), remote: 0});
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

  it('submits with zero and non-zero referrals work', async () => {
    const REFERRAL = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF';
    let receipt;
    receipt = await app.submit(REFERRAL, {from: user2, value: ETH(2)});
    assertEvent(receipt, "Submitted" , { expectedArgs: { sender: user2, amount: ETH(2), referral: REFERRAL }})
    receipt = await app.submit(ZERO_ADDRESS, {from: user2, value: ETH(5)});
    assertEvent(receipt, "Submitted" , { expectedArgs: { sender: user2, amount: ETH(5), referral: ZERO_ADDRESS }})
  });

  it('key removal is taken into account during deposit', async () => {
    await sps.addStakingProvider("1", ADDRESS_1, UNLIMITED, {from: voting});
    await sps.addStakingProvider("2", ADDRESS_2, UNLIMITED, {from: voting});

    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await sps.addSigningKeys(0, 1, pad("0x010203", 48), pad("0x01", 96), {from: voting});
    await sps.addSigningKeys(0, 3,
        hexConcat(pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48)),
        hexConcat(pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)),
        {from: voting});

    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(33)});
    assertBn(await validatorRegistration.totalCalls(), 1);
    await assertRevert(sps.removeSigningKey(0, 0, {from: voting}), 'KEY_WAS_USED');

    await sps.removeSigningKey(0, 1, {from: voting});

    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(100)});
    await assertRevert(sps.removeSigningKey(0, 1, {from: voting}), 'KEY_WAS_USED');
    await assertRevert(sps.removeSigningKey(0, 2, {from: voting}), 'KEY_WAS_USED');
    assertBn(await validatorRegistration.totalCalls(), 3);
    assertBn(await app.getTotalControlledEther(), ETH(133));
    assertBn(await app.getBufferedEther(), ETH(37));
  });

  it('out of signing keys doesn\'t revert but buffers', async () => {
    await sps.addStakingProvider("1", ADDRESS_1, UNLIMITED, {from: voting});
    await sps.addStakingProvider("2", ADDRESS_2, UNLIMITED, {from: voting});

    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await sps.addSigningKeys(0, 1, pad("0x010203", 48), pad("0x01", 96), {from: voting});

    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(100)});
    await checkStat({deposited: ETH(32), remote: 0});
    assertBn(await validatorRegistration.totalCalls(), 1);
    assertBn(await app.getTotalControlledEther(), ETH(100));
    assertBn(await app.getBufferedEther(), ETH(100-32));

    // buffer unwinds
    await sps.addSigningKeys(0, 3,
        hexConcat(pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48)),
        hexConcat(pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)),
        {from: voting});
    await web3.eth.sendTransaction({to: app.address, from: user1, value: ETH(1)});
    await checkStat({deposited: ETH(96), remote: 0});
    assertBn(await validatorRegistration.totalCalls(), 3);
    assertBn(await app.getTotalControlledEther(), ETH(101));
    assertBn(await app.getBufferedEther(), ETH(5));
  });

  it('withrawal method reverts', async () => {
    await sps.addStakingProvider("1", ADDRESS_1, UNLIMITED, {from: voting});
    await sps.addStakingProvider("2", ADDRESS_2, UNLIMITED, {from: voting});

    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await sps.addSigningKeys(0, 6,
        hexConcat(pad("0x010203", 48), pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48), pad("0x010207", 48), pad("0x010208", 48)),
        hexConcat(pad("0x01", 96), pad("0x01", 96), pad("0x01", 96), pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)),
        {from: voting});

    await web3.eth.sendTransaction({to: app.address, from: user1, value: ETH(1)});
    assertBn(await app.getTotalControlledEther(), ETH(1));
    assertBn(await token.totalSupply(), tokens(1));
    assertBn(await app.getBufferedEther(), ETH(1));

    await checkStat({deposited: 0, remote: 0});

    await assertRevert(app.withdraw(tokens(1), pad("0x1000", 32), {from: nobody}), "NOT_IMPLEMENTED_YET");
    await assertRevert(app.withdraw(tokens(1), pad("0x1000", 32), {from: user1}), "NOT_IMPLEMENTED_YET");
  });

  it('reportEther2 works', async () => {
    await sps.addStakingProvider("1", ADDRESS_1, UNLIMITED, {from: voting});
    await sps.addStakingProvider("2", ADDRESS_2, UNLIMITED, {from: voting});

    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await sps.addSigningKeys(0, 1, pad("0x010203", 48), pad("0x01", 96), {from: voting});
    await sps.addSigningKeys(0, 3,
        hexConcat(pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48)),
        hexConcat(pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)),
        {from: voting});

    await web3.eth.sendTransaction({to: app.address, from: user2, value: ETH(34)});
    await checkStat({deposited: ETH(32), remote: 0});

    await assertRevert(app.reportEther2(100, ETH(30), {from: appManager}), 'APP_AUTH_FAILED');

    await oracle.reportEther2(100, ETH(30));
    await checkStat({deposited: ETH(32), remote: ETH(30)});

    await assertRevert(app.reportEther2(100, ETH(29), {from: nobody}), 'APP_AUTH_FAILED');
    await assertRevert(oracle.reportEther2(0, ETH(29)), 'ZERO_EPOCH');

    await oracle.reportEther2(50, ETH(100));    // stale data
    await checkStat({deposited: ETH(32), remote: ETH(30)});

    await oracle.reportEther2(200, ETH(33));
    await checkStat({deposited: ETH(32), remote: ETH(33)});
  });

  it('oracle data affects deposits', async () => {
    await sps.addStakingProvider("1", ADDRESS_1, UNLIMITED, {from: voting});
    await sps.addStakingProvider("2", ADDRESS_2, UNLIMITED, {from: voting});

    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await sps.addSigningKeys(0, 1, pad("0x010203", 48), pad("0x01", 96), {from: voting});
    await sps.addSigningKeys(0, 3,
        hexConcat(pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48)),
        hexConcat(pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)),
        {from: voting});

    await web3.eth.sendTransaction({to: app.address, from: user2, value: ETH(34)});
    await checkStat({deposited: ETH(32), remote: 0});
    assertBn(await validatorRegistration.totalCalls(), 1);
    assertBn(await app.getTotalControlledEther(), ETH(34));
    assertBn(await app.getBufferedEther(), ETH(2));

    // down
    await oracle.reportEther2(100, ETH(15));

    await checkStat({deposited: ETH(32), remote: ETH(15)});
    assertBn(await validatorRegistration.totalCalls(), 1);
    assertBn(await app.getTotalControlledEther(), ETH(17));
    assertBn(await app.getBufferedEther(), ETH(2));
    assertBn(await token.totalSupply(), tokens(34));

    // deposit, ratio is 0.5
    await web3.eth.sendTransaction({to: app.address, from: user1, value: ETH(2)});

    await checkStat({deposited: ETH(32), remote: ETH(15)});
    assertBn(await validatorRegistration.totalCalls(), 1);
    assertBn(await app.getTotalControlledEther(), ETH(19));
    assertBn(await app.getBufferedEther(), ETH(4));
    assertBn(await token.balanceOf(user1), tokens(4));
    assertBn(await token.totalSupply(), tokens(38));

    // up
    await oracle.reportEther2(200, ETH(72));

    await checkStat({deposited: ETH(32), remote: ETH(72)});
    assertBn(await validatorRegistration.totalCalls(), 1);
    assertBn(await app.getTotalControlledEther(), ETH(76));
    assertBn(await app.getBufferedEther(), ETH(4));
    assertBn(await token.totalSupply(), tokens(38));

    // 2nd deposit, ratio is 2
    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(2)});

    await checkStat({deposited: ETH(32), remote: ETH(72)});
    assertBn(await validatorRegistration.totalCalls(), 1);
    assertBn(await app.getTotalControlledEther(), ETH(78));
    assertBn(await app.getBufferedEther(), ETH(6));
    assertBn(await token.balanceOf(user1), tokens(4));
    assertBn(await token.balanceOf(user3), tokens(1));
    assertBn(await token.totalSupply(), tokens(39));
  });

  it('can stop and resume', async () => {
    await sps.addStakingProvider("1", ADDRESS_1, UNLIMITED, {from: voting});
    await sps.addStakingProvider("2", ADDRESS_2, UNLIMITED, {from: voting});

    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await sps.addSigningKeys(0, 1, pad("0x010203", 48), pad("0x01", 96), {from: voting});
    await sps.addSigningKeys(0, 3,
        hexConcat(pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48)),
        hexConcat(pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)),
        {from: voting});

    await web3.eth.sendTransaction({to: app.address, from: user2, value: ETH(40)});
    await checkStat({deposited: ETH(32), remote: 0});
    assertBn(await app.getBufferedEther(), ETH(8));

    await assertRevert(app.stop({from: user2}), 'APP_AUTH_FAILED');
    await app.stop({from: voting});

    await assertRevert(web3.eth.sendTransaction({to: app.address, from: user1, value: ETH(4)}), 'CONTRACT_IS_STOPPED');
    await assertRevert(web3.eth.sendTransaction({to: app.address, from: user1, value: ETH(4)}), 'CONTRACT_IS_STOPPED');
    await assertRevert(app.submit("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", {from: user1, value: ETH(4)}), 'CONTRACT_IS_STOPPED');

    await assertRevert(app.resume({from: user2}), 'APP_AUTH_FAILED');
    await app.resume({from: voting});

    await web3.eth.sendTransaction({to: app.address, from: user1, value: ETH(4)});
    await checkStat({deposited: ETH(32), remote: 0});
    assertBn(await app.getBufferedEther(), ETH(12));
  });

  it('rewards distribution works in a simple case', async () => {
    await sps.addStakingProvider("1", ADDRESS_1, UNLIMITED, {from: voting});
    await sps.addStakingProvider("2", ADDRESS_2, UNLIMITED, {from: voting});

    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await sps.addSigningKeys(0, 1, pad("0x010203", 48), pad("0x01", 96), {from: voting});
    await sps.addSigningKeys(0, 3,
        hexConcat(pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48)),
        hexConcat(pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)),
        {from: voting});

    await app.setFee(5000, {from: voting});
    await app.setFeeDistribution(3000, 2000, 5000, {from: voting});

    await web3.eth.sendTransaction({to: app.address, from: user2, value: ETH(34)});

    await oracle.reportEther2(300, ETH(36));
    await checkStat({deposited: ETH(32), remote: ETH(36)});
    assertBn(div15(await token.totalSupply()), 35888);
    await checkRewards({treasury: 566, insurance: 377, sp: 944});
  });

  it('rewards distribution works', async () => {
    await sps.addStakingProvider("1", ADDRESS_1, UNLIMITED, {from: voting});
    await sps.addStakingProvider("2", ADDRESS_2, UNLIMITED, {from: voting});

    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await sps.addSigningKeys(0, 1, pad("0x010203", 48), pad("0x01", 96), {from: voting});
    await sps.addSigningKeys(0, 3,
        hexConcat(pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48)),
        hexConcat(pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)),
        {from: voting});

    await app.setFee(5000, {from: voting});
    await app.setFeeDistribution(3000, 2000, 5000, {from: voting});

    await web3.eth.sendTransaction({to: app.address, from: user2, value: ETH(34)});
    // some slashing occured
    await oracle.reportEther2(100, ETH(30));

    await checkStat({deposited: ETH(32), remote: ETH(30)});
    assertBn(await token.totalSupply(), tokens(34));
    await checkRewards({treasury: 0, insurance: 0, sp: 0});

    // back to normal
    await oracle.reportEther2(200, ETH(32));
    await checkStat({deposited: ETH(32), remote: ETH(32)});
    await checkRewards({treasury: 0, insurance: 0, sp: 0});

    // now some rewards are here
    await oracle.reportEther2(300, ETH(36));
    await checkStat({deposited: ETH(32), remote: ETH(36)});
    assertBn(div15(await token.totalSupply()), 35888);
    await checkRewards({treasury: 566, insurance: 377, sp: 944});
  });

  it('deposits accounted properly during rewards distribution', async () => {
    await sps.addStakingProvider("1", ADDRESS_1, UNLIMITED, {from: voting});
    await sps.addStakingProvider("2", ADDRESS_2, UNLIMITED, {from: voting});

    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
    await sps.addSigningKeys(0, 1, pad("0x010203", 48), pad("0x01", 96), {from: voting});

    await app.setFee(5000, {from: voting});
    await app.setFeeDistribution(3000, 2000, 5000, {from: voting});

    // Only 32 ETH deposited
    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(32)});
    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(32)});
    assertBn(await token.totalSupply(), tokens(64));

    await oracle.reportEther2(300, ETH(36));
    await checkStat({deposited: ETH(32), remote: ETH(36)});
    assertBn(div15(await token.totalSupply()), 65939);
    await checkRewards({treasury: 581, insurance: 387, sp: 969});
  });

  it('SP filtering during deposit works when doing a huge deposit', async () => {
    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});

    await sps.addStakingProvider("good", ADDRESS_1, UNLIMITED, {from: voting});     // 0
    await sps.addSigningKeys(0, 2, hexConcat(pad("0x0001", 48), pad("0x0002", 48)), hexConcat(pad("0x01", 96), pad("0x01", 96)), {from: voting});

    await sps.addStakingProvider("limited", ADDRESS_2, 1, {from: voting});          // 1
    await sps.addSigningKeys(1, 2, hexConcat(pad("0x0101", 48), pad("0x0102", 48)), hexConcat(pad("0x01", 96), pad("0x01", 96)), {from: voting});

    await sps.addStakingProvider("deactivated", ADDRESS_3, UNLIMITED, {from: voting});  // 2
    await sps.addSigningKeys(2, 2, hexConcat(pad("0x0201", 48), pad("0x0202", 48)), hexConcat(pad("0x01", 96), pad("0x01", 96)), {from: voting});
    await sps.setStakingProviderActive(2, false, {from: voting});

    await sps.addStakingProvider("short on keys", ADDRESS_4, UNLIMITED, {from: voting});    // 3

    await app.setFee(5000, {from: voting});
    await app.setFeeDistribution(3000, 2000, 5000, {from: voting});

    // Deposit huge chunk
    await web3.eth.sendTransaction({to: app.address, from: user1, value: ETH(32*3 + 50)});
    await checkStat({deposited: ETH(96), remote: 0});
    assertBn(await app.getTotalControlledEther(), ETH(146));
    assertBn(await app.getBufferedEther(), ETH(50));
    assertBn(await validatorRegistration.totalCalls(), 3);

    assertBn(await sps.getTotalSigningKeyCount(0, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(1, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(2, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(3, {from: nobody}), 0);

    assertBn(await sps.getUnusedSigningKeyCount(0, {from: nobody}), 0);
    assertBn(await sps.getUnusedSigningKeyCount(1, {from: nobody}), 1);
    assertBn(await sps.getUnusedSigningKeyCount(2, {from: nobody}), 2);
    assertBn(await sps.getUnusedSigningKeyCount(3, {from: nobody}), 0);

    // Next deposit changes nothing
    await web3.eth.sendTransaction({to: app.address, from: user2, value: ETH(32)});
    await checkStat({deposited: ETH(96), remote: 0});
    assertBn(await app.getTotalControlledEther(), ETH(178));
    assertBn(await app.getBufferedEther(), ETH(82));
    assertBn(await validatorRegistration.totalCalls(), 3);

    assertBn(await sps.getTotalSigningKeyCount(0, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(1, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(2, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(3, {from: nobody}), 0);

    assertBn(await sps.getUnusedSigningKeyCount(0, {from: nobody}), 0);
    assertBn(await sps.getUnusedSigningKeyCount(1, {from: nobody}), 1);
    assertBn(await sps.getUnusedSigningKeyCount(2, {from: nobody}), 2);
    assertBn(await sps.getUnusedSigningKeyCount(3, {from: nobody}), 0);

    // #1 goes below the limit
    await sps.reportStoppedValidators(1, 1, {from: voting});
    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(1)});
    await checkStat({deposited: ETH(128), remote: 0});
    assertBn(await app.getTotalControlledEther(), ETH(179));
    assertBn(await app.getBufferedEther(), ETH(51));
    assertBn(await validatorRegistration.totalCalls(), 4);

    assertBn(await sps.getTotalSigningKeyCount(0, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(1, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(2, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(3, {from: nobody}), 0);

    assertBn(await sps.getUnusedSigningKeyCount(0, {from: nobody}), 0);
    assertBn(await sps.getUnusedSigningKeyCount(1, {from: nobody}), 0);
    assertBn(await sps.getUnusedSigningKeyCount(2, {from: nobody}), 2);
    assertBn(await sps.getUnusedSigningKeyCount(3, {from: nobody}), 0);

    // Adding a key will help
    await sps.addSigningKeys(0, 1, pad("0x0003", 48), pad("0x01", 96), {from: voting});
    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(1)});
    await checkStat({deposited: ETH(160), remote: 0});
    assertBn(await app.getTotalControlledEther(), ETH(180));
    assertBn(await app.getBufferedEther(), ETH(20));
    assertBn(await validatorRegistration.totalCalls(), 5);

    assertBn(await sps.getTotalSigningKeyCount(0, {from: nobody}), 3);
    assertBn(await sps.getTotalSigningKeyCount(1, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(2, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(3, {from: nobody}), 0);

    assertBn(await sps.getUnusedSigningKeyCount(0, {from: nobody}), 0);
    assertBn(await sps.getUnusedSigningKeyCount(1, {from: nobody}), 0);
    assertBn(await sps.getUnusedSigningKeyCount(2, {from: nobody}), 2);
    assertBn(await sps.getUnusedSigningKeyCount(3, {from: nobody}), 0);

    // Reactivation of #2
    await sps.setStakingProviderActive(2, true, {from: voting});
    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(12)});
    await checkStat({deposited: ETH(192), remote: 0});
    assertBn(await app.getTotalControlledEther(), ETH(192));
    assertBn(await app.getBufferedEther(), ETH(0));
    assertBn(await validatorRegistration.totalCalls(), 6);

    assertBn(await sps.getTotalSigningKeyCount(0, {from: nobody}), 3);
    assertBn(await sps.getTotalSigningKeyCount(1, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(2, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(3, {from: nobody}), 0);

    assertBn(await sps.getUnusedSigningKeyCount(0, {from: nobody}), 0);
    assertBn(await sps.getUnusedSigningKeyCount(1, {from: nobody}), 0);
    assertBn(await sps.getUnusedSigningKeyCount(2, {from: nobody}), 1);
    assertBn(await sps.getUnusedSigningKeyCount(3, {from: nobody}), 0);
  });

  it('SP filtering during deposit works when doing small deposits', async () => {
    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});

    await sps.addStakingProvider("good", ADDRESS_1, UNLIMITED, {from: voting});     // 0
    await sps.addSigningKeys(0, 2, hexConcat(pad("0x0001", 48), pad("0x0002", 48)), hexConcat(pad("0x01", 96), pad("0x01", 96)), {from: voting});

    await sps.addStakingProvider("limited", ADDRESS_2, 1, {from: voting});          // 1
    await sps.addSigningKeys(1, 2, hexConcat(pad("0x0101", 48), pad("0x0102", 48)), hexConcat(pad("0x01", 96), pad("0x01", 96)), {from: voting});

    await sps.addStakingProvider("deactivated", ADDRESS_3, UNLIMITED, {from: voting});  // 2
    await sps.addSigningKeys(2, 2, hexConcat(pad("0x0201", 48), pad("0x0202", 48)), hexConcat(pad("0x01", 96), pad("0x01", 96)), {from: voting});
    await sps.setStakingProviderActive(2, false, {from: voting});

    await sps.addStakingProvider("short on keys", ADDRESS_4, UNLIMITED, {from: voting});    // 3

    await app.setFee(5000, {from: voting});
    await app.setFeeDistribution(3000, 2000, 5000, {from: voting});

    // Small deposits
    for (let i = 0; i < 14; i++)
        await web3.eth.sendTransaction({to: app.address, from: user1, value: ETH(10)});
    await web3.eth.sendTransaction({to: app.address, from: user1, value: ETH(6)});

    await checkStat({deposited: ETH(96), remote: 0});
    assertBn(await app.getTotalControlledEther(), ETH(146));
    assertBn(await app.getBufferedEther(), ETH(50));
    assertBn(await validatorRegistration.totalCalls(), 3);

    assertBn(await sps.getTotalSigningKeyCount(0, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(1, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(2, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(3, {from: nobody}), 0);

    assertBn(await sps.getUnusedSigningKeyCount(0, {from: nobody}), 0);
    assertBn(await sps.getUnusedSigningKeyCount(1, {from: nobody}), 1);
    assertBn(await sps.getUnusedSigningKeyCount(2, {from: nobody}), 2);
    assertBn(await sps.getUnusedSigningKeyCount(3, {from: nobody}), 0);

    // Next deposit changes nothing
    await web3.eth.sendTransaction({to: app.address, from: user2, value: ETH(32)});
    await checkStat({deposited: ETH(96), remote: 0});
    assertBn(await app.getTotalControlledEther(), ETH(178));
    assertBn(await app.getBufferedEther(), ETH(82));
    assertBn(await validatorRegistration.totalCalls(), 3);

    assertBn(await sps.getTotalSigningKeyCount(0, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(1, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(2, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(3, {from: nobody}), 0);

    assertBn(await sps.getUnusedSigningKeyCount(0, {from: nobody}), 0);
    assertBn(await sps.getUnusedSigningKeyCount(1, {from: nobody}), 1);
    assertBn(await sps.getUnusedSigningKeyCount(2, {from: nobody}), 2);
    assertBn(await sps.getUnusedSigningKeyCount(3, {from: nobody}), 0);

    // #1 goes below the limit
    await sps.reportStoppedValidators(1, 1, {from: voting});
    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(1)});
    await checkStat({deposited: ETH(128), remote: 0});
    assertBn(await app.getTotalControlledEther(), ETH(179));
    assertBn(await app.getBufferedEther(), ETH(51));
    assertBn(await validatorRegistration.totalCalls(), 4);

    assertBn(await sps.getTotalSigningKeyCount(0, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(1, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(2, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(3, {from: nobody}), 0);

    assertBn(await sps.getUnusedSigningKeyCount(0, {from: nobody}), 0);
    assertBn(await sps.getUnusedSigningKeyCount(1, {from: nobody}), 0);
    assertBn(await sps.getUnusedSigningKeyCount(2, {from: nobody}), 2);
    assertBn(await sps.getUnusedSigningKeyCount(3, {from: nobody}), 0);

    // Adding a key will help
    await sps.addSigningKeys(0, 1, pad("0x0003", 48), pad("0x01", 96), {from: voting});
    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(1)});
    await checkStat({deposited: ETH(160), remote: 0});
    assertBn(await app.getTotalControlledEther(), ETH(180));
    assertBn(await app.getBufferedEther(), ETH(20));
    assertBn(await validatorRegistration.totalCalls(), 5);

    assertBn(await sps.getTotalSigningKeyCount(0, {from: nobody}), 3);
    assertBn(await sps.getTotalSigningKeyCount(1, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(2, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(3, {from: nobody}), 0);

    assertBn(await sps.getUnusedSigningKeyCount(0, {from: nobody}), 0);
    assertBn(await sps.getUnusedSigningKeyCount(1, {from: nobody}), 0);
    assertBn(await sps.getUnusedSigningKeyCount(2, {from: nobody}), 2);
    assertBn(await sps.getUnusedSigningKeyCount(3, {from: nobody}), 0);

    // Reactivation of #2
    await sps.setStakingProviderActive(2, true, {from: voting});
    await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(12)});
    await checkStat({deposited: ETH(192), remote: 0});
    assertBn(await app.getTotalControlledEther(), ETH(192));
    assertBn(await app.getBufferedEther(), ETH(0));
    assertBn(await validatorRegistration.totalCalls(), 6);

    assertBn(await sps.getTotalSigningKeyCount(0, {from: nobody}), 3);
    assertBn(await sps.getTotalSigningKeyCount(1, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(2, {from: nobody}), 2);
    assertBn(await sps.getTotalSigningKeyCount(3, {from: nobody}), 0);

    assertBn(await sps.getUnusedSigningKeyCount(0, {from: nobody}), 0);
    assertBn(await sps.getUnusedSigningKeyCount(1, {from: nobody}), 0);
    assertBn(await sps.getUnusedSigningKeyCount(2, {from: nobody}), 1);
    assertBn(await sps.getUnusedSigningKeyCount(3, {from: nobody}), 0);
  });

  it('Deposit finds the right SP', async () => {
    await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});

    await sps.addStakingProvider("good", ADDRESS_1, UNLIMITED, {from: voting});     // 0
    await sps.addSigningKeys(0, 2, hexConcat(pad("0x0001", 48), pad("0x0002", 48)), hexConcat(pad("0x01", 96), pad("0x01", 96)), {from: voting});

    await sps.addStakingProvider("2nd good", ADDRESS_2, UNLIMITED, {from: voting}); // 1
    await sps.addSigningKeys(1, 2, hexConcat(pad("0x0101", 48), pad("0x0102", 48)), hexConcat(pad("0x01", 96), pad("0x01", 96)), {from: voting});

    await sps.addStakingProvider("deactivated", ADDRESS_3, UNLIMITED, {from: voting});  // 2
    await sps.addSigningKeys(2, 2, hexConcat(pad("0x0201", 48), pad("0x0202", 48)), hexConcat(pad("0x01", 96), pad("0x01", 96)), {from: voting});
    await sps.setStakingProviderActive(2, false, {from: voting});

    await sps.addStakingProvider("short on keys", ADDRESS_4, UNLIMITED, {from: voting});    // 3

    await app.setFee(5000, {from: voting});
    await app.setFeeDistribution(3000, 2000, 5000, {from: voting});

    // #1 and #0 get the funds
    await web3.eth.sendTransaction({to: app.address, from: user2, value: ETH(64)});
    await checkStat({deposited: ETH(64), remote: 0});
    assertBn(await app.getTotalControlledEther(), ETH(64));
    assertBn(await app.getBufferedEther(), ETH(0));
    assertBn(await validatorRegistration.totalCalls(), 2);

    assertBn(await sps.getUnusedSigningKeyCount(0, {from: nobody}), 1);
    assertBn(await sps.getUnusedSigningKeyCount(1, {from: nobody}), 1);
    assertBn(await sps.getUnusedSigningKeyCount(2, {from: nobody}), 2);
    assertBn(await sps.getUnusedSigningKeyCount(3, {from: nobody}), 0);

    // Reactivation of #2 - has the smallest stake
    await sps.setStakingProviderActive(2, true, {from: voting});
    await web3.eth.sendTransaction({to: app.address, from: user2, value: ETH(36)});
    await checkStat({deposited: ETH(96), remote: 0});
    assertBn(await app.getTotalControlledEther(), ETH(100));
    assertBn(await app.getBufferedEther(), ETH(4));
    assertBn(await validatorRegistration.totalCalls(), 3);

    assertBn(await sps.getUnusedSigningKeyCount(0, {from: nobody}), 1);
    assertBn(await sps.getUnusedSigningKeyCount(1, {from: nobody}), 1);
    assertBn(await sps.getUnusedSigningKeyCount(2, {from: nobody}), 1);
    assertBn(await sps.getUnusedSigningKeyCount(3, {from: nobody}), 0);
  });
});
