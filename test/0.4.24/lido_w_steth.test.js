const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { BN } = require('bn.js')

const StETH = artifacts.require('StETH.sol') // we can just import due to StETH imported in test_helpers/Imports.sol
const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

const Lido = artifacts.require('TestLido.sol')
const OracleMock = artifacts.require('OracleMock.sol')
const ValidatorRegistrationMock = artifacts.require('ValidatorRegistrationMock.sol')

const UNLIMITED = 1000000000

const pad = (hex, bytesLength) => {
  const absentZeroes = bytesLength * 2 + 2 - hex.length
  if (absentZeroes > 0) hex = '0x' + '0'.repeat(absentZeroes) + hex.substr(2)
  return hex
}

const hexConcat = (first, ...rest) => {
  let result = first.startsWith('0x') ? first : '0x' + first
  rest.forEach((item) => {
    result += item.startsWith('0x') ? item.substr(2) : item
  })
  return result
}

const div10d = (bn, d) => bn.div(new BN('1' + '0'.repeat(d)))
const round = (bn) => bn.addn(50).divn(100).muln(100)
const ETH = (value) => new BN(web3.utils.toWei(value + '', 'ether'))
const tokens = ETH

const assertBnDiv = (bnA, bnB, d) => assertBn(div10d(bnA, d), div10d(bnB, d));

contract('Lido with StEth', ([appManager, voting, user1, user2, user3, nobody, nodeOperatorAddress1, nodeOperatorAddress2]) => {
  let appBase, stEthBase, nodeOperatorsRegistryBase, app, token, oracle, validatorRegistration, operators
  let treasuryAddr, insuranceAddr
  // Fee and its distribution are in basis points, 10000 corresponding to 100%
  // Total fee is 1%
  const totalFeePoints = 0.01 * 10000

  // Of this 1%, 30% goes to the treasury
  const treasuryFeePoints = 0.3 * 10000
  // 20% goes to the insurance fund
  const insuranceFeePoints = 0.2 * 10000
  // 50% goes to node operators
  const nodeOperatorsFeePoints = 0.5 * 10000

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await Lido.new()
    stEthBase = await StETH.new()
    oracle = await OracleMock.new()
    validatorRegistration = await ValidatorRegistrationMock.new()
    nodeOperatorsRegistryBase = await NodeOperatorsRegistry.new()
  })

  beforeEach('deploy dao and app', async () => {
    const { dao, acl } = await newDao(appManager)

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    let proxyAddress = await newApp(dao, 'lido', appBase.address, appManager)
    app = await Lido.at(proxyAddress)

    // NodeOperatorsRegistry
    proxyAddress = await newApp(dao, 'node-operators-registry', nodeOperatorsRegistryBase.address, appManager)
    operators = await NodeOperatorsRegistry.at(proxyAddress)
    await operators.initialize(app.address)

    // token
    proxyAddress = await newApp(dao, 'steth', stEthBase.address, appManager)
    token = await StETH.at(proxyAddress)
    await token.initialize(app.address)

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.PAUSE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.MANAGE_FEE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.MANAGE_WITHDRAWAL_KEY(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_DEPOSIT_ITERATION_LIMIT(), appManager, { from: appManager })

    await acl.createPermission(app.address, token.address, await token.MINT_ROLE(), appManager, { from: appManager })
    await acl.createPermission(app.address, token.address, await token.BURN_ROLE(), appManager, { from: appManager })

    await acl.createPermission(voting, operators.address, await operators.MANAGE_SIGNING_KEYS(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.ADD_NODE_OPERATOR_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_ACTIVE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_NAME_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_ADDRESS_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_LIMIT_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.REPORT_STOPPED_VALIDATORS_ROLE(), appManager, {
      from: appManager
    })

    // Initialize the app's proxy.
    await app.initialize(token.address, validatorRegistration.address, oracle.address, operators.address, 10)
    treasuryAddr = await app.getTreasury()
    insuranceAddr = await app.getInsuranceFund()
    await oracle.setPool(app.address)
    await validatorRegistration.reset()

    // Set fee
    await app.setFee(totalFeePoints, { from: voting })
    await app.setFeeDistribution(treasuryFeePoints, insuranceFeePoints, nodeOperatorsFeePoints, { from: voting })
  })

  it('check fee configuration', async () => {
    assertBn(await app.getFee(), totalFeePoints)
    const fees = await app.getFeeDistribution()
    assertBn(fees.treasuryFeeBasisPoints, treasuryFeePoints)
    assertBn(fees.insuranceFeeBasisPoints, insuranceFeePoints)
    assertBn(fees.operatorsFeeBasisPoints, nodeOperatorsFeePoints)
  })

  it('check token variables', async () => {
    assert.equal(await token.name(), 'Liquid staked Ether 2.0')
    assert.equal(await token.symbol(), 'StETH')
    assert.equal(await token.decimals(), 18)
    assertBn(await token.totalSupply(), tokens(0))
    assertBn(await token.balanceOf(user1), tokens(0))
  })

  context('started with single-operator configuration', async () => {
    beforeEach(async function () {
      await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

      await operators.addNodeOperator('1', nodeOperatorAddress1, UNLIMITED, { from: voting })
      await operators.addSigningKeys(0, 1, hexConcat(pad('0x010203', 48)), hexConcat(pad('0x01', 96)), { from: voting })
    })

    it('initial values are zeros', async () => {
      const stat = await app.getBeaconStat()
      assertBn(stat.depositedValidators, 0)
      assertBn(stat.beaconBalance, ETH(0))
      assertBn(await app.getBufferedEther(), ETH(0))
      assertBn(await app.getTotalPooledEther(), ETH(0))
    })

    context('user2 submitted 34 ETH', async () => {
      beforeEach(async function () {
        await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(34) })
        await app.depositBufferedEther()
      })

      it('Lido: deposited=32, remote=0, buffered=2, totalPooled=34, rewBase=32', async () => {
        /* When user2 submits 34 Ethers, 32 of them get deposited to Deposit ETH2 contract,
        and 2 Ethers get buffered on Lido contract.
        totalPooledEther is the sum of deposited and buffered values.
        */
        const stat = await app.getBeaconStat()
        assertBn(stat.depositedValidators, 1)
        assertBn(stat.beaconBalance, ETH(0))
        assertBn(await app.getBufferedEther(), ETH(2))
        assertBn(await app.getTotalPooledEther(), ETH(34))
      })

      it('stETH: totalSupply=34 user2=34', async () => {
        /* The initial deposit initiates the stETH token with the corresponding totalSupply
        that is taken from lido.totalPooledEther.
        Submitter's balance is equivalent to deposited Ether amount.
        */
        assertBn(await token.totalSupply(), tokens(34))
        assertBn(await token.balanceOf(user1), tokens(0))
        assertBn(await token.balanceOf(user2), tokens(34))
      })

      it('stETH shares: total=34 user2=34', async () => {
        /* Until the first oracle report share-to-balance ratio is 1:1
         */
        assertBn(await token.getTotalShares(), tokens(34))
        assertBn(await token.getSharesByHolder(user1), tokens(0))
        assertBn(await token.getSharesByHolder(user2), tokens(34))
      })

      context('oracle reported 30 ETH (2 ETH lost due slashing)', async () => {
        beforeEach(async function () {
          /* Let's assume node operator forgot to run validator or misconfigured it. The validator
          was a subject to slashing and lost 2 Ether of 32.
          */
          await oracle.reportBeacon(100, 1, ETH(30))
        })

        it('Lido: deposited=32, remote=30, buffered=2, totalPooled=32, rewBase=32', async () => {
          /* The oracle's report changes `remote` value (was 32, became 30).
          This affects output of totalPooledEther, that decreased by 2.
          */
          const stat = await app.getBeaconStat()
          assertBn(stat.depositedValidators, 1)
          assertBn(stat.beaconBalance, ETH(30))
          assertBn(await app.getBufferedEther(), ETH(2))
          assertBn(await app.getTotalPooledEther(), ETH(32))
        })

        it('stETH: totalSupply=32 user2=32', async () => {
          // totalSupply and staker's balance decreased due to slashing (34 -> 32)
          assertBn(await token.totalSupply(), tokens(32))
          assertBn(await token.balanceOf(user1), tokens(0))
          assertBn(await token.balanceOf(user2), tokens(32))
        })

        it('stETH shares: total=34 user2=34', async () => {
          // total and personal shares as relative measure stay the same despite of slashing
          assertBn(await token.getTotalShares(), tokens(34))
          assertBn(await token.getSharesByHolder(user1), tokens(0))
          assertBn(await token.getSharesByHolder(user2), tokens(34))
        })

        context('oracle reported 33 ETH (recovered then rewarded)', async () => {
          beforeEach(async function () {
            /* The validators worked hard and honestly and gradually worked out losses.
          One day oracle's report says that `remote` became more than initial deposit.
          It's the first point where they produced reward (initially submitted 32, now 33. Profit: 1 Ether)
          */
            await oracle.reportBeacon(200, 1, ETH(33))
          })

          it('Lido: deposited=32, remote=33, buffered=2, totalPooled=35, rewBase=33', async () => {
            /* This positive oracle's report updates the `remote` value.
            and totalPooledEther's formula gives the increased amount:
            totalPooledEther = 34 Ether initial submission + 1 Ether reward = 35 Ether
              or
            totalPooledEther = 33 Ether remote + 2 Ether buffer = 35 Ether
            New totalPooledEther value leads to increase of stETH.totalSupply and output of
            personal balances increased proportionally to holders' shares.
            */
            const stat = await app.getBeaconStat()
            assertBn(stat.depositedValidators, 1)
            assertBn(stat.beaconBalance, ETH(33))
            assertBn(await app.getBufferedEther(), ETH(2))
            assertBn(await app.getTotalPooledEther(), ETH(35))
          })

          it('stETH: totalSupply=35 user=34.99 treasury.003, insurance=.002, operator=.005', async () => {
            /*
            New totalPooledEther value leads to increase of stETH.totalSupply, and output of
            personal balances increased proportionally to holders' shares.
            Oracle's report also triggers fee payment that is substracted from the reward.
            The fee divides in given proportion between operators, treasury and insurance vaults.

            userBalance = 34.0 Ether staked
            shares = 34.0
            totalPooledEtherInitial = 34.0 Ether
            totalPooledEtherNew = 35.0 Ether
            reward = totalPooledEtherNew - totalPooledEtherInitial = 1.0 Ether
            totalFee = reward * 0.01 = 0.01 stETH (equals to Ether)
            userGets = reward - totalFee = 0.99 stETH
            userBalance = userBalance + totalFee = 34.99
            treasuryBalance = totalFee * 0.3 = 0.003
            insuranceBalance = totalFee * 0.2 = 0.002
            operatorsBalance = totalFee * 0.5 = 0.005
            */
            assertBn(await token.totalSupply(), tokens(35))
            assertBn(round(await token.balanceOf(user2)), tokens(34.99))
            assertBn(round(await token.balanceOf(treasuryAddr)), tokens(0.003))
            assertBn(round(await token.balanceOf(insuranceAddr)), tokens(0.002))
            // single operator_1 takes all operators' reward in this configuration
            assertBn(round(await token.balanceOf(nodeOperatorAddress1)), tokens(0.005))
          })

          it('stETH shares: total=34.0097 user2=34 treasury.0029, insurance=.0019, operator=.0048', async () => {
            // totalShares increased to reflect new balances.
            assertBn(div10d(await token.getTotalShares(), 10), new BN('3400971706'))
            assertBn(await token.getSharesByHolder(user2), tokens(34)) // stays the same
            assertBn(div10d(await token.getSharesByHolder(treasuryAddr), 10), new BN('291511'))
            assertBn(div10d(await token.getSharesByHolder(insuranceAddr), 10), new BN('194341'))
            assertBn(div10d(await token.getSharesByHolder(nodeOperatorAddress1), 10), new BN('485853'))
          })
        })

        context('2nd operator added (still inactive)', async () => {
          beforeEach(async function () {
            await operators.addNodeOperator('2', nodeOperatorAddress2, UNLIMITED, { from: voting })
          })

          context('oracle reported 33 ETH (recovered then rewarded), must be same as without new operator', async () => {
            beforeEach(async function () {
              await oracle.reportBeacon(200, 1, ETH(33))
            })

            it('Lido: deposited=32, remote=33, buffered=2, totalPooled=35, rewBase=33', async () => {
              const stat = await app.getBeaconStat()
              assertBn(stat.depositedValidators, 1)
              assertBn(stat.beaconBalance, ETH(33))
              assertBn(await app.getBufferedEther(), ETH(2))
              assertBn(await app.getTotalPooledEther(), ETH(35))
            })

            it('stETH: totalSupply=35 user=34.99 treasury=.003, insurance=.002, operator_1=.005 operator_2=0', async () => {
              assertBn(await token.totalSupply(), tokens(35))
              assertBn(round(await token.balanceOf(user2)), tokens(34.99))
              assertBn(round(await token.balanceOf(treasuryAddr)), tokens(0.003))
              assertBn(round(await token.balanceOf(insuranceAddr)), tokens(0.002))
              // operator_1 : operator_2 reward = 1 : 0
              assertBn(round(await token.balanceOf(nodeOperatorAddress1)), tokens(0.005))
              assertBn(round(await token.balanceOf(nodeOperatorAddress2)), tokens(0))
            })

            it('stETH shares: total=34.01 user2=34 treasury.003, insurance=.002, operator_1=.005', async () => {
              assertBn(div10d(await token.getTotalShares(), 10), new BN('3400971706'))
              assertBn(await token.getSharesByHolder(user2), tokens(34)) // stays the same
              assertBn(div10d(await token.getSharesByHolder(treasuryAddr), 10), new BN('291511'))
              assertBn(div10d(await token.getSharesByHolder(insuranceAddr), 10), new BN('194341'))
              // operator_1 : operator_2 reward = 1 : 0
              assertBn(div10d(await token.getSharesByHolder(nodeOperatorAddress1), 10), new BN('485853'))
              assertBn(await token.getSharesByHolder(nodeOperatorAddress2), new BN('0'))
            })
          })

          context('2nd operator activated (same amount of effective keys)', async () => {
            beforeEach(async function () {
              await operators.addSigningKeys(1, 1, hexConcat(pad('0x010207', 48)), hexConcat(pad('0x01', 96)), { from: voting })
              await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(30) })
              await app.depositBufferedEther()

              await oracle.reportBeacon(300, 2, ETH(64))
            })

            it('Lido: deposited=64, remote=64, buffered=0, totalPooled=64, rewBase=64', async () => {
              const stat = await app.getBeaconStat()
              assertBn(stat.depositedValidators, 1)
              assertBn(stat.beaconBalance, ETH(64))
              assertBn(await app.getBufferedEther(), ETH(0))
              assertBn(await app.getTotalPooledEther(), ETH(64))
            })

            context('oracle reported 66 ETH (rewarded 2 Ether)', async () => {
              beforeEach(async function () {
                await oracle.reportBeacon(400, 2, ETH(66))
              })

              it('Lido: deposited=64, remote=66, buffered=0, totalPooled=66, rewBase=66', async () => {
                const stat = await app.getBeaconStat()
                assertBn(stat.depositedValidators, ETH(64))
                assertBn(stat.beaconBalance, ETH(66))
                assertBn(await app.getBufferedEther(), ETH(0))
                assertBn(await app.getTotalPooledEther(), ETH(66))
              })

              it('stETH: totalSupply=66 user=65.98 treasury.006, insurance=.004, operators=.010', async () => {
                assertBn(await token.totalSupply(), tokens(66))
                assertBn(round(await token.balanceOf(user2)), tokens(65.98))
                assertBn(round(await token.balanceOf(treasuryAddr)), tokens(.006))
                assertBn(round(await token.balanceOf(insuranceAddr)), tokens(.004))
                // operator_1 : operator_2 reward = 1 : 1
                assertBn(round(await token.balanceOf(nodeOperatorAddress1)), tokens(.005))
                assertBn(round(await token.balanceOf(nodeOperatorAddress2)), tokens(.005))
              })

              it('stETH shares: total=65.8949 user2=65.875 treasury.00599, insurance=.00399, operators=.00998', async () => {
                assertBn(div10d(await token.getTotalShares(), 10), new BN('6589496817'))
                assertBn(await token.getSharesByHolder(user2), tokens(65.875))
                assertBn(div10d(await token.getSharesByHolder(treasuryAddr), 10), new BN('599045'))
                assertBn(div10d(await token.getSharesByHolder(insuranceAddr), 10), new BN('399363'))
                // operator_1 : operator_2 reward = 1 : 1
                assertBn(div10d(await token.getSharesByHolder(nodeOperatorAddress1), 10), new BN('499204'))
                assertBn(div10d(await token.getSharesByHolder(nodeOperatorAddress2), 10), new BN('499204'))
              })
            })

            context('1st operator with 2 keys, 2nd operator with 1 key', async () => {
              beforeEach(async function () {
                await operators.addSigningKeys(0, 1, hexConcat(pad('0x01020b', 48)), hexConcat(pad('0x01', 96)), { from: voting })
                await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(32) })
                await app.depositBufferedEther()
                await oracle.reportBeacon(500, 3, ETH(96))
              })

              it('Lido: deposited=96, remote=96, buffered=0, totalPooled=96, rewBase=96', async () => {
                const stat = await app.getBeaconStat()
                assertBn(stat.depositedValidators, 3)
                assertBn(stat.beaconBalance, ETH(96))
                assertBn(await app.getBufferedEther(), ETH(0))
                assertBn(await app.getTotalPooledEther(), ETH(96))
              })

              context('oracle reported 100 ETH (rewarded 4 Ether)', async () => {
                beforeEach(async function () {
                  await oracle.reportBeacon(600, 3, ETH(100))
                })

                it('Lido: deposited=96, remote=100, buffered=0, totalPooled=100, rewBase=100', async () => {
                  const stat = await app.getBeaconStat()
                  assertBn(stat.depositedValidators, ETH(96))
                  assertBn(stat.beaconBalance, ETH(100))
                  assertBn(await app.getBufferedEther(), ETH(0))
                  assertBn(await app.getTotalPooledEther(), ETH(100))
                })

                it('stETH: totalSupply=100 user=99.96 treasury=.012, insurance=.008, operators=.020', async () => {
                  assertBn(await token.totalSupply(), tokens(100))
                  // fees = 4 * 0.01 = 0.04 Ether
                  // userReward = 4 - fee = 3.96
                  // userBalance = 96 + userReward = 99.96
                  assertBn(round(await token.balanceOf(user2)), tokens(99.96))
                  assertBn(round(await token.balanceOf(treasuryAddr)), tokens(.012))
                  assertBn(round(await token.balanceOf(insuranceAddr)), tokens(.008))
                  // operator_1 : operator_2 reward = 2 : 1
                  assertBnDiv(await token.balanceOf(nodeOperatorAddress1), tokens(.02 * 2 / 3), 2)
                  assertBnDiv(await token.balanceOf(nodeOperatorAddress2), tokens(.02 / 3), 2)
                })

                it('stETH shares: total=98.852 user2=98.8125, treasury=.01186, insurance=.0079, operators=.01977', async () => {
                  assertBn(div10d(await token.getTotalShares(), 10), new BN('9885204081'))
                  assertBn(await token.getSharesByHolder(user2), tokens(98.8125))
                  assertBn(div10d(await token.getSharesByHolder(treasuryAddr), 10), new BN('1186224'))
                  assertBn(div10d(await token.getSharesByHolder(insuranceAddr), 10), new BN('790816'))
                  // operator_1 : operator_2 reward = 2 : 1
                  assertBn(div10d(await token.getSharesByHolder(nodeOperatorAddress1), 10), new BN('1318027'))
                  assertBn(div10d(await token.getSharesByHolder(nodeOperatorAddress2), 10), new BN('659013'))
                })
              })
            })
          })
        })
      })

      context('oracle reported 66 ETH (never slashed)', async () => {
        beforeEach(async function () {
          // must be several signing keys for that case
          await operators.addSigningKeys(0, 1, hexConcat(pad('0x020203', 48)), hexConcat(pad('0x01', 96)), { from: voting })
          await oracle.reportBeacon(200, 2, ETH(66))
        })

        it('Lido: deposited=32, remote=66, buffered=2, totalPooled=68, rewBase=66', async () => {
          /*
          userBalance = 34.0 Ether staked
          shares = 34.0
          totalPooledEtherInitial = 34.0 Ether
          totalPooledEtherNew = 68.0 Ether (66 remote + 2 buffer)
          reward = totalPooledEtherNew - totalPooledEtherInitial = 34.0 Ether
          totalFee = reward * 0.01 = 0.34 stETH
          userGets = reward - totalFee = 33.66 stETH
          userBalance = userBalance + reward - totalFee = 67.66 stETH
          treasuryBalance = totalFee * 0.3 = 0.102
          insuranceBalance = totalFee * 0.2 = 0.068
          operatorsBalance = totalFee * 0.5 = 0.17
          */
          const stat = await app.getBeaconStat()
          assertBn(stat.depositedValidators, 1)
          assertBn(stat.beaconBalance, ETH(66))
          assertBn(await app.getBufferedEther(), ETH(2))
          assertBn(await app.getTotalPooledEther(), ETH(68))
        })

        it('stETH: totalSupply=68 user=67.66 treasury=.102, insurance=.068, operators=.17', async () => {
          assertBn(await token.totalSupply(), tokens(68))
          assertBn(round(await token.balanceOf(user2)), tokens(67.66))
          assertBn(round(await token.balanceOf(treasuryAddr)), tokens(.102))
          assertBn(round(await token.balanceOf(insuranceAddr)), tokens(.068))
          assertBn(round(await token.balanceOf(nodeOperatorAddress1)), tokens(.17))
        })

        it('stETH shares: total=34.17 user2=34 treasury=.0512, insurance=.0341, operators=.09', async () => {
          assertBn(div10d(await token.getTotalShares(), 10), new BN('3417085427'))
          assertBn(await token.getSharesByHolder(user2), tokens(34)) // stays the same
          assertBn(div10d(await token.getSharesByHolder(treasuryAddr), 10), new BN('5125628'))
          assertBn(div10d(await token.getSharesByHolder(insuranceAddr), 10), new BN('3417085'))
          assertBn(div10d(await token.getSharesByHolder(nodeOperatorAddress1), 10), new BN('8542713'))
        })

        context('user3 submits another 34 ETH (submitted but not seen on beacon by oracle yet)', async () => {
          beforeEach(async function () {
            // so total submitted 34 + 34
            await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(34) })
            await app.depositBufferedEther()
          })

          it('Lido: deposited=64, remote=66, buffered=4, totalPooled=70, rewBase=98', async () => {
            const stat = await app.getBeaconStat()
            assertBn(stat.depositedValidators, 2) // two submissions: 32 + 32
            assertBn(stat.beaconBalance, ETH(66)) // first submission (32) propagated to eth2 and rewarded +34
            assertBn(await app.getBufferedEther(), ETH(4)) // remainders of first (34-32) and second (34-32) submissions
            assertBn(await app.getTotalPooledEther(), ETH(70)) // remote + buffer
          })

          it('stETH: totalSupply=70 user2=46.4(3) user3=23.3(3) treasury=.07, insurance=.04(6), operators=.11(6)', async () => {
            assertBn(await token.totalSupply(), tokens(70))
            assertBnDiv(await token.balanceOf(user2), tokens(46.4).add(tokens(.1 / 3)), 5)
            assertBnDiv(await token.balanceOf(user3), tokens(23.3).add(tokens(.1 / 3)), 5)
            assertBn(round(await token.balanceOf(treasuryAddr)), tokens(.07))
            assertBnDiv(await token.balanceOf(insuranceAddr), tokens(.04).add(tokens(.01 * 2 / 3)), 5)
            assertBnDiv(await token.balanceOf(nodeOperatorAddress1), tokens(.11).add(tokens(.01 * 2 / 3)), 5)
          })

          it('stETH shares: total=51.256 user2=34 user3=17.085 treasury=.051, insurance=.034, operators=.085 (same as before)', async () => {
            assertBn(div10d(await token.getTotalShares(), 10), new BN('5125628140'))
            assertBn(await token.getSharesByHolder(user2), tokens(34)) // stays the same
            assertBn(div10d(await token.getSharesByHolder(user3), 10), new BN('1708542713'))
            assertBn(div10d(await token.getSharesByHolder(treasuryAddr), 10), new BN('5125628'))
            assertBn(div10d(await token.getSharesByHolder(insuranceAddr), 10), new BN('3417085'))
            assertBn(div10d(await token.getSharesByHolder(nodeOperatorAddress1), 10), new BN('8542713'))
          })

          context('oracle reports 98 ETH (66 existing + 32 new). No rewards at this point', async () => {
            beforeEach(async function () {
              await oracle.reportBeacon(300, 3, ETH(98))
            })

            it('Lido: deposited=64, remote=98, buffered=4, totalPooled=102, rewBase=98', async () => {
              const stat = await app.getBeaconStat()
              assertBn(stat.depositedValidators, 2)
              assertBn(stat.beaconBalance, ETH(98))
              assertBn(await app.getBufferedEther(), ETH(4))
              assertBn(await app.getTotalPooledEther(), ETH(102))
            })

            it('stETH: totalSupply=102 user2=67.66 user3=34 treasury=.102, insurance=.068, operators=.17', async () => {
              assertBn(await token.totalSupply(), tokens(102))
              assertBn(round(await token.balanceOf(user2)), tokens(67.66))
              assertBn(round(await token.balanceOf(user3)), tokens(34))
              assertBn(round(await token.balanceOf(treasuryAddr)), tokens(.102))
              assertBn(round(await token.balanceOf(insuranceAddr)), tokens(.068))
              assertBn(round(await token.balanceOf(nodeOperatorAddress1)), tokens(.17))
            })

            it('stETH shares: total=51.256 user2=34 user3=17.085 treasury=.051, insurance=.034, operators=.085 (same as before)', async () => {
              assertBn(div10d(await token.getTotalShares(), 10), new BN('5125628140'))
              assertBn(await token.getSharesByHolder(user2), tokens(34)) // stays the same
              assertBn(div10d(await token.getSharesByHolder(user3), 10), new BN('1708542713'))
              assertBn(div10d(await token.getSharesByHolder(treasuryAddr), 10), new BN('5125628'))
              assertBn(div10d(await token.getSharesByHolder(insuranceAddr), 10), new BN('3417085'))
              assertBn(div10d(await token.getSharesByHolder(nodeOperatorAddress1), 10), new BN('8542713'))
            })
          })
        })
      })
    })
  })

  context('change fee', () => {
    // Total fee is 10%
    const totalFeePoints = 0.1 * 10000

    // Of this 10%, 35% goes to the treasury
    const treasuryFeePoints = 0.1 * 10000
    // 20% goes to the insurance fund
    const insuranceFeePoints = 0.3 * 10000
    // 50% goes to node operators
    const nodeOperatorsFeePoints = 0.6 * 10000

    beforeEach(async () => {
      await app.setFee(totalFeePoints, { from: voting })
      await app.setFeeDistribution(treasuryFeePoints, insuranceFeePoints, nodeOperatorsFeePoints, { from: voting })
    })

    it('check fee configuration', async () => {
      assertBn(await app.getFee(), totalFeePoints)
      const fees = await app.getFeeDistribution()
      assertBn(fees.treasuryFeeBasisPoints, treasuryFeePoints)
      assertBn(fees.insuranceFeeBasisPoints, insuranceFeePoints)
      assertBn(fees.operatorsFeeBasisPoints, nodeOperatorsFeePoints)
    })

    context('check rewards', () => {
      beforeEach(async () => {
        await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
        await operators.addNodeOperator('1', nodeOperatorAddress1, UNLIMITED, { from: voting })
        await operators.addSigningKeys(0, 1, hexConcat(pad('0x010203', 48)), hexConcat(pad('0x01', 96)), { from: voting })

        await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(32) })
        await app.depositBufferedEther()
        await oracle.reportEther2(200, ETH(64))
      })

      it('Lido: deposited=32, remote=64, buffered=0, totalControlled=64, oldRewBase=32, rewBase=64', async () => {
        const stat = await app.getEther2Stat()
        assertBn(stat.deposited, ETH(32))
        assertBn(stat.remote, ETH(64))
        assertBn(await app.getBufferedEther(), ETH(0))
        assertBn(await app.getTotalControlledEther(), ETH(64))
        assertBn(await app.getRewardBase(), ETH(64))
      })

      it('stETH: totalSupply=64 user1=60.8 treasury=.32, insurance=.96, operators=1.92', async () => {
        /*
        userBalance = 64.0 Ether staked
        shares = 32.0
        totalControlledEtherInitial = 32.0 Ether
        totalControlledEtherNew = 64.0 Ether
        reward = totalControlledEtherNew - totalControlledEtherInitial = 32.0 Ether
        totalFee = reward * 0.1 = 3.2 stETH (equals to Ether)
        userGets = reward - totalFee = 28.8 stETH
        userBalance = userBalance + totalFee = 60.8
        treasuryBalance = totalFee * 0.1 = 0.32
        insuranceBalance = totalFee * 0.3 = 0.96
        operatorsBalance = totalFee * 0.6 = 1.92
        */
        assertBn(await token.totalSupply(), tokens(64))
        assertBn(round(await token.balanceOf(app.address)), tokens(0))
        assertBn(round(await token.balanceOf(user1)), tokens(60.8))
        assertBn(round(await token.balanceOf(treasuryAddr)), tokens(0.32))
        assertBn(round(await token.balanceOf(insuranceAddr)), tokens(0.96))
        assertBn(round(await token.balanceOf(nodeOperatorAddress1)), tokens(1.92))
      })
    })
  })
})
