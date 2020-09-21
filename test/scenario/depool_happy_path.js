const {assert} = require('chai');
const {BN} = require('bn.js');
const {assertBn} = require('@aragon/contract-helpers-test/src/asserts');

const {newDao, newApp} = require('../helpers/dao');
const {pad, hexConcat, toBN, ETH, tokens} = require('../helpers/utils');

const StETH = artifacts.require('StETH.sol');

const DePool = artifacts.require('TestDePool.sol');
const OracleMock = artifacts.require('OracleMock.sol');
const ValidatorRegistrationMock = artifacts.require('ValidatorRegistrationMock.sol');


contract('DePool: happy path', ([appManager, voting, user1, user2, user3, nobody]) => {
  let oracle, validatorRegistration, pool, token;
  let treasuryAddr, insuranceAddr;

  it('the DAO, the StETH token and the pool are deployed and initialized', async () => {
    const deployed = await deployDaoAndPool(appManager, voting);

    oracle = deployed.oracle;
    validatorRegistration = deployed.validatorRegistration;
    token = deployed.token;
    pool = deployed.pool;
    treasuryAddr = deployed.treasuryAddr;
    insuranceAddr = deployed.insuranceAddr;
  });

  // Fee and its distribution are in basis points, 10000 corresponding to 100%

  // Total fee is 1%
  const totalFeePoints = 0.01 * 10000

  // Of this 1%, 30% goes to the treasury
  const treasuryFeePoints = 0.3 * 10000
  // 20% goes to the insurance fund
  const insuranceFeePoints = 0.2 * 10000
  // 50% goes to staking providers
  const stakingProvidersFeePoints = 0.5 * 10000

  it('voting sets fee and its distribution', async () => {
    await pool.setFee(totalFeePoints, {from: voting});

    await pool.setFeeDistribution(
      treasuryFeePoints,
      insuranceFeePoints,
      stakingProvidersFeePoints,
      {from: voting},
    );

    // Checking correctness

    assertBn(await pool.getFee({from: nobody}), totalFeePoints, 'total fee');

    const distribution = await pool.getFeeDistribution({from: nobody});
    assertBn(distribution.treasuryFeeBasisPoints, treasuryFeePoints, 'treasury fee');
    assertBn(distribution.insuranceFeeBasisPoints, insuranceFeePoints, 'insurance fee');
    assertBn(distribution.SPFeeBasisPoints, stakingProvidersFeePoints, 'staking providers fee');
  });

  const withdrawalCredentials = pad('0x0202', 32);

  it('voting sets withdrawal credentials', async () => {
    await pool.setWithdrawalCredentials(withdrawalCredentials, {from: voting});

    // Checking correctness

    assert.equal(
      await pool.getWithdrawalCredentials({from: nobody}),
      withdrawalCredentials,
      'withdrawal credentials',
    );
  });

  const validator1 = {
    key: pad('0x010101', 48),
    sig: pad('0x01', 96),
  };

  const validator2 = {
    key: pad('0x020202', 48),
    sig: pad('0x02', 96),
  };

  it('voting adds two validator signing keys', async () => {
    await pool.addSigningKeys(
      2,
      hexConcat(validator1.key, validator2.key),
      hexConcat(validator1.sig, validator2.sig),
      {from: voting},
    );

    // Checking correctness

    assertBn(await pool.getTotalSigningKeyCount({from: nobody}), 2, 'total signing keys');
    assertBn(await pool.getUnusedSigningKeyCount({from: nobody}), 2, 'unused signing keys');

    const keyInfo1 = await pool.getSigningKey(0, {from: nobody});
    assert.equal(keyInfo1.key, validator1.key, 'validator1 key');
    assert.equal(keyInfo1.used, false, 'validator1 key used');

    const keyInfo2 = await pool.getSigningKey(1, {from: nobody});
    assert.equal(keyInfo2.key, validator2.key, 'validator2 key');
    assert.equal(keyInfo2.used, false, 'validator2 key used');
  });

  it('the first user deposits 3 ETH to the pool', async () => {
    await web3.eth.sendTransaction({to: pool.address, from: user1, value: ETH(3)});

    // No Ether was deposited yet to the validator contract

    assertBn(await validatorRegistration.totalCalls(), 0);

    const ether2Stat = await pool.getEther2Stat();
    assertBn(ether2Stat.deposited, 0, 'deposited ether2');
    assertBn(ether2Stat.remote, 0, 'remote ether2');
    assertBn(ether2Stat.liabilities, 0, 'ether2 liabilities');

    // All Ether is buffered within the pool contract atm

    assertBn(await pool.getBufferedEther(), ETH(3), 'buffered ether');
    assertBn(await pool.getTotalControlledEther(), ETH(3), 'total controlled ether');

    // The amount of tokens corresponding to the deposited ETH value was minted to the user

    assertBn(await token.balanceOf(user1), tokens(3), 'user1 tokens');

    assertBn(await token.totalSupply(), tokens(3), 'token total supply');
  });

  it('the second user deposits 30 ETH to the pool', async () => {
    await web3.eth.sendTransaction({to: pool.address, from: user2, value: ETH(30)});

    // The first 32 ETH chunk was deposited to the validator registration contract,
    // using the first validator's public key and signature

    assertBn(await validatorRegistration.totalCalls(), 1);

    const regCall = await validatorRegistration.calls.call(0);
    assert.equal(regCall.pubkey, validator1.key);
    assert.equal(regCall.withdrawal_credentials, withdrawalCredentials);
    assert.equal(regCall.signature, validator1.sig);
    assertBn(regCall.value, ETH(32));

    const ether2Stat = await pool.getEther2Stat();
    assertBn(ether2Stat.deposited, ETH(32), 'deposited ether2');
    assertBn(ether2Stat.remote, 0, 'remote ether2');
    assertBn(ether2Stat.liabilities, 0, 'ether2 liabilities');

    // Some Ether remained buffered within the pool contract

    assertBn(await pool.getBufferedEther(), ETH(1), 'buffered ether');
    assertBn(await pool.getTotalControlledEther(), ETH(1 + 32), 'total controlled ether');

    // The amount of tokens corresponding to the deposited ETH value was minted to the users

    assertBn(await token.balanceOf(user1), tokens(3), 'user1 tokens');
    assertBn(await token.balanceOf(user2), tokens(30), 'user2 tokens');

    assertBn(await token.totalSupply(), tokens(3 + 30), 'token total supply');
  });

  it('the third user deposits 64 ETH to the pool', async () => {
    await web3.eth.sendTransaction({to: pool.address, from: user3, value: ETH(64)});

    // The second chunk was deposited to the validator registration contract,
    // using the second validator's public key and signature

    assertBn(await validatorRegistration.totalCalls(), 2);

    const regCall = await validatorRegistration.calls.call(1);
    assert.equal(regCall.pubkey, validator2.key);
    assert.equal(regCall.withdrawal_credentials, withdrawalCredentials);
    assert.equal(regCall.signature, validator2.sig);
    assertBn(regCall.value, ETH(32));

    const ether2Stat = await pool.getEther2Stat();
    assertBn(ether2Stat.deposited, ETH(64), 'deposited ether2');
    assertBn(ether2Stat.remote, 0, 'remote ether2');
    assertBn(ether2Stat.liabilities, 0, 'ether2 liabilities');

    // The pool has ran out of validator keys, so the remaining 32 ETH were added to the
    // pool buffer

    assertBn(await pool.getBufferedEther(), ETH(1 + 32), 'buffered ether');
    assertBn(await pool.getTotalControlledEther(), ETH(33 + 64), 'total controlled ether');

    // The amount of tokens corresponding to the deposited ETH value was minted to the users

    assertBn(await token.balanceOf(user1), tokens(3), 'user1 tokens');
    assertBn(await token.balanceOf(user2), tokens(30), 'user2 tokens');
    assertBn(await token.balanceOf(user3), tokens(64), 'user3 tokens');

    assertBn(await token.totalSupply(), tokens(3 + 30 + 64), 'token total supply');
  });

  it('the oracle reports balance increase on Ethereum2 side', async () => {
    const epoch = 100;

    // Reporting 1.5-fold balance increase (64 => 96)

    await oracle.reportEther2(epoch, ETH(96));

    // Ether2 stat reported by the pool changes correspondingly

    const ether2Stat = await pool.getEther2Stat();
    assertBn(ether2Stat.deposited, ETH(64), 'deposited ether2');
    assertBn(ether2Stat.remote, ETH(96), 'remote ether2');
    assertBn(ether2Stat.liabilities, 0, 'ether2 liabilities');

    // Buffered Ether amount doesn't change

    assertBn(await pool.getBufferedEther(), ETH(33), 'buffered ether');

    // Total controlled Ether increases

    assertBn(await pool.getTotalControlledEther(), ETH(33 + 96), 'total controlled ether');

    // New tokens get minted to distribute fee, diluting token total supply:
    //
    // => mintedAmount * newPrice = totalFee
    // => newPrice = newTotalControlledEther / newTotalSupply =
    //             = newTotalControlledEther / (prevTotalSupply + mintedAmount)
    // => mintedAmount * newTotalControlledEther / (prevTotalSupply + mintedAmount) = totalFee
    // => mintedAmount = (totalFee * prevTotalSupply) / (newTotalControlledEther - totalFee)

    const reward = toBN(ETH(96 - 64));
    const prevTotalSupply = toBN(tokens(3 + 30 + 64));
    const newTotalControlledEther = toBN(ETH(33 + 96));

    const totalFee = new BN(totalFeePoints).mul(reward).divn(10000);
    const mintedAmount = totalFee.mul(prevTotalSupply).div(newTotalControlledEther.sub(totalFee));
    const newTotalSupply = prevTotalSupply.add(mintedAmount);

    assertBn(await token.totalSupply(), newTotalSupply.toString(10), 'token total supply');

    // Token user balances don't change

    assertBn(await token.balanceOf(user1), tokens(3), 'user1 tokens');
    assertBn(await token.balanceOf(user2), tokens(30), 'user2 tokens');
    assertBn(await token.balanceOf(user3), tokens(64), 'user3 tokens');

    // Fee, in the form of minted tokens, gets distributed between treasury, insurance fund
    // and staking providers (currently on the pool balance)

    const treasuryTokenBalance = mintedAmount.muln(treasuryFeePoints).divn(10000);
    const insuranceTokenBalance = mintedAmount.muln(insuranceFeePoints).divn(10000);

    const stakingProvidersTokenBalance = mintedAmount
      .sub(treasuryTokenBalance)
      .sub(insuranceTokenBalance);

    assertBn(await token.balanceOf(treasuryAddr), treasuryTokenBalance.toString(10),
      'treasury tokens');

    assertBn(await token.balanceOf(insuranceAddr), insuranceTokenBalance.toString(10),
      'insurance tokens');

    assertBn(await token.balanceOf(pool.address), stakingProvidersTokenBalance.toString(10),
      'staking providers\' tokens');
  });
});


async function deployDaoAndPool(appManager, voting) {
  // Deploy the DAO, oracle and validator registration mocks, and base
  // contracts for StETH (the token) and DePool (the pool)

  const [{dao, acl}, oracle, validatorRegistration, stEthBase, appBase] = await Promise.all([
    newDao(appManager),
    OracleMock.new(),
    ValidatorRegistrationMock.new(),
    StETH.new(),
    DePool.new(),
  ]);

  // Instantiate proxies for the pool and the token, using the base contracts
  // as their logic implementation

  const [tokenProxyAddress, appProxyAddress] = await Promise.all([
    newApp(dao, 'steth', stEthBase.address, appManager),
    newApp(dao, 'depool', appBase.address, appManager),
  ]);

  const [token, pool] = await Promise.all([
    StETH.at(tokenProxyAddress),
    DePool.at(appProxyAddress),
  ]);

  // Initialize the token and the pool

  await token.initialize();

  const [
    APP_PAUSE_ROLE,
    APP_MANAGE_FEE,
    APP_MANAGE_WITHDRAWAL_KEY,
    APP_MANAGE_SIGNING_KEYS,
    TOKEN_MINT_ROLE,
    TOKEN_BURN_ROLE,
  ] = await Promise.all([
    pool.PAUSE_ROLE(),
    pool.MANAGE_FEE(),
    pool.MANAGE_WITHDRAWAL_KEY(),
    pool.MANAGE_SIGNING_KEYS(),
    token.MINT_ROLE(),
    token.BURN_ROLE(),
  ]);

  await Promise.all([
    // Allow voting to manage the pool
    acl.createPermission(voting, pool.address, APP_PAUSE_ROLE, appManager, {from: appManager}),
    acl.createPermission(voting, pool.address, APP_MANAGE_FEE, appManager, {from: appManager}),
    acl.createPermission(voting, pool.address, APP_MANAGE_WITHDRAWAL_KEY, appManager, {from: appManager}),
    acl.createPermission(voting, pool.address, APP_MANAGE_SIGNING_KEYS, appManager, {from: appManager}),
    // Allow the pool to mint and burn tokens
    acl.createPermission(pool.address, token.address, TOKEN_MINT_ROLE, appManager, {from: appManager}),
    acl.createPermission(pool.address, token.address, TOKEN_BURN_ROLE, appManager, {from: appManager}),
  ]);

  await pool.initialize(token.address, validatorRegistration.address, oracle.address);

  await oracle.setPool(pool.address);
  await validatorRegistration.reset();

  const [treasuryAddr, insuranceAddr] = await Promise.all([
    pool.getTreasury(),
    pool.getInsuranceFund(),
  ]);

  return {
    dao,
    acl,
    oracle,
    validatorRegistration,
    token,
    pool,
    treasuryAddr,
    insuranceAddr,
  };
}
