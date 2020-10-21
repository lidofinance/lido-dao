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

const ETH = (value) => web3.utils.toWei(value + '', 'ether');
const tokens = ETH;


contract('DePool with StEth', ([appManager, voting, user1, user2, user3, nobody]) => {
  let appBase, stEthBase, stakingProvidersRegistryBase, app, token, oracle, validatorRegistration, sps;
  let treasuryAddr, insuranceAddr;
  // Fee and its distribution are in basis points, 10000 corresponding to 100%
  // Total fee is 1%
  const totalFeePoints = 0.01 * 10000

  // Of this 1%, 30% goes to the treasury
  const treasuryFeePoints = 0.3 * 10000
  // 20% goes to the insurance fund
  const insuranceFeePoints = 0.2 * 10000
  // 50% goes to staking providers
  const stakingProvidersFeePoints = 0.5 * 10000

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

    // StakingProvidersRegistry
    let proxyAddress = await newApp(dao, 'staking-providers-registry', stakingProvidersRegistryBase.address, appManager);
    sps = await StakingProvidersRegistry.at(proxyAddress);
    await sps.initialize();

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    proxyAddress = await newApp(dao, 'depool', appBase.address, appManager);
    app = await DePool.at(proxyAddress);

    // token
    proxyAddress = await newApp(dao, 'steth', stEthBase.address, appManager);
    token = await StETH.at(proxyAddress);
    await token.initialize(app.address);

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.PAUSE_ROLE(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.MANAGE_FEE(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.MANAGE_WITHDRAWAL_KEY(), appManager, {from: appManager});
    await acl.createPermission(voting, app.address, await app.SET_DEPOSIT_ITERATION_LIMIT(), appManager, {from: appManager});

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
    await app.initialize(token.address, validatorRegistration.address, oracle.address, sps.address, 10);
    treasuryAddr = await app.getTreasury();
    insuranceAddr = await app.getInsuranceFund();
    await oracle.setPool(app.address);
    await validatorRegistration.reset();
    await sps.setPool(app.address, {from: voting});

    // Set fee
    await app.setFee(totalFeePoints, { from: voting })
    await app.setFeeDistribution(treasuryFeePoints, insuranceFeePoints, stakingProvidersFeePoints, { from: voting })
  })

  it('check fee configuration', async () => {
    assertBn(await app.getFee(), totalFeePoints)
    const fees = await app.getFeeDistribution();
    assertBn(fees.treasuryFeeBasisPoints, treasuryFeePoints);
    assertBn(fees.insuranceFeeBasisPoints, insuranceFeePoints);
    assertBn(fees.SPFeeBasisPoints, stakingProvidersFeePoints);
  });

  it('check token variables', async () => {
    assert.equal(await token.name(), "Liquid staked Ether 2.0");
    assert.equal(await token.symbol(), "StETH");
    assert.equal(await token.decimals(), 18);
    assertBn(await token.totalSupply(), tokens(0));
    assertBn(await token.balanceOf(user1), tokens(0));
  });

  context('in dual-SP configuration', async () => {
    beforeEach(async function () {
      await sps.addStakingProvider("1", ADDRESS_1, UNLIMITED, {from: voting});
      await sps.addStakingProvider("2", ADDRESS_2, UNLIMITED, {from: voting});
      await app.setWithdrawalCredentials(pad("0x0202", 32), {from: voting});
      await sps.addSigningKeys(0, 1, pad("0x010203", 48), pad("0x01", 96), {from: voting});
      await sps.addSigningKeys(0, 3,
          hexConcat(pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48)),
          hexConcat(pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)),
          {from: voting});
    });
    context('user2 submitted 34 ETH', async () => {
      beforeEach(async function () {
        await web3.eth.sendTransaction({to: app.address, from: user2, value: ETH(34)});
      });
      it('non-oracle roles can\'t report', async () => {
        await assertRevert(app.reportEther2(100, ETH(29), {from: nobody}), 'APP_AUTH_FAILED');
      });
      it('unable to report zero epoch', async () => {
        await assertRevert(oracle.reportEther2(0, ETH(29)), 'ZERO_EPOCH');
      });
      it('DePool: deposited=32, remote=0, buffered=2, totalControlled=34, rewBase=32', async () => {
        const stat = await app.getEther2Stat();
        assertBn(stat.deposited, ETH(32));
        assertBn(stat.remote, ETH(0));
        assertBn(await app.getBufferedEther(), ETH(2));
        assertBn(await app.getTotalControlledEther(), ETH(34));
        assertBn(await app.getRewardBase(), ETH(32));
      });
      it('stETH: totalSupply=34 user2=34', async () => {
        assertBn(await token.totalSupply(), tokens(34));
        assertBn(await token.balanceOf(user1), tokens(0));
        assertBn(await token.balanceOf(user2), tokens(34));
      });
      it('stETH shares: total=34 user2=34', async () => {
        assertBn(await token.getTotalShares(), tokens(34));
        assertBn(await token.getSharesByHolder(user1), tokens(0));
        assertBn(await token.getSharesByHolder(user2), tokens(34));
      });
      context('oracle reported 30 ETH (2 ETH lost due slashing)', async () => {
        beforeEach(async function () {
          await oracle.reportEther2(100, ETH(30));
        });
        it('DePool: deposited=32, remote=30, buffered=2, totalControlled=32, rewBase=32', async () => {
          const stat = await app.getEther2Stat();
          assertBn(stat.deposited, ETH(32));
          assertBn(stat.remote, ETH(30));
          assertBn(await app.getBufferedEther(), ETH(2));
          assertBn(await app.getTotalControlledEther(), ETH(32));
          assertBn(await app.getRewardBase(), ETH(32));
        });
        it('stETH: totalSupply=32 user2=32', async () => {
          assertBn(await token.totalSupply(), tokens(32));
          assertBn(await token.balanceOf(user1), tokens(0));
          assertBn(await token.balanceOf(user2), tokens(32));
        });
        it('stETH shares: total=34 user2=34', async () => {
          assertBn(await token.getTotalShares(), tokens(34));
          assertBn(await token.getSharesByHolder(user1), tokens(0));
          assertBn(await token.getSharesByHolder(user2), tokens(34));
        });
        it('stale data of passed epoch get discarded', async () => {
          await oracle.reportEther2(50, ETH(100));
          const stat = await app.getEther2Stat();
          assertBn(stat.deposited, ETH(32));
          assertBn(stat.remote, ETH(30));
          assertBn(await app.getBufferedEther(), ETH(2));
          assertBn(await app.getTotalControlledEther(), ETH(32));
          assertBn(await app.getRewardBase(), ETH(32));
        });
        context('oracle reported 33 ETH (recovered then rewarded)', async () => {
          beforeEach(async function () {
            await oracle.reportEther2(200, ETH(33));
          });
          it('DePool: deposited=32, remote=33, buffered=2, totalControlled=35, rewBase=33', async () => {
            const stat = await app.getEther2Stat();
            assertBn(stat.deposited, ETH(32));
            assertBn(stat.remote, ETH(33));
            assertBn(await app.getBufferedEther(), ETH(2));
            assertBn(await app.getTotalControlledEther(), ETH(35));
            assertBn(await app.getRewardBase(), ETH(33));
          });
          it('stETH: totalSupply=35 user=34.99 treasury.003, insurance=.002, sps=.004', async () => {
            assertBn(await token.totalSupply(), tokens(35));
            assertBn(await token.balanceOf(user2),         new BN('34990001971093930278'));
            assertBn(await token.balanceOf(treasuryAddr),  new BN('00002999143026093765'));
            assertBn(await token.balanceOf(insuranceAddr), new BN('00001999600063664000'));

            assertBn(await token.balanceOf(ADDRESS_1),   new BN('00004999285816311954'));
            assertBn(await token.balanceOf(ADDRESS_2),   new BN('0'));
          });
          it('stETH shares: total=34.01 user2=34 treasury.003, insurance=.002, sps=.004', async () => {
            assertBn(await token.getTotalShares(), new BN('34009715146146239066'));
            assertBn(await token.getSharesByHolder(user2), tokens(34)); //stays the same
            assertBn(await token.getSharesByHolder(treasuryAddr), new BN('00002914285714285714'));
            assertBn(await token.getSharesByHolder(insuranceAddr), new BN('00001943023673469387'));

            assertBn(await token.getSharesByHolder(ADDRESS_1), new BN('00004857836758483964'));
            assertBn(await token.getSharesByHolder(ADDRESS_2), new BN('0'));
          });
        });
      });

      context('oracle reported 66 ETH (never slashed)', async () => {
        beforeEach(async function () {
          await oracle.reportEther2(200, ETH(66));
        });
        it('DePool: deposited=32, remote=66, buffered=2, totalControlled=68, rewBase=66', async () => {
          const stat = await app.getEther2Stat();
          assertBn(stat.deposited, ETH(32));
          assertBn(stat.remote, ETH(66));
          assertBn(await app.getBufferedEther(), ETH(2));
          assertBn(await app.getTotalControlledEther(), ETH(68));
          assertBn(await app.getRewardBase(), ETH(66));
        });
        it('stETH: totalSupply=68 user=68.99 treasury=.006, insurance=.004, sps=.004', async () => {
          assertBn(await token.totalSupply(), tokens(68));
          assertBn(await token.balanceOf(user2),         new BN('67661169524583879360'));
          assertBn(await token.balanceOf(treasuryAddr),  new BN('101491754286875819'));
          assertBn(await token.balanceOf(insuranceAddr), new BN('67762661278870755'));

          assertBn(await token.balanceOf(ADDRESS_1),   new BN('169576059850374062'));
          assertBn(await token.balanceOf(ADDRESS_2),   new BN('0'));
        });
        it('stETH shares: total=34.17 user2=34 treasury=.05, insurance=.03, sps=.09', async () => {
          assertBn(await token.getTotalShares(), new BN('34170263627500000000'));
          assertBn(await token.getSharesByHolder(user2), tokens(34)); //stays the same
          assertBn(await token.getSharesByHolder(treasuryAddr), new BN('51000000000000000'));
          assertBn(await token.getSharesByHolder(insuranceAddr), new BN('34051000000000000'));

          assertBn(await token.getSharesByHolder(ADDRESS_1), new BN('85212627499999999'));
          assertBn(await token.getSharesByHolder(ADDRESS_2), new BN('0'));
        });

        context('user3 submits 34 ETH (submitted but not propagated to ETH2 yet)', async () => {
          beforeEach(async function () {
            await web3.eth.sendTransaction({to: app.address, from: user3, value: ETH(34)});
          });
          it('DePool: deposited=64, remote=66, buffered=4, totalControlled=70, rewBase=98', async () => {
            const stat = await app.getEther2Stat();
            assertBn(stat.deposited, ETH(64));
            assertBn(stat.remote, ETH(66));
            assertBn(await app.getBufferedEther(), ETH(4));
            assertBn(await app.getTotalControlledEther(), ETH(70));
            assertBn(await app.getRewardBase(), ETH(98)); //was 66, added 32 on submit
          });
          it('stETH: totalSupply=70 user2=46.43 user3=23.33 treasury=.06, insurance=.04, sps=.12', async () => {
            assertBn(await token.totalSupply(), tokens(70));
            assertBn(await token.balanceOf(user2),         new BN('46434135948243838777'));
            assertBn(await token.balanceOf(user3),         new BN('23333333333333333333'));
            assertBn(await token.balanceOf(treasuryAddr),  new BN('00069651203922365758'));
            assertBn(await token.balanceOf(insuranceAddr), new BN('00046503787152166204'));

            assertBn(await token.balanceOf(ADDRESS_1),   new BN('00116375727348295925'));
            assertBn(await token.balanceOf(ADDRESS_2),   new BN('0'));
          });
          it('stETH shares: total=51.255 user2=34 user3=17.085 treasury=.051, insurance=.034, sps=.085', async () => {
            assertBn(await token.getTotalShares(),              new BN('51255395441250000000'));
            assertBn(await token.getSharesByHolder(user2), tokens(34)); //stays the same
            assertBn(await token.getSharesByHolder(user3),      new BN('17085131813750000000'));
            assertBn(await token.getSharesByHolder(treasuryAddr),  new BN('51000000000000000'));
            assertBn(await token.getSharesByHolder(insuranceAddr), new BN('34051000000000000'));

            assertBn(await token.getSharesByHolder(ADDRESS_1), new BN('85212627499999999'));
            assertBn(await token.getSharesByHolder(ADDRESS_2), new BN('0'));
          });
          context('oracle reports 98 ETH (66 existing + 32 new). No rewards at this point', async () => {
            beforeEach(async function () {
              await oracle.reportEther2(300, ETH(98));
            });
            it('DePool: deposited=64, remote=98, buffered=4, totalControlled=102, rewBase=98', async () => {
              const stat = await app.getEther2Stat();
              assertBn(stat.deposited, ETH(64));
              assertBn(stat.remote, ETH(98));
              assertBn(await app.getBufferedEther(), ETH(4));
              assertBn(await app.getTotalControlledEther(), ETH(102));
              assertBn(await app.getRewardBase(), ETH(98)); //was 66, added 32 on submit
            });
            it('stETH: totalSupply=102 user2=67.66 user3=34 treasury=.1, insurance=.067, sps=.17', async () => {
              assertBn(await token.totalSupply(), tokens(102));
              assertBn(await token.balanceOf(user2),         new BN('67661169524583879360'));
              assertBn(await token.balanceOf(user3),         new BN('34000000000000000000'));
              assertBn(await token.balanceOf(treasuryAddr),  new BN('00101491754286875819'));
              assertBn(await token.balanceOf(insuranceAddr), new BN('00067762661278870755'));

              assertBn(await token.balanceOf(ADDRESS_1),   new BN('00169576059850374062'));
              assertBn(await token.balanceOf(ADDRESS_2),   new BN('0'));
            });
            it('stETH shares: total=51.255 user2=34 user3=17.085 treasury=.051, insurance=.034, sps=.085 (same as before)', async () => {
              assertBn(await token.getTotalShares(),              new BN('51255395441250000000'));
              assertBn(await token.getSharesByHolder(user2), tokens(34)); //stays the same
              assertBn(await token.getSharesByHolder(user3),      new BN('17085131813750000000'));
              assertBn(await token.getSharesByHolder(treasuryAddr),  new BN('51000000000000000'));
              assertBn(await token.getSharesByHolder(insuranceAddr), new BN('34051000000000000'));

              assertBn(await token.getSharesByHolder(ADDRESS_1), new BN('85212627499999999'));
              assertBn(await token.getSharesByHolder(ADDRESS_2), new BN('0'));
            });
          });
        });

      });

    });
    it('non-oracle roles can\'t report', async () => {
      await assertRevert(app.reportEther2(100, ETH(30), {from: appManager}), 'APP_AUTH_FAILED');
    });
    it('initial values are zeros', async () => {
      const stat = await app.getEther2Stat();
      assertBn(stat.deposited, ETH(0));
      assertBn(stat.remote, ETH(0));
      assertBn(await app.getBufferedEther(), ETH(0));
      assertBn(await app.getTotalControlledEther(), ETH(0));
      assertBn(await app.getRewardBase(), ETH(0));
    });
  });
});
