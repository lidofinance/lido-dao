const { assert } = require('chai')
const { assertBn, assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { toBN, assertRevertCustomError } = require('../helpers/utils')
const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const keccak256 = require('js-sha3').keccak_256

const LidoOracleNew = artifacts.require('LidoOracleNewMock.sol')
const Lido = artifacts.require('LidoMockForOracleNew.sol')
const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistryMockForLidoOracleNew')
const BeaconReportReceiver = artifacts.require('BeaconReportReceiverMock')
const BeaconReportReceiverWithoutERC165 = artifacts.require('BeaconReportReceiverMockWithoutERC165')

const GENESIS_TIME = 1606824000
const EPOCH_LENGTH = 32 * 12
const DENOMINATION_OFFSET = 1e9

const ZERO_MEMBER_REPORT = {
  stakingModules: [],
  nodeOperatorsWithExitedValidators: [],
  exitedValidatorsNumbers: [],
  withdrawalVaultBalance: 0,
  withdrawalsReserveAmount: 0,
  requestIdToFinalizeUpTo: [],
  finalizationShareRates: []
}

const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000'
const MANAGE_MEMBERS_ROLE = '0x0f5709a131bd812d54bcbfe625c74b832e351421787d3b67d5015bdfc1658fbd'
const MANAGE_QUORUM_ROLE = '0x68f77d74579a6299ff72f8492235a983bb2d3dff83fe7b4c34c8da1127a1eb87'
const SET_BEACON_SPEC_ROLE = '0xf6d880c20d109428933defa2f109f143247bbe4c84784a6b140b33988b369b37'
const SET_REPORT_BOUNDARIES_ROLE = '0x391653625e4f1b50d601a46cb1d91cfe0d501de98c8e11a46cf55edf20942d7a'
const SET_BEACON_REPORT_RECEIVER_ROLE = '0xe976ee3edb892b8fc9edde1f74da6a8e094e84585a6ab054a2f1c630dba6ed94'

function getAuthError(account, role) {
  return `AccessControl: account ${account.toLowerCase()} is missing role ${role}`
}

// initial pooled ether (it's required to smooth increase of balance
// if you jump from 30 to 60 in one epoch it's a huge annual relative jump over 9000%
// but if you jump from 1e12+30 to 1e12+60 then it's smooth small jump as in the real world.
const START_BALANCE = 1e12

contract.skip('LidoOracleNew', ([voting, user1, user2, user3, user4, user5, user6, user7, nobody]) => {
  let appLido, app, nodeOperatorsRegistry

  const assertExpectedEpochs = async (startEpoch, endEpoch) => {
    assertBn(await app.getExpectedEpochId(), startEpoch)
    assertBn(await app.getCurrentEpochId(), endEpoch)
  }

  const calcReportHash = async (report) => {
    return await app.calcReportHash(report, {from: nobody})
  }

  const calcReportHash2 = async (epochId, beaconValidators, beaconBalanceGwei) => {
    const report = { ...ZERO_MEMBER_REPORT, epochId, beaconValidators, beaconBalanceGwei }
    return await calcReportHash(report)
  }

  const doHashReport = async (epochId, beaconValidators, beaconBalanceGwei, reporter) => {
    const reportHash = await calcReportHash2(epochId, beaconValidators, beaconBalanceGwei)
    return await app.handleCommitteeMemberReport(epochId, reportHash, { from: reporter })
  }

  const doHashAndDataReport = async (epochId, beaconValidators, beaconBalanceGwei, reporter) => {
    const reportHash = await calcReportHash2(epochId, beaconValidators, beaconBalanceGwei)
    await app.handleCommitteeMemberReport(epochId, reportHash, { from: reporter })
    return await app.handleReportData(
      { ...ZERO_MEMBER_REPORT, epochId, beaconValidators, beaconBalanceGwei },
      { from: nobody }
    )
  }


  before('deploy base app', async () => {
    // Deploy the app's base contract.
    nodeOperatorsRegistry = await NodeOperatorsRegistry.new()
    appLido = await Lido.new(nodeOperatorsRegistry.address)
  })

  beforeEach('deploy dao and app', async () => {
    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    // TODO: use proxy
    app = await LidoOracleNew.new({ from: voting })

    // Initialize the app's proxy.
    await app.setTime(GENESIS_TIME)

    assertBn(await app.getVersion(), 0)
    await app.setVersion(1)
    await assertRevertCustomError(
      app.initialize(ZERO_ADDRESS, appLido.address, 1, 32, 12, GENESIS_TIME, 1000, 500),
      'CanInitializeOnlyOnZeroVersion'
    )

    await app.setVersion(0)

    // 1000 and 500 stand for 10% yearly increase, 5% moment decrease
    await app.initialize(voting, appLido.address, 1, 32, 12, GENESIS_TIME, 1000, 500)
    assertBn(await app.getVersion(), 1)
    assertBn(await app.getRoleMemberCount(DEFAULT_ADMIN_ROLE), 1)
    assert((await app.getRoleMember(DEFAULT_ADMIN_ROLE, 0)) === voting)

    // Set up the app's permissions.
    await app.grantRole(await app.MANAGE_MEMBERS_ROLE(), voting, { from: voting })
    await app.grantRole(await app.MANAGE_QUORUM_ROLE(), voting, { from: voting })
    await app.grantRole(await app.SET_BEACON_SPEC_ROLE(), voting, { from: voting })
    await app.grantRole(await app.SET_REPORT_BOUNDARIES_ROLE(), voting, { from: voting })
    await app.grantRole(await app.SET_BEACON_REPORT_RECEIVER_ROLE(), voting, { from: voting })

    assert((await app.MANAGE_MEMBERS_ROLE()) === MANAGE_MEMBERS_ROLE)
    assert((await app.MANAGE_QUORUM_ROLE()) === MANAGE_QUORUM_ROLE)
    assert((await app.SET_BEACON_SPEC_ROLE()) === SET_BEACON_SPEC_ROLE)
    assert((await app.SET_REPORT_BOUNDARIES_ROLE()) === SET_REPORT_BOUNDARIES_ROLE)
    assert((await app.SET_BEACON_REPORT_RECEIVER_ROLE()) === SET_BEACON_REPORT_RECEIVER_ROLE)
  })

  it('beaconSpec is correct', async () => {
    const beaconSpec = await app.getBeaconSpec()
    assertBn(beaconSpec.epochsPerFrame, 1)
    assertBn(beaconSpec.slotsPerEpoch, 32)
    assertBn(beaconSpec.secondsPerSlot, 12)
    assertBn(beaconSpec.genesisTime, GENESIS_TIME)
  })

  it('setBeaconSpec works', async () => {
    await assertRevertCustomError(app.setBeaconSpec(0, 1, 1, 1, { from: voting }), 'BadEpochsPerFrame')
    await assertRevertCustomError(app.setBeaconSpec(1, 0, 1, 1, { from: voting }), 'BadSlotsPerEpoch')
    await assertRevertCustomError(app.setBeaconSpec(1, 1, 0, 1, { from: voting }), 'BadSecondsPerSlot')
    await assertRevertCustomError(app.setBeaconSpec(1, 1, 1, 0, { from: voting }), 'BadGenesisTime')

    const receipt = await app.setBeaconSpec(1, 1, 1, 1, { from: voting })
    assertEvent(receipt, 'BeaconSpecSet', {
      expectedArgs: {
        epochsPerFrame: 1,
        slotsPerEpoch: 1,
        secondsPerSlot: 1,
        genesisTime: 1
      }
    })
    const beaconSpec = await app.getBeaconSpec()
    assertBn(beaconSpec.epochsPerFrame, 1)
    assertBn(beaconSpec.slotsPerEpoch, 1)
    assertBn(beaconSpec.secondsPerSlot, 1)
    assertBn(beaconSpec.genesisTime, 1)
  })

  describe('Test utility functions:', function () {
    this.timeout(60000) // addOracleMember edge-case is heavy on execution time

    beforeEach(async () => {
      await app.setTime(GENESIS_TIME)
    })

    it('addOracleMember works', async () => {
      await assertRevert(app.addOracleMember(user1, { from: user1 }), getAuthError(user1, MANAGE_MEMBERS_ROLE))
      await assertRevertCustomError(
        app.addOracleMember('0x0000000000000000000000000000000000000000', { from: voting }),
        'ZeroMemberAddress'
      )

      await app.addOracleMember(user1, { from: voting })
      await assertRevert(app.addOracleMember(user2, { from: user2 }), getAuthError(user2, MANAGE_MEMBERS_ROLE))
      await assertRevert(app.addOracleMember(user3, { from: user2 }), getAuthError(user2, MANAGE_MEMBERS_ROLE))

      await app.addOracleMember(user2, { from: voting })
      await app.addOracleMember(user3, { from: voting })

      await assertRevertCustomError(app.addOracleMember(user1, { from: voting }), 'MemberExists')
      await assertRevertCustomError(app.addOracleMember(user2, { from: voting }), 'MemberExists')
    })

    it('addOracleMember edge-case', async () => {
      const promises = []
      const maxMembersCount = await app.MAX_MEMBERS()
      for (let i = 0; i < maxMembersCount; ++i) {
        const addr = '0x' + keccak256('member' + i).substring(0, 40)
        promises.push(app.addOracleMember(addr, { from: voting }))
      }
      await Promise.all(promises)

      assertRevertCustomError(app.addOracleMember(user4, { from: voting }), 'TooManyMembers')
    })

    it('removeOracleMember works', async () => {
      await app.addOracleMember(user1, { from: voting })

      await assertRevert(app.removeOracleMember(user1, { from: user1 }), getAuthError(user1, MANAGE_MEMBERS_ROLE))
      await app.removeOracleMember(user1, { from: voting })
      assert.deepStrictEqual(await app.getOracleMembers(), [])

      await app.addOracleMember(user1, { from: voting })
      await app.addOracleMember(user2, { from: voting })
      await app.addOracleMember(user3, { from: voting })

      await assertRevertCustomError(app.removeOracleMember(nobody, { from: voting }), 'MemberNotFound')

      await app.removeOracleMember(user1, { from: voting })
      await app.removeOracleMember(user2, { from: voting })

      await assertRevert(app.removeOracleMember(user2, { from: user1 }), getAuthError(user1, MANAGE_MEMBERS_ROLE))
      assert.deepStrictEqual(await app.getOracleMembers(), [user3])
    })

    it('updateQuorum works', async () => {
      await app.addOracleMember(user1, { from: voting })
      await app.addOracleMember(user2, { from: voting })
      await app.addOracleMember(user3, { from: voting })

      await assertRevert(app.updateQuorum(2, { from: user1 }), getAuthError(user1, MANAGE_QUORUM_ROLE))
      await assertRevertCustomError(app.updateQuorum(0, { from: voting }), 'QuorumWontBeMade')
      await app.updateQuorum(4, { from: voting })
      assertBn(await app.getQuorum(), 4)

      await app.updateQuorum(3, { from: voting })
      assertBn(await app.getQuorum(), 3)
    })

    it.skip('updateQuorum updates expectedEpochId and tries to push', async () => {
      await app.addOracleMember(user1, { from: voting })
      await app.addOracleMember(user2, { from: voting })
      await app.addOracleMember(user3, { from: voting })

      await app.updateQuorum(4, { from: voting })

      await appLido.pretendTotalPooledEtherGweiForTest(32)

      const report31Gwei = { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 31 }
      const report32Gwei = { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 }
      const report31GweiHash = await calcReportHash(report31Gwei)
      const report32GweiHash = await calcReportHash(report32Gwei)
      await app.handleCommitteeMemberReport(1, report31GweiHash, { from: user1 })
      await app.handleCommitteeMemberReport(1, report32GweiHash, { from: user2 })
      await app.handleCommitteeMemberReport(1, report32GweiHash, { from: user3 })

      await assertExpectedEpochs(1, 0)

      await app.updateQuorum(3, { from: voting })
      await assertExpectedEpochs(1, 0)

      const receipt = await app.updateQuorum(2, { from: voting })
      // TODO: fix event and epoch checks
      // assertEvent(receipt, 'ConsensusReached', {
      //   expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 }
      // })
      // await assertExpectedEpochs(2, 0)

      await app.handleReportData(report32Gwei, { from: nobody })
    })

    it('getOracleMembers works', async () => {
      await app.addOracleMember(user1, { from: voting })
      await app.addOracleMember(user2, { from: voting })
      await app.addOracleMember(user3, { from: voting })

      assert.deepStrictEqual(await app.getOracleMembers(), [user1, user2, user3])

      await app.removeOracleMember(user1, { from: voting })

      assert.deepStrictEqual(await app.getOracleMembers(), [user3, user2])
    })

    it('getCurrentEpochId works', async () => {
      assertBn(await app.getCurrentEpochId(), 0)
      await app.setTime(GENESIS_TIME + EPOCH_LENGTH - 1)
      assertBn(await app.getCurrentEpochId(), 0)
      await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 123 + 1)
      assertBn(await app.getCurrentEpochId(), 123)
    })

    it.skip('getExpectedEpochId and getLastCompletedEpochId work', async () => {
      assertBn(await app.getExpectedEpochId(), 1)
      assertBn(await app.getLastCompletedEpochId(), 0)

      await app.setTime(GENESIS_TIME + EPOCH_LENGTH - 1)
      assertBn(await app.getExpectedEpochId(), 1)

      await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 123 + 1)
      await app.updateQuorum(1, { from: voting })
      await app.addOracleMember(user1, { from: voting })
      await doHashAndDataReport(123, 1, 32, user1)

      assertBn(await app.getExpectedEpochId(), 124)
      assertBn(await app.getLastCompletedEpochId(), 123)
    })

    it('getCurrentFrame works', async () => {
      await app.setBeaconSpec(10, 32, 12, GENESIS_TIME, { from: voting })

      let result = await app.getCurrentFrame()
      assertBn(result.frameEpochId, 0)
      assertBn(result.frameStartTime, GENESIS_TIME)
      assertBn(result.frameEndTime, GENESIS_TIME + EPOCH_LENGTH * 10 - 1)

      await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 10 - 1)
      result = await app.getCurrentFrame()
      assertBn(result.frameEpochId, 0)
      assertBn(result.frameStartTime, GENESIS_TIME)
      assertBn(result.frameEndTime, GENESIS_TIME + EPOCH_LENGTH * 10 - 1)

      await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 123)
      result = await app.getCurrentFrame()
      assertBn(result.frameEpochId, 120)
      assertBn(result.frameStartTime, GENESIS_TIME + EPOCH_LENGTH * 120)
      assertBn(result.frameEndTime, GENESIS_TIME + EPOCH_LENGTH * 130 - 1)
    })
  })

  describe('When there is single-member setup', function () {
    describe('current epoch: 1', function () {
      beforeEach(async () => {
        await app.setTime(GENESIS_TIME)
        await app.addOracleMember(user1, { from: voting })
        await appLido.pretendTotalPooledEtherGweiForTest(START_BALANCE)
      })

      it.skip('if given old eth1 denominated balances just truncates them to 64 bits', async () => {
        const BALANCE = toBN('183216444408705000000000')
        const INT64_MASK = toBN('0xFFFFFFFFFFFFFFFF')
        const BALANCE_TRUNCATED64_GWEI = BALANCE.and(INT64_MASK)
        const BALANCE_TRUNCATED64_WEI = BALANCE_TRUNCATED64_GWEI.mul(toBN(DENOMINATION_OFFSET))
        await appLido.pretendTotalPooledEtherGweiForTest(BALANCE_TRUNCATED64_GWEI)

        // const receipt = await app.handleCommitteeMemberReport(
        //   { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 5692, beaconBalanceGwei: BALANCE.toString(10) },
        //   { from: user1 }
        // )
        const receipt = await doHashAndDataReport(1, 5692, BALANCE.toString(10), user1)

        // TODO: restore events check
        // assertEvent(receipt, 'CommitteeMemberReported', {
        //   expectedArgs: {
        //     epochId: 1,
        //     beaconBalance: BALANCE_TRUNCATED64_WEI,
        //     beaconValidators: 5692,
        //     caller: user1
        //   }
        // })
      })

      it.skip('accepts new eth2 denominated balances, no trunc', async () => {
        const BALANCE_GWEI = toBN('183216444408705')
        const BALANCE_WEI = BALANCE_GWEI.mul(toBN(DENOMINATION_OFFSET))
        await appLido.pretendTotalPooledEtherGweiForTest(BALANCE_GWEI)
        const receipt = await doHashReport(1, 5692, BALANCE_GWEI.toString(10), user1)
        // TODO: fix event check
        // assertEvent(receipt, 'CommitteeMemberReported', {
        //   expectedArgs: { epochId: 1, beaconBalance: BALANCE_WEI, beaconValidators: 5692, caller: user1 }
        // })
      })

      it.skip('reverts when trying to report from non-member', async () => {
        for (const account of [user2, user3, user4, nobody]) {
          await assertRevertCustomError(
            doHashReport(1, 1, 32, account) , 'NotMemberReported'
          )
        }
      })

      it.skip('handleCommitteeMemberReport works and emits event, getLastCompletedReportDelta tracks last 2 reports', async () => {
        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 1) // 1 epoch later
        const prePooledEther = START_BALANCE + 32
        let receipt = await doHashAndDataReport(1, 1, prePooledEther, user1)

        // TODO: fix event checks
        // assertEvent(receipt, 'ConsensusReached', {
        //   expectedArgs: { epochId: 1, beaconBalance: prePooledEther * DENOMINATION_OFFSET, beaconValidators: 1 }
        // })
        assertEvent(receipt, 'PostTotalShares', {
          expectedArgs: {
            postTotalPooledEther: prePooledEther * DENOMINATION_OFFSET,
            preTotalPooledEther: START_BALANCE * DENOMINATION_OFFSET,
            timeElapsed: EPOCH_LENGTH * 1,
            totalShares: 42
          }
        })
        await assertExpectedEpochs(2, 1)

        let res = await app.getLastCompletedReportDelta()
        assertBn(res.postTotalPooledEther, toBN(prePooledEther).mul(toBN(DENOMINATION_OFFSET)))
        assertBn(res.preTotalPooledEther, toBN(START_BALANCE).mul(toBN(DENOMINATION_OFFSET)))
        assertBn(res.timeElapsed, EPOCH_LENGTH * 1)

        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 3) // 2 epochs later
        const postPooledEther = prePooledEther + 99
        receipt = await doHashAndDataReport(3, 3, postPooledEther, user1)
        // TODO: fix event checks
        // assertEvent(receipt, 'ConsensusReached', {
        //   expectedArgs: { epochId: 3, beaconBalance: postPooledEther * DENOMINATION_OFFSET, beaconValidators: 3 }
        // })
        assertEvent(receipt, 'PostTotalShares', {
          expectedArgs: {
            postTotalPooledEther: postPooledEther * DENOMINATION_OFFSET,
            preTotalPooledEther: prePooledEther * DENOMINATION_OFFSET,
            timeElapsed: EPOCH_LENGTH * 2,
            totalShares: 42
          }
        })
        await assertExpectedEpochs(4, 3)

        res = await app.getLastCompletedReportDelta()
        assertBn(res.postTotalPooledEther, toBN(postPooledEther).mul(toBN(DENOMINATION_OFFSET)))
        assertBn(res.preTotalPooledEther, toBN(prePooledEther).mul(toBN(DENOMINATION_OFFSET)))
        assertBn(res.timeElapsed, EPOCH_LENGTH * 2)
      })

      it.skip('handleCommitteeMemberReport works OK on OK pooledEther increase', async () => {
        const beginPooledEther = START_BALANCE
        let receipt = await doHashAndDataReport(1, 1, beginPooledEther, user1)
        // TODO: fix event checks
        // assertEvent(receipt, 'ConsensusReached', {
        //   expectedArgs: { epochId: 1, beaconBalance: beginPooledEther * DENOMINATION_OFFSET, beaconValidators: 1 }
        // })
        await assertExpectedEpochs(2, 0)

        const reward = Math.round((START_BALANCE * (768 / 365 / 24 / 3600) * 9) / 100) // annual increase by 9%
        const nextPooledEther = beginPooledEther + reward
        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 3) // 2 epochs later (timeElapsed = 768)
        receipt = await doHashAndDataReport(3, 3, nextPooledEther, user1)
        // TODO: fix event checks
        // assertEvent(receipt, 'ConsensusReached', {
        //   expectedArgs: { epochId: 3, beaconBalance: nextPooledEther * DENOMINATION_OFFSET, beaconValidators: 3 }
        // })
      })

      it.skip('handleCommitteeMemberReport reverts on too high pooledEther increase', async () => {
        const beginPooledEther = START_BALANCE
        const receipt = await doHashAndDataReport(1, 1, beginPooledEther, user1)
        // TODO: fix event checks
        // assertEvent(receipt, 'ConsensusReached', {
        //   expectedArgs: { epochId: 1, beaconBalance: beginPooledEther * DENOMINATION_OFFSET, beaconValidators: 1 }
        // })
        await assertExpectedEpochs(2, 0)

        const reward = Math.round((START_BALANCE * (768 / 365 / 24 / 3600) * 11) / 100) // annual increase by 11%
        const nextPooledEther = beginPooledEther + reward
        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 3) // 2 epochs later (timeElapsed = 768)
        await assertRevertCustomError(
          doHashAndDataReport(3, 3, nextPooledEther, user1),
          'AllowedBeaconBalanceIncreaseExceeded'
        )
      })

      it.skip('handleCommitteeMemberReport works OK on OK pooledEther decrease', async () => {
        const beginPooledEther = START_BALANCE
        let receipt = await doHashAndDataReport(1, 1, beginPooledEther, user1)
        // assertEvent(receipt, 'ConsensusReached', {
        //   expectedArgs: { epochId: 1, beaconBalance: beginPooledEther * DENOMINATION_OFFSET, beaconValidators: 1 }
        // })
        await assertExpectedEpochs(2, 0)

        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 3) // 2 epochs later (timeElapsed = 768)
        const loss = Math.round((START_BALANCE * 4) / 100) // decrease by 4%
        const nextPooledEther = beginPooledEther - loss

        receipt = await doHashAndDataReport(3, 3, nextPooledEther, user1)
        // assertEvent(receipt, 'ConsensusReached', {
        //   expectedArgs: { epochId: 3, beaconBalance: nextPooledEther * DENOMINATION_OFFSET, beaconValidators: 3 }
        // })
      })

      it('handleCommitteeMemberReport reverts on too high pooledEther decrease', async () => {
        const beginPooledEther = START_BALANCE
        const receipt = await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: beginPooledEther },
          { from: user1 }
        )
        assertEvent(receipt, 'ConsensusReached', {
          expectedArgs: { epochId: 1, beaconBalance: beginPooledEther * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
        await assertExpectedEpochs(2, 0)

        const loss = Math.round((START_BALANCE * 6) / 100) // decrease by 6%
        const nextPooledEther = beginPooledEther - loss
        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 3) // 2 epochs later (timeElapsed = 768)
        await assertRevertCustomError(
          app.handleCommitteeMemberReport(
            { ...ZERO_MEMBER_REPORT, epochId: 3, beaconValidators: 3, beaconBalanceGwei: nextPooledEther },
            { from: user1 }
          ),
          'AllowedBeaconBalanceDecreaseExceeded'
        )
      })

      it('handleCommitteeMemberReport change increase limit works', async () => {
        let res = await app.setAllowedBeaconBalanceAnnualRelativeIncrease(42, { from: voting })
        assertEvent(res, 'AllowedBeaconBalanceAnnualRelativeIncreaseSet', { expectedArgs: { value: 42 } })
        let limit = await app.getAllowedBeaconBalanceAnnualRelativeIncrease()
        assertBn(limit, 42)

        res = await app.setAllowedBeaconBalanceAnnualRelativeIncrease(777, { from: voting })
        assertEvent(res, 'AllowedBeaconBalanceAnnualRelativeIncreaseSet', { expectedArgs: { value: 777 } })
        limit = await app.getAllowedBeaconBalanceAnnualRelativeIncrease()
        assertBn(limit, 777)
      })

      it('handleCommitteeMemberReport change decrease limit works', async () => {
        let res = await app.setAllowedBeaconBalanceRelativeDecrease(42, { from: voting })
        assertEvent(res, 'AllowedBeaconBalanceRelativeDecreaseSet', { expectedArgs: { value: 42 } })
        let limit = await app.getAllowedBeaconBalanceRelativeDecrease()
        assertBn(limit, 42)

        res = await app.setAllowedBeaconBalanceRelativeDecrease(777, { from: voting })
        assertEvent(res, 'AllowedBeaconBalanceRelativeDecreaseSet', { expectedArgs: { value: 777 } })
        limit = await app.getAllowedBeaconBalanceRelativeDecrease()
        assertBn(limit, 777)
      })

      it.skip('handleCommitteeMemberReport change increase limit affect sanity checks', async () => {
        const beginPooledEther = START_BALANCE
        const receipt = await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: beginPooledEther },
          { from: user1 }
        )
        assertEvent(receipt, 'ConsensusReached', {
          expectedArgs: { epochId: 1, beaconBalance: beginPooledEther * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
        await assertExpectedEpochs(2, 0)

        const reward = Math.round((START_BALANCE * (768 / 365 / 24 / 3600) * 11) / 100) // annual increase by 11%
        const nextPooledEther = beginPooledEther + reward
        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 3) // 2 epochs later (timeElapsed = 768)

        // check fails
        await assertRevertCustomError(
          app.handleCommitteeMemberReport(
            {
              ...ZERO_MEMBER_REPORT,
              epochId: 2,
              beaconValidators: 3,
              beaconBalanceGwei: nextPooledEther
            },
            { from: user1 }
          ),
          'AllowedBeaconBalanceIncreaseExceeded'
        )

        // set limit up to 12%
        const res = await app.setAllowedBeaconBalanceAnnualRelativeIncrease(1200, { from: voting })
        assertEvent(res, 'AllowedBeaconBalanceAnnualRelativeIncreaseSet', { expectedArgs: { value: 1200 } })

        // check OK
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 3, beaconValidators: 3, beaconBalanceGwei: nextPooledEther },
          { from: user1 }
        )
        assertEvent(receipt, 'ConsensusReached', {
          expectedArgs: { epochId: 3, beaconBalance: nextPooledEther * DENOMINATION_OFFSET, beaconValidators: 3 }
        })
      })

      it('handleCommitteeMemberReport change decrease limit affect sanity checks', async () => {
        const beginPooledEther = START_BALANCE
        let receipt = await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: beginPooledEther },
          { from: user1 }
        )
        assertEvent(receipt, 'ConsensusReached', {
          expectedArgs: { epochId: 1, beaconBalance: beginPooledEther * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
        await assertExpectedEpochs(2, 0)

        const loss = Math.round((START_BALANCE * 6) / 100) // decrease by 6%
        const nextPooledEther = beginPooledEther - loss
        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 3) // 2 epochs later (timeElapsed = 768)

        // check fails
        await assertRevertCustomError(
          app.handleCommitteeMemberReport(
            { ...ZERO_MEMBER_REPORT, epochId: 3, beaconValidators: 3, beaconBalanceGwei: nextPooledEther },
            { from: user1 }
          ),
          'AllowedBeaconBalanceDecreaseExceeded'
        )

        // set limit up to 7%
        const res = await app.setAllowedBeaconBalanceRelativeDecrease(700, { from: voting })
        assertEvent(res, 'AllowedBeaconBalanceRelativeDecreaseSet', { expectedArgs: { value: 700 } })

        // check OK
        receipt = await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 3, beaconValidators: 3, beaconBalanceGwei: nextPooledEther },
          { from: user1 }
        )
        assertEvent(receipt, 'ConsensusReached', {
          expectedArgs: { epochId: 3, beaconBalance: nextPooledEther * DENOMINATION_OFFSET, beaconValidators: 3 }
        })
      })

      it('handleCommitteeMemberReport time affect increase sanity checks', async () => {
        const beginPooledEther = START_BALANCE
        let receipt = await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: beginPooledEther },
          { from: user1 }
        )
        assertEvent(receipt, 'ConsensusReached', {
          expectedArgs: { epochId: 1, beaconBalance: beginPooledEther * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
        await assertExpectedEpochs(2, 0)

        const reward = Math.round((START_BALANCE * (768 / 365 / 24 / 3600) * 19) / 100) // annual increase by 19%
        const nextPooledEther = beginPooledEther + reward
        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 3) // 2 epochs later (timeElapsed = 768)

        // check fails
        await assertRevertCustomError(
          app.handleCommitteeMemberReport(
            { ...ZERO_MEMBER_REPORT, epochId: 3, beaconValidators: 3, beaconBalanceGwei: nextPooledEther },
            { from: user1 }
          ),
          'AllowedBeaconBalanceIncreaseExceeded'
        )

        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 5) // 4 epochs later (timeElapsed = 768*2)
        // check OK because 4 epochs passed
        receipt = await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 5, beaconValidators: 3, beaconBalanceGwei: nextPooledEther },
          { from: user1 }
        )
        assertEvent(receipt, 'ConsensusReached', {
          expectedArgs: { epochId: 5, beaconBalance: nextPooledEther * DENOMINATION_OFFSET, beaconValidators: 3 }
        })
      })

      it('handleCommitteeMemberReport time does not affect decrease sanity checks', async () => {
        const beginPooledEther = START_BALANCE
        const receipt = await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: beginPooledEther },
          { from: user1 }
        )
        assertEvent(receipt, 'ConsensusReached', {
          expectedArgs: { epochId: 1, beaconBalance: beginPooledEther * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
        await assertExpectedEpochs(2, 0)

        const reward = Math.round(START_BALANCE * (6 / 100)) // annual increase by 6%
        const nextPooledEther = beginPooledEther + reward
        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 3) // 2 epochs later (timeElapsed = 768)

        // check fails
        await assertRevertCustomError(
          app.handleCommitteeMemberReport(
            { ...ZERO_MEMBER_REPORT, epochId: 3, beaconValidators: 3, beaconBalanceGwei: nextPooledEther },
            { from: user1 }
          ),
          'AllowedBeaconBalanceIncreaseExceeded'
        )

        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 5) // 4 epochs later (timeElapsed = 768*2)
        // check fails but 4 epochs passed
        await assertRevertCustomError(
          app.handleCommitteeMemberReport(
            { ...ZERO_MEMBER_REPORT, epochId: 5, beaconValidators: 3, beaconBalanceGwei: nextPooledEther },
            { from: user1 }
          ),
          'AllowedBeaconBalanceIncreaseExceeded'
        )
      })

      it('setBeaconReportReceiver to 0x0', async () => {
        const receipt = await app.setBeaconReportReceiver(ZERO_ADDRESS, { from: voting })
        assertEvent(receipt, 'BeaconReportReceiverSet', { expectedArgs: { callback: ZERO_ADDRESS } })
        assert((await app.getBeaconReportReceiver()) === ZERO_ADDRESS)
      })

      it('setBeaconReportReceiver failed auth', async () => {
        await assertRevert(app.setBeaconReportReceiver(ZERO_ADDRESS, { from: user1 }), getAuthError(user1, SET_BEACON_REPORT_RECEIVER_ROLE))
      })

      it.skip('quorum receiver called with same arguments as getLastCompletedReportDelta', async () => {
        const badMock = await BeaconReportReceiverWithoutERC165.new()
        await assertRevertCustomError(app.setBeaconReportReceiver(badMock.address, { from: voting }), 'BadBeaconReportReceiver')

        const mock = await BeaconReportReceiver.new()
        let receipt = await app.setBeaconReportReceiver(mock.address, { from: voting })
        assertEvent(receipt, 'BeaconReportReceiverSet', { expectedArgs: { callback: mock.address } })
        assert((await app.getBeaconReportReceiver()) === mock.address)

        // receipt = await app.handleCommitteeMemberReport(
        //   { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: START_BALANCE + 35 },
        //   { from: user1 }
        // )
        receipt = doHashAndDataReport(1, 1, START_BALANCE + 35, user1)
        // assertEvent(receipt, 'ConsensusReached', {
        //   expectedArgs: { epochId: 1, beaconBalance: (START_BALANCE + 35) * DENOMINATION_OFFSET, beaconValidators: 1 }
        // })
        // await assertExpectedEpochs(2, 0)

        await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 2) // 1 epochs later
        // receipt = await app.handleCommitteeMemberReport(
        //   { ...ZERO_MEMBER_REPORT, epochId: 2, beaconValidators: 3, beaconBalanceGwei: START_BALANCE + 77 },
        //   { from: user1 }
        // )
        receipt = doHashAndDataReport(2, 3, START_BALANCE + 77, user1)
        // assertEvent(receipt, 'ConsensusReached', {
        //   expectedArgs: { epochId: 2, beaconBalance: (START_BALANCE + 77) * DENOMINATION_OFFSET, beaconValidators: 3 }
        // })
        // await assertExpectedEpochs(3, 2)

        assertBn(await mock.postTotalPooledEther(), toBN(START_BALANCE + 77).mul(toBN(DENOMINATION_OFFSET)))
        assertBn(await mock.preTotalPooledEther(), toBN(START_BALANCE + 35).mul(toBN(DENOMINATION_OFFSET)))
        assertBn(await mock.timeElapsed(), EPOCH_LENGTH)

        const res = await app.getLastCompletedReportDelta()
        assertBn(res.postTotalPooledEther, toBN(START_BALANCE + 77).mul(toBN(DENOMINATION_OFFSET)))
        assertBn(res.preTotalPooledEther, toBN(START_BALANCE + 35).mul(toBN(DENOMINATION_OFFSET)))
        assertBn(res.timeElapsed, EPOCH_LENGTH)
      })

      it('reverts when trying to report this epoch again', async () => {
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: START_BALANCE },
          { from: user1 }
        ) // got quorum
        await assertExpectedEpochs(2, 0)
        await assertRevertCustomError(
          app.handleCommitteeMemberReport(
            { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: START_BALANCE },
            { from: user1 }
          ),
          'EpochIsTooOld'
        )
      })

      it('reverts when trying to report future epoch', async () => {
        await assertRevertCustomError(
          app.handleCommitteeMemberReport(
            { ...ZERO_MEMBER_REPORT, epochId: 2, beaconValidators: 1, beaconBalanceGwei: 32 },
            { from: user1 }
          ),
          'UnexpectedEpoch'
        )
      })

      describe(`current epoch: 5`, function () {
        beforeEach(async () => {
          await appLido.pretendTotalPooledEtherGweiForTest(32)
          await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 5)
          await assertExpectedEpochs(1, 5)
        })

        it('reverts when trying to report stale epoch', async () => {
          await assertRevertCustomError(
            app.handleCommitteeMemberReport(
              { ...ZERO_MEMBER_REPORT, epochId: 0, beaconValidators: 1, beaconBalanceGwei: 32 },
              { from: user1 }
            ),
            'EpochIsTooOld'
          )
          await assertExpectedEpochs(1, 5)
        })

        it('reverts when trying to report this epoch again from the same user', async () => {
          await app.updateQuorum(2, { from: voting })
          await app.handleCommitteeMemberReport(
            { ...ZERO_MEMBER_REPORT, epochId: 5, beaconValidators: 1, beaconBalanceGwei: 32 },
            { from: user1 }
          )
          await assertRevertCustomError(
            app.handleCommitteeMemberReport(
              { ...ZERO_MEMBER_REPORT, epochId: 5, beaconValidators: 1, beaconBalanceGwei: 32 },
              { from: user1 }
            ),
            'MemberAlreadyReported'
          )
          await assertExpectedEpochs(5, 5)
        })

        it('reverts when trying to report future epoch', async () => {
          await assertRevertCustomError(
            app.handleCommitteeMemberReport(
              { ...ZERO_MEMBER_REPORT, epochId: 10, beaconValidators: 1, beaconBalanceGwei: 32 },
              { from: user1 }
            ),
            'UnexpectedEpoch'
          )
        })

        it('handleCommitteeMemberReport works and emits event', async () => {
          const receipt = await app.handleCommitteeMemberReport(
            { ...ZERO_MEMBER_REPORT, epochId: 5, beaconValidators: 1, beaconBalanceGwei: 32 },
            { from: user1 }
          )
          assertEvent(receipt, 'ConsensusReached', {
            expectedArgs: { epochId: 5, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 }
          })
          await assertExpectedEpochs(6, 5)
        })
      })
    })
  })
  describe('When there is multi-member setup (7 members, default quorum is 7)', function () {
    beforeEach(async () => {
      await app.setTime(GENESIS_TIME + EPOCH_LENGTH * 1)
      await assertExpectedEpochs(1, 1)
      for (const account of [user1, user2, user3, user4, user5, user6, user7]) {
        await app.addOracleMember(account, { from: voting })
      }
      await app.updateQuorum(7, { from: voting })
    })

    it('removeOracleMember updates expectedEpochId and clears current reporting', async () => {
      await app.handleCommitteeMemberReport(
        { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 0, beaconBalanceGwei: 0 },
        { from: user1 }
      )
      await app.handleCommitteeMemberReport(
        { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
        { from: user2 }
      )
      await assertExpectedEpochs(1, 1)
      assertBn(await app.getCurrentOraclesReportStatus(), 0b011)
      assertBn(await app.getDistinctMemberReportsCount(), 2)

      await app.removeOracleMember(user1, { from: voting })
      await assertExpectedEpochs(1, 1)
      assertBn(await app.getCurrentOraclesReportStatus(), 0b000)
      assertBn(await app.getDistinctMemberReportsCount(), 0)

      // user2 reports again the same epoch
      await app.handleCommitteeMemberReport(
        { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
        { from: user2 }
      )
      await assertExpectedEpochs(1, 1)
      assertBn(await app.getCurrentOraclesReportStatus(), 0b010)
      assertBn(await app.getDistinctMemberReportsCount(), 1)
    })

    it('getCurrentOraclesReportStatus/VariantSize/Variant', async () => {
      assertBn(await app.getCurrentOraclesReportStatus(), 0b000)
      assertBn(await app.getDistinctMemberReportsCount(), 0)

      await app.handleCommitteeMemberReport(
        { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
        { from: user1 }
      )
      assertBn(await app.getCurrentOraclesReportStatus(), 0b001)
      assertBn(await app.getDistinctMemberReportsCount(), 1)

      await app.handleCommitteeMemberReport(
        { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 11, beaconBalanceGwei: 101 },
        { from: user2 }
      )
      assertBn(await app.getCurrentOraclesReportStatus(), 0b011)
      assertBn(await app.getDistinctMemberReportsCount(), 2)

      await app.handleCommitteeMemberReport(
        { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
        { from: user3 }
      )
      assertBn(await app.getCurrentOraclesReportStatus(), 0b111)
      assertBn(await app.getDistinctMemberReportsCount(), 2)

      const firstKind = await app.getMemberReport(0)

      assertBn(firstKind.beaconBalanceGwei, 32)
      assertBn(firstKind.beaconValidators, 1)
      // TODO: restore the check somehow
      // assertBn(firstKind.count, 2)
      const secondKind = await app.getMemberReport(1)
      assertBn(secondKind.beaconBalanceGwei, 101)
      assertBn(secondKind.beaconValidators, 11)
      // assertBn(secondKind.count, 1)

      // TODO: fix the check
      const receipt = await app.updateQuorum(2, { from: voting })
      // assertEvent(receipt, 'ConsensusReached', { expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 } })
      // assertBn(await app.getCurrentOraclesReportStatus(), 0b000)
      // assertBn(await app.getDistinctMemberReportsCount(), 0)
    })

    describe('handleCommitteeMemberReport reaches quorum', function () {
      it.skip('handleCommitteeMemberReport works and emits event', async () => {
        for (const acc of [user1, user2, user3, user4, user5, user6]) {
          const receipt = doHashReport(1, 1, 32, acc)
          // const receipt = await app.handleCommitteeMemberReport(
          //   { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
          //   { from: acc }
          // )
          await assertExpectedEpochs(1, 1)
          // assertEvent(receipt, 'CommitteeMemberReported', {
          //   expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1, caller: acc }
          // })
        }

        const receipt = doHashReport(1, 1, 32, user7)

        // console.log({
        //   'hashes-1': (await app.distinctReportHashes(1)).toString(),
        //   'counters-1': (await app.distinctReportCounters(1).toString(),
        // })
        // const receipt = await app.handleCommitteeMemberReport(
        //   { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
        //   { from: user7 }
        // )
        // assertEvent(receipt, 'CommitteeMemberReported', {
        //   expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1, caller: user7 }
        // })
        // assertEvent(receipt, 'CommitteeMemberReported')
        // assertEvent(receipt, 'ConsensusReached', {
        //   expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 }
        // })
      })

      it('reverts when trying to report this epoch again', async () => {
        for (const account of [user1, user2, user3, user4, user5, user6]) {
          await app.handleCommitteeMemberReport(
            { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
            { from: account }
          )
        }
        await assertExpectedEpochs(1, 1)

        for (const account of [user1, user2, user3, user4, user5, user6]) {
          await assertRevertCustomError(
            app.handleCommitteeMemberReport(
              { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
              { from: account }
            ),
            'MemberAlreadyReported'
          )
        }
        await assertExpectedEpochs(1, 1)
      })

      it('6 oracles push alike, 1 miss', async () => {
        for (const acc of [user1, user2, user3, user4, user5, user6]) {
          await app.handleCommitteeMemberReport(
            { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
            { from: acc }
          )
          await assertExpectedEpochs(1, 1)
        }

        const receipt = await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
          { from: user7 }
        )
        assertEvent(receipt, 'ConsensusReached', {
          expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
      })

      it('oracles part 3+3, no quorum for 4', async () => {
        await app.updateQuorum(4, { from: voting })
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 2, beaconBalanceGwei: 64 },
          { from: user1 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 2, beaconBalanceGwei: 64 },
          { from: user2 }
        )

        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 3, beaconBalanceGwei: 65 },
          { from: user3 }
        )

        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 3, beaconBalanceGwei: 65 },
          { from: user4 }
        )

        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 2, beaconBalanceGwei: 64 },
          { from: user5 }
        )

        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 3, beaconBalanceGwei: 65 },
          { from: user6 }
        )

        await assertExpectedEpochs(1, 1)
      })

      it('oracles part 3+3, got quorum for 3', async () => {
        await app.updateQuorum(3, { from: voting })
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 2, beaconBalanceGwei: 64 },
          { from: user1 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
          { from: user2 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
          { from: user3 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 2, beaconBalanceGwei: 64 },
          { from: user4 }
        )
        await assertExpectedEpochs(1, 1)
        const receipt = await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
          { from: user5 }
        )
        assertEvent(receipt, 'ConsensusReached', {
          expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
      })

      it('oracles part 4+3, got quorum for 4', async () => {
        await app.updateQuorum(4, { from: voting })
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
          { from: user1 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
          { from: user2 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
          { from: user3 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 3, beaconBalanceGwei: 65 },
          { from: user4 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 3, beaconBalanceGwei: 65 },
          { from: user5 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 3, beaconBalanceGwei: 65 },
          { from: user6 }
        )
        await assertExpectedEpochs(1, 1)
        const receipt = await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
          { from: user7 }
        )
        assertEvent(receipt, 'ConsensusReached', {
          expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
      })

      it('oracles part 5+2, got quorum for 5', async () => {
        await app.updateQuorum(5, { from: voting })
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 2, beaconBalanceGwei: 65 },
          { from: user1 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
          { from: user2 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
          { from: user3 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
          { from: user4 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 3, beaconBalanceGwei: 65 },
          { from: user5 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
          { from: user6 }
        )
        await assertExpectedEpochs(1, 1)
        const receipt = await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
          { from: user7 }
        )
        assertEvent(receipt, 'ConsensusReached', {
          expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
      })

      it('only 1 report is enough in quorum l1', async () => {
        await app.updateQuorum(1, { from: voting })
        const receipt = await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
          { from: user1 }
        )
        assertEvent(receipt, 'ConsensusReached', {
          expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
      })

      it('only 2 alike report is enough in quorum 2', async () => {
        await app.updateQuorum(2, { from: voting })
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
          { from: user1 }
        )
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 2, beaconBalanceGwei: 33 },
          { from: user2 }
        )
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 3, beaconBalanceGwei: 34 },
          { from: user3 }
        )
        await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 0, beaconBalanceGwei: 0 },
          { from: user4 }
        )
        const receipt = await app.handleCommitteeMemberReport(
          { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
          { from: user5 }
        )
        assertEvent(receipt, 'ConsensusReached', {
          expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
      })
    })
    describe('updateQuorum lowering reaches quorum', function () {
      it('6 oracles push alike, 1 miss', async () => {
        for (const acc of [user1, user2, user3, user4, user5, user6]) {
          await app.handleCommitteeMemberReport(
            { ...ZERO_MEMBER_REPORT, epochId: 1, beaconValidators: 1, beaconBalanceGwei: 32 },
            { from: acc }
          )
          await assertExpectedEpochs(1, 1)
        }

        await app.updateQuorum(8, { from: voting }) // no quorum for 8
        await assertExpectedEpochs(1, 1)

        const receipt = await app.updateQuorum(6, { from: voting })
        assertEvent(receipt, 'ConsensusReached', {
          expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
      })

      it('oracles part 3+3, no quorum here at all', async () => {
        await app.handleCommitteeMemberReport(
          {
            ...ZERO_MEMBER_REPORT,
            epochId: 1,
            beaconValidators: 2,
            beaconBalanceGwei: 64
          },
          { from: user1 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          {
            ...ZERO_MEMBER_REPORT,
            epochId: 1,
            beaconValidators: 2,
            beaconBalanceGwei: 64
          },
          { from: user2 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          {
            ...ZERO_MEMBER_REPORT,
            epochId: 1,
            beaconValidators: 2,
            beaconBalanceGwei: 64
          },
          { from: user3 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          {
            ...ZERO_MEMBER_REPORT,
            epochId: 1,
            beaconValidators: 3,
            beaconBalanceGwei: 65
          },
          { from: user4 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          {
            ...ZERO_MEMBER_REPORT,
            epochId: 1,
            beaconValidators: 3,
            beaconBalanceGwei: 65
          },
          { from: user5 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          {
            ...ZERO_MEMBER_REPORT,
            epochId: 1,
            beaconValidators: 3,
            beaconBalanceGwei: 65
          },
          { from: user6 }
        )
        await assertExpectedEpochs(1, 1)

        // decreasing quorum does not help because conflicting parts are equal
        await app.updateQuorum(3, { from: voting })
        await assertExpectedEpochs(1, 1)
        await app.updateQuorum(1, { from: voting })
        await assertExpectedEpochs(1, 1)
      })

      it('oracles part 4+3, quorum lowers to 4', async () => {
        await app.handleCommitteeMemberReport(
          {
            ...ZERO_MEMBER_REPORT,
            epochId: 1,
            beaconValidators: 1,
            beaconBalanceGwei: 32
          },
          { from: user1 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          {
            ...ZERO_MEMBER_REPORT,
            epochId: 1,
            beaconValidators: 1,
            beaconBalanceGwei: 32
          },
          { from: user2 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          {
            ...ZERO_MEMBER_REPORT,
            epochId: 1,
            beaconValidators: 1,
            beaconBalanceGwei: 32
          },
          { from: user3 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          {
            ...ZERO_MEMBER_REPORT,
            epochId: 1,
            beaconValidators: 3,
            beaconBalanceGwei: 65
          },
          { from: user4 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          {
            ...ZERO_MEMBER_REPORT,
            epochId: 1,
            beaconValidators: 3,
            beaconBalanceGwei: 65
          },
          { from: user5 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          {
            ...ZERO_MEMBER_REPORT,
            epochId: 1,
            beaconValidators: 3,
            beaconBalanceGwei: 65
          },
          { from: user6 }
        )
        await assertExpectedEpochs(1, 1)
        await app.handleCommitteeMemberReport(
          {
            ...ZERO_MEMBER_REPORT,
            epochId: 1,
            beaconValidators: 1,
            beaconBalanceGwei: 32
          },
          { from: user7 }
        )
        await assertExpectedEpochs(1, 1)

        // decreasing quorum to 5 does not help
        await app.updateQuorum(5, { from: voting })
        await assertExpectedEpochs(1, 1)

        receipt = await app.updateQuorum(4, { from: voting })
        assertEvent(receipt, 'ConsensusReached', {
          expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
      })

      it('only 1 report is enough in quorum lowers to 1', async () => {
        await app.handleCommitteeMemberReport(
          {
            ...ZERO_MEMBER_REPORT,
            epochId: 1,
            beaconValidators: 1,
            beaconBalanceGwei: 32
          },
          { from: user1 }
        )
        await assertExpectedEpochs(1, 1)

        const receipt = await app.updateQuorum(1, { from: voting })
        assertEvent(receipt, 'ConsensusReached', {
          expectedArgs: { epochId: 1, beaconBalance: 32 * DENOMINATION_OFFSET, beaconValidators: 1 }
        })
      })
    })
  })
})
