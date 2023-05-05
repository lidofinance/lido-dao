const { contract, web3 } = require('hardhat')
const { getEvents } = require('@aragon/contract-helpers-test')
const { assert } = require('../helpers/assert')

const signingKeys = require('../helpers/signing-keys')
const { DSMAttestMessage } = require('../helpers/signatures')
const { deployProtocol } = require('../helpers/protocol')
const { setupNodeOperatorsRegistry, NodeOperatorsRegistry } = require('../helpers/staking-modules')
const { e18, e27, toBN, ETH } = require('../helpers/utils')
const { getCurrentBlockTimestamp, advanceChainTime, waitBlocks } = require('../helpers/blockchain')
const {
  getAccountingReportDataItems,
  encodeExtraDataItems,
  packExtraDataList,
  calcExtraDataListHash,
  calcAccountingReportDataHash,
} = require('../0.8.9/oracle/accounting-oracle-deploy.test')

const PENALTY_DELAY = 24 * 60 * 60 // 1 days
const E9 = toBN(10).pow(toBN(9))

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'
const ADDRESS_3 = '0x0000000000000000000000000000000000000003'
const ADDRESS_4 = '0x0000000000000000000000000000000000000004'

const NOR_ABI_GET_EV = { decodeForAbi: NodeOperatorsRegistry._json.abi }
const NOR_ABI_ASSERT_EV = { abi: NodeOperatorsRegistry._json.abi }

const NODE_OPERATORS = [
  {
    id: 0,
    name: 'Node operator #1',
    rewardAddressInitial: ADDRESS_1,
    totalSigningKeysCount: 10,
    vettedSigningKeysCount: 7,
  },
  {
    id: 1,
    name: 'Node operator #2',
    rewardAddressInitial: ADDRESS_2,
    totalSigningKeysCount: 15,
    vettedSigningKeysCount: 10,
  },
  {
    id: 2,
    name: 'Node operator #3',
    rewardAddressInitial: ADDRESS_3,
    totalSigningKeysCount: 10,
    vettedSigningKeysCount: 5,
  },
  {
    id: 3,
    name: 'Node operator #4',
    rewardAddressInitial: ADDRESS_4,
    totalSigningKeysCount: 10,
    vettedSigningKeysCount: 5,
  },
]

const Operator1 = NODE_OPERATORS[0]
const Operator2 = NODE_OPERATORS[1]
const Operator3 = NODE_OPERATORS[2]
const Operator4 = NODE_OPERATORS[3]

const forEachSync = async (arr, cb) => {
  for (let i = 0; i < arr.length; ++i) {
    await cb(arr[i], i)
  }
}

contract('NodeOperatorsRegistry', ([appManager, rewards1, rewards2, rewards3, rewards4, user1, nobody]) => {
  let dsm
  let lido
  let nor
  let stakingRouter
  let depositContract
  let depositRoot
  let voting
  let rewardAddresses
  let guardians
  let withdrawalCredentials
  let consensus
  let oracle
  let consensusVersion
  let signers
  let consensusMember
  let curatedId

  let stateTotalVetted = 0
  let stateTotalDepositable = 0

  /**
   * Helpers
   */

  async function addKeysToOperator(operatorId, keysToAdd) {
    const keys = new signingKeys.FakeValidatorKeys(keysToAdd)
    const operatorBefore = await nor.getNodeOperator(operatorId, true)
    const keysCountBefore = +(await nor.getTotalSigningKeyCount(operatorId))
    const unusedKeysCountBefore = +(await nor.getUnusedSigningKeyCount(operatorId))

    await nor.addSigningKeys(operatorId, keys.count, ...keys.slice(), { from: voting.address })

    const operator = await nor.getNodeOperator(operatorId, true)
    const keysCount = +(await nor.getTotalSigningKeyCount(operatorId))
    const unusedKeysCount = +(await nor.getUnusedSigningKeyCount(operatorId))

    assert.equals(+operatorBefore.totalAddedValidators + keys.count, operator.totalAddedValidators)
    assert.equals(keysCountBefore + keys.count, keysCount)
    assert.equals(unusedKeysCountBefore + keys.count, unusedKeysCount)

    for (let i = 0; i < keys.count; ++i) {
      const { key, depositSignature } = await nor.getSigningKey(operatorId, i + keysCountBefore)
      const [expectedPublicKey, expectedSignature] = keys.get(i)
      assert.equals(key, expectedPublicKey)
      assert.equals(depositSignature, expectedSignature)
    }
  }

  async function setNodeOperatorStakingLimit(operatorId, stakingLimit) {
    const operatorBefore = await nor.getNodeOperator(operatorId, true)
    const summaryBefore = await nor.getNodeOperatorSummary(operatorId)
    const stakingModuleSummaryBefore = await nor.getStakingModuleSummary()

    const tx = await nor.setNodeOperatorStakingLimit(operatorId, stakingLimit, { from: voting.address })

    const operator = await nor.getNodeOperator(operatorId, true)
    const summary = await nor.getNodeOperatorSummary(operatorId)
    const stakingModuleSummary = await nor.getStakingModuleSummary()
    const expectedLimit = +operatorBefore.totalVettedValidators + stakingLimit
    const expectedDepositable = +summaryBefore.depositableValidatorsCount + stakingLimit

    assert.equals(operator.totalVettedValidators, expectedLimit)
    assert.equals(summary.depositableValidatorsCount, expectedDepositable)
    assert.equals(
      +stakingModuleSummaryBefore.depositableValidatorsCount + stakingLimit,
      stakingModuleSummary.depositableValidatorsCount
    )
    assert.emits(
      tx,
      'VettedSigningKeysCountChanged',
      {
        nodeOperatorId: operatorId,
        approvedValidatorsCount: expectedLimit,
      },
      NOR_ABI_ASSERT_EV
    )
  }

  async function assertDepositCall(callIdx, operatorId, keyIdx) {
    const regCall = await depositContract.calls.call(callIdx)
    const { key, depositSignature } = await nor.getSigningKey(operatorId, keyIdx)
    assert.equal(regCall.pubkey, key)
    assert.equal(regCall.signature, depositSignature)
    assert.equal(regCall.withdrawal_credentials, withdrawalCredentials)
    assert.equals(regCall.value, ETH(32))
  }

  async function assertOperatorDeposits(operatorData, deposited, keysLeft) {
    const operator = await nor.getNodeOperator(operatorData.id, true)
    const summary = await nor.getNodeOperatorSummary(operatorData.id)
    assert.equals(
      operator.totalDepositedValidators,
      deposited,
      `${operatorData.name} totalDepositedValidators asserting to ${deposited}`
    )
    assert.equals(
      summary.totalDepositedValidators,
      deposited,
      `${operatorData.name} totalDepositedValidators asserting to ${deposited}`
    )
    assert.equals(
      summary.depositableValidatorsCount,
      keysLeft,
      `${operatorData.name} depositableValidatorsCount asserting to ${keysLeft}`
    )
  }

  async function assertTargetLimit(operatorData, isActive, limit, depositable) {
    const summary = await nor.getNodeOperatorSummary(operatorData.id)
    assert.equals(
      summary.isTargetLimitActive,
      isActive,
      `${operatorData.name} isTargetLimitActive limit asserting to ${isActive}`
    )
    assert.equals(
      summary.targetValidatorsCount,
      limit,
      `${operatorData.name} targetValidatorsCount asserting to ${limit}`
    )
    assert.equals(
      summary.depositableValidatorsCount,
      depositable,
      `${operatorData.name} depositableValidatorsCount asserting to ${depositable}`
    )
  }

  async function assertRewardsDistributedEvent(tx, eventIdx, rewardsAddress, amount) {
    const event = getEvents(tx, 'RewardsDistributed', NOR_ABI_GET_EV)[eventIdx]
    assert.addressEqual(event.args.rewardAddress, rewardsAddress)
    assert.isClose(event.args.sharesAmount, amount, 10)
  }

  async function assertNodeOperatorPenalizedEvent(tx, eventIdx, rewardsAddress, amount) {
    const event = getEvents(tx, 'NodeOperatorPenalized', NOR_ABI_GET_EV)[eventIdx]
    assert.addressEqual(event.args.recipientAddress, rewardsAddress)
    assert.isClose(event.args.sharesPenalizedAmount, amount, 10)
  }

  async function makeDeposit(stakesDeposited) {
    const depositedValue = ETH(32 * stakesDeposited)
    const depositCallCountBefore = +(await depositContract.totalCalls())
    const stakingModuleSummaryBefore = await nor.getStakingModuleSummary()

    await web3.eth.sendTransaction({ to: lido.address, from: user1, value: depositedValue })

    const block = await web3.eth.getBlock('latest')
    const keysOpIndex = await nor.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await dsm.ATTEST_MESSAGE_PREFIX())

    const attest = new DSMAttestMessage(block.number, block.hash, depositRoot, curatedId, keysOpIndex)
    const signatures = [
      attest.sign(guardians.privateKeys[guardians.addresses[0]]),
      attest.sign(guardians.privateKeys[guardians.addresses[1]]),
    ]

    // triggers flow:
    // DSM.depositBufferedEther() -> Lido.deposit() -> StakingRouter.deposit() -> Module.obtainDepositData()
    await dsm.depositBufferedEther(block.number, block.hash, depositRoot, curatedId, keysOpIndex, '0x', signatures)

    const depositCallCount = +(await depositContract.totalCalls())
    const stakingModuleSummary = await nor.getStakingModuleSummary()

    assert.equals(depositCallCount - depositCallCountBefore, stakesDeposited)
    assert.equals(
      +stakingModuleSummaryBefore.depositableValidatorsCount - +stakingModuleSummary.depositableValidatorsCount,
      stakesDeposited
    )
  }

  async function deactivateNodeOperator(operatorId) {
    const operatorBefore = await nor.getNodeOperator(operatorId, true)
    const summaryBefore = await nor.getNodeOperatorSummary(operatorId)
    const activeOperatorsBefore = await nor.getActiveNodeOperatorsCount()
    const stakingModuleSummaryBefore = await nor.getStakingModuleSummary()
    const keysToCut = +summaryBefore.depositableValidatorsCount

    const tx = await nor.deactivateNodeOperator(operatorId, { from: voting.address })

    const operator = await nor.getNodeOperator(operatorId, true)
    const summary = await nor.getNodeOperatorSummary(operatorId)
    const activeOperatorsAfter = await nor.getActiveNodeOperatorsCount()
    const stakingModuleSummary = await nor.getStakingModuleSummary()

    assert.isFalse(operator.active)
    assert.isFalse(await nor.getNodeOperatorIsActive(operatorId))
    assert.equals(+activeOperatorsBefore - 1, +activeOperatorsAfter)
    assert.emits(tx, 'NodeOperatorActiveSet', { nodeOperatorId: operatorId, active: false })
    if (+operatorBefore.totalVettedValidators - +operatorBefore.totalDepositedValidators > 0) {
      assert.emits(tx, 'VettedSigningKeysCountChanged', {
        nodeOperatorId: operatorId,
        approvedValidatorsCount: operator.totalDepositedValidators,
      })
    }
    assert.equals(summary.depositableValidatorsCount, 0)
    assert.equals(operator.totalVettedValidators, operator.totalDepositedValidators)
    assert.equals(
      +stakingModuleSummaryBefore.depositableValidatorsCount - keysToCut,
      stakingModuleSummary.depositableValidatorsCount
    )
  }

  /**
   * Deploy
   */

  before('deploy base app', async () => {
    const deployed = await deployProtocol({
      stakingModulesFactory: async (protocol) => {
        const curatedModule = await setupNodeOperatorsRegistry(protocol)
        return [
          {
            module: curatedModule,
            name: 'Curated',
            targetShares: 10000,
            moduleFee: 500,
            treasuryFee: 500,
          },
        ]
      },
    })

    rewardAddresses = [rewards1, rewards2, rewards3, rewards4]

    lido = deployed.pool
    nor = deployed.stakingModules[0]
    stakingRouter = deployed.stakingRouter
    depositContract = deployed.depositContract
    depositRoot = await depositContract.get_deposit_root()
    dsm = deployed.depositSecurityModule
    guardians = deployed.guardians
    voting = deployed.voting
    consensus = deployed.consensusContract
    oracle = deployed.oracle
    signers = deployed.signers
    consensusMember = signers[2].address
    appManager = deployed.appManager

    consensusVersion = await oracle.getConsensusVersion()
    await consensus.removeMember(signers[4].address, 2, { from: voting.address })
    await consensus.removeMember(signers[3].address, 1, { from: voting.address })

    withdrawalCredentials = '0x'.padEnd(66, '1234')
    await stakingRouter.setWithdrawalCredentials(withdrawalCredentials, { from: voting.address })

    const [curated] = await stakingRouter.getStakingModules()
    curatedId = curated.id
  })

  /**
   * Actual flow
   */

  describe('Happy path', () => {
    context('Initial setup', () => {
      it('Add node operator', async () => {
        await forEachSync(NODE_OPERATORS, async (operatorData, i) => {
          const initialName = `operator ${i + 1}`
          const tx = await nor.addNodeOperator(initialName, operatorData.rewardAddressInitial, { from: voting.address })
          const expectedStakingLimit = 0

          assert.emits(tx, 'NodeOperatorAdded', {
            nodeOperatorId: operatorData.id,
            name: initialName,
            rewardAddress: operatorData.rewardAddressInitial,
            stakingLimit: expectedStakingLimit,
          })

          assert.isTrue(await nor.getNodeOperatorIsActive(operatorData.id))
          const operator = await nor.getNodeOperator(operatorData.id, true)
          assert.isTrue(operator.active)
          assert.equals(operator.name, initialName)
          assert.equals(operator.rewardAddress, operatorData.rewardAddressInitial)
          assert.equals(operator.totalVettedValidators, 0)
          assert.equals(operator.totalExitedValidators, 0)
          assert.equals(operator.totalAddedValidators, 0)
          assert.equals(operator.totalDepositedValidators, 0)
        })

        assert.equals(await nor.getNodeOperatorsCount(), NODE_OPERATORS.length)
      })

      it('Deactivate node operator 4', async () => {
        await deactivateNodeOperator(Operator4.id)
      })

      it('Set name', async () => {
        await forEachSync(NODE_OPERATORS, async (operatorData, i) => {
          await nor.setNodeOperatorName(operatorData.id, operatorData.name, { from: voting.address })
          const operator = await nor.getNodeOperator(operatorData.id, true)
          assert.equals(operator.name, operatorData.name)
        })
      })

      it('Set reward address', async () => {
        await forEachSync(NODE_OPERATORS, async (operatorData, i) => {
          const rewardAddress = rewardAddresses[i]
          await nor.setNodeOperatorRewardAddress(operatorData.id, rewardAddress, { from: voting.address })
          const operator = await nor.getNodeOperator(operatorData.id, true)
          assert.equals(operator.rewardAddress, rewardAddress)
        })
      })

      it('Add signing keys', async () => {
        await forEachSync(NODE_OPERATORS, async (operatorData, i) => {
          await addKeysToOperator(operatorData.id, operatorData.totalSigningKeysCount)
        })
      })

      it('Set staking limit', async () => {
        await forEachSync(NODE_OPERATORS, async (operatorData, i) => {
          if (!(await nor.getNodeOperatorIsActive(operatorData.id))) return
          stateTotalVetted += operatorData.vettedSigningKeysCount
          await setNodeOperatorStakingLimit(operatorData.id, operatorData.vettedSigningKeysCount)
        })

        const stakingModuleSummary = await nor.getStakingModuleSummary()
        assert.equals(stakingModuleSummary.depositableValidatorsCount, stateTotalVetted)
        stateTotalDepositable = stateTotalVetted
      })

      it('Removing key with index less then stakingLimit will trim stakingLimit value to this border', async () => {
        const operatorData = Operator1

        const operatorBefore = await nor.getNodeOperator(operatorData.id, true)
        const summaryBefore = await nor.getNodeOperatorSummary(operatorData.id)
        const keysCountBefore = await nor.getTotalSigningKeyCount(operatorData.id)
        const unusedKeysCountBefore = await nor.getUnusedSigningKeyCount(operatorData.id)
        const keyIdxToRemove = 1
        const keyBefore = await nor.getSigningKey(operatorData.id, keyIdxToRemove)
        assert.equals(operatorBefore.totalVettedValidators, operatorData.vettedSigningKeysCount)

        await nor.removeSigningKey(operatorData.id, keyIdxToRemove, { from: voting.address })

        const operatorAfter = await nor.getNodeOperator(operatorData.id, true)
        const summaryAfter = await nor.getNodeOperatorSummary(operatorData.id)
        const keysCountAfter = await nor.getTotalSigningKeyCount(operatorData.id)
        const unusedKeysCountAfter = await nor.getUnusedSigningKeyCount(operatorData.id)
        const keyAfter = await nor.getSigningKey(operatorData.id, keyIdxToRemove)

        assert.equals(operatorAfter.totalVettedValidators, keyIdxToRemove)
        assert.equals(+operatorBefore.totalAddedValidators - 1, +operatorAfter.totalAddedValidators)
        assert.equals(+keysCountBefore - 1, +keysCountAfter)
        assert.equals(+unusedKeysCountBefore - 1, +unusedKeysCountAfter)
        assert.equals(summaryBefore.depositableValidatorsCount, operatorData.vettedSigningKeysCount)
        assert.equals(summaryAfter.depositableValidatorsCount, keyIdxToRemove)
        assert.notEqual(keyBefore.key, keyAfter.key)
        assert.notEqual(keyBefore.depositSignature, keyAfter.depositSignature)
      })

      it('Set stakingLimit back after key removement', async () => {
        const operatorData = Operator1
        stateTotalVetted += operatorData.vettedSigningKeysCount
        await nor.setNodeOperatorStakingLimit(operatorData.id, operatorData.vettedSigningKeysCount, {
          from: voting.address,
        })
        const summary = await nor.getNodeOperatorSummary(operatorData.id)
        const operator = await nor.getNodeOperator(operatorData.id, true)
        assert.equals(operator.totalVettedValidators, operatorData.vettedSigningKeysCount)
        assert.equals(summary.depositableValidatorsCount, operatorData.vettedSigningKeysCount)
      })

      it('Set target limit to Operator 2', async () => {
        const operatorData = Operator2
        const operatorId = operatorData.id
        const targetLimitCount = 1

        await assertTargetLimit(operatorData, false, 0, operatorData.vettedSigningKeysCount)

        // StakingRouter.updateTargetValidatorsLimits() -> NOR.updateTargetValidatorsLimits()
        const tx = await stakingRouter.updateTargetValidatorsLimits(curatedId, operatorId, true, targetLimitCount, {
          from: voting.address,
        })

        await assertTargetLimit(operatorData, true, targetLimitCount, targetLimitCount)

        assert.emits(
          tx,
          'TargetValidatorsCountChanged',
          { nodeOperatorId: operatorId, targetValidatorsCount: 1 },
          NOR_ABI_ASSERT_EV
        )

        stateTotalDepositable -= operatorData.vettedSigningKeysCount - targetLimitCount
      })

      it('Initial general summary values', async () => {
        const summary = await nor.getStakingModuleSummary()
        assert.equals(summary.totalExitedValidators, 0)
        assert.equals(summary.totalDepositedValidators, 0)
        assert.equals(summary.depositableValidatorsCount, stateTotalDepositable)
      })

      it('Modify penalty delay', async () => {
        const tx = await nor.setStuckPenaltyDelay(PENALTY_DELAY, { from: voting.address })
        assert.emits(tx, 'StuckPenaltyDelayChanged', { stuckPenaltyDelay: PENALTY_DELAY }, NOR_ABI_ASSERT_EV)
        assert.equals(await nor.getStuckPenaltyDelay(), PENALTY_DELAY)
      })
    })

    context('Deposits distribution', () => {
      it('Obtain deposit data', async () => {
        /**
         * Expected deposits fill   1 2 3 4 5 6
         * Operator 1             [ x x x       ]
         * Operator 2 (limit = 1) [       x     ]
         * Operator 3             [         x x ]
         * Operator 4 (inactive)  [             ]
         */

        await makeDeposit(6)

        await assertDepositCall(0, Operator1.id, 0)
        await assertDepositCall(1, Operator1.id, 1)
        await assertDepositCall(2, Operator1.id, 2)
        await assertDepositCall(3, Operator2.id, 0)
        await assertDepositCall(4, Operator3.id, 0)
        await assertDepositCall(5, Operator3.id, 1)

        await assertOperatorDeposits(Operator1, 3, 4)
        await assertOperatorDeposits(Operator2, 1, 0)
        await assertOperatorDeposits(Operator3, 2, 3)
      })

      it('Rewards distribution', async () => {
        const distribution = await nor.getRewardsDistribution(web3.utils.toWei('30'))
        assert.equal(distribution.shares[0], web3.utils.toWei('15'))
        assert.equal(distribution.shares[1], web3.utils.toWei('5'))
        assert.equal(distribution.shares[2], web3.utils.toWei('10'))
        assert.equal(distribution.recipients[0], rewards1)
        assert.equal(distribution.recipients[1], rewards2)
        assert.equal(distribution.recipients[2], rewards3)
      })
    })

    context('Validators exiting and stuck', () => {
      it('Initial rewards state', async () => {
        const sharesNOR = +(await lido.sharesOf(nor.address))
        const sharesRewards1 = +(await lido.sharesOf(rewards1))
        const sharesRewards2 = +(await lido.sharesOf(rewards2))
        const sharesRewards3 = +(await lido.sharesOf(rewards3))
        assert.equals(sharesNOR, 0)
        assert.equals(sharesRewards1, 0)
        assert.equals(sharesRewards2, 0)
        assert.equals(sharesRewards3, 0)
      })

      let reportTx

      it('Consensus+oracle report', async () => {
        const { refSlot } = await consensus.getCurrentFrame()

        const extraData = {
          exitedKeys: [{ moduleId: 1, nodeOpIds: [0], keysCounts: [2] }],
          stuckKeys: [{ moduleId: 1, nodeOpIds: [1, 2], keysCounts: [1, 1] }],
        }

        const extraDataItems = encodeExtraDataItems(extraData)
        const extraDataList = packExtraDataList(extraDataItems)
        const extraDataHash = calcExtraDataListHash(extraDataList)

        const reportFields = {
          consensusVersion,
          numValidators: 6,
          clBalanceGwei: toBN(ETH(32 * 6 + 1)).div(E9),
          stakingModuleIdsWithNewlyExitedValidators: [curatedId],
          numExitedValidatorsByStakingModule: [2],
          withdrawalVaultBalance: e18(0),
          elRewardsVaultBalance: e18(0),
          sharesRequestedToBurn: e18(0),
          withdrawalFinalizationBatches: [],
          simulatedShareRate: e27(1),
          isBunkerMode: false,
          extraDataFormat: 1,
          refSlot: +refSlot,
          extraDataHash,
          extraDataItemsCount: 2,
        }

        const reportItems = getAccountingReportDataItems(reportFields)
        const reportHash = calcAccountingReportDataHash(reportItems)

        await consensus.submitReport(+refSlot, reportHash, consensusVersion, { from: consensusMember })

        // Mentionable internal calls
        // AccountingOracle.submitReportData()
        //      -> Lido.handleOracleReport()._processRewards()._distributeFee()
        //                                                         -> StakingRouter.reportRewardsMinted() -> NOR.onRewardsMinted()
        //                                                         ._transferModuleRewards()._transferShares()
        //      -> StakingRouter.updateExitedValidatorsCountByStakingModule() -> StakingRouter.stakingModule[id].exitedValidatorsCount = exitedCount
        await oracle.submitReportData(reportItems, consensusVersion, { from: consensusMember })

        const sharesNORInMiddle = await lido.sharesOf(nor.address)
        // TODO: Calculate this assert value
        assert.isClose(sharesNORInMiddle, '49767921609076843', 10)

        // Mentionable internal calls
        // AccountingOracle.submitReportExtraDataList()
        //      -> StakingRouter.onValidatorsCountsByNodeOperatorReportingFinished() -> NOR.onExitedAndStuckValidatorsCountsUpdated()._distributeRewards()
        //                                                                                                                             emits NOR.NodeOperatorPenalized
        //                                                                                                                             emits NOR.RewardsDistributed
        //                                                                                                                             -> stETH.transferShares()
        //                                                                                                                             -> Burner.requestBurnShares()
        //      -> StakingRouter.reportStakingModuleExitedValidatorsCountByNodeOperator() -> NOR.updateExitedValidatorsCount() ->
        //                                                                                       emits NOR.ExitedSigningKeysCountChanged
        //                                                                                       ._saveSummarySigningKeysStats()
        //                                                                                       ._updateSummaryMaxValidatorsCount()
        //      -> StakingRouter.reportStakingModuleStuckValidatorsCountByNodeOperator() -> NOR.updateStuckValidatorsCount() ->
        //                                                                                      emits NOR.StuckPenaltyStateChanged
        //                                                                                      ._saveOperatorStuckPenaltyStats()
        //                                                                                      ._updateSummaryMaxValidatorsCount()
        reportTx = await oracle.submitReportExtraDataList(extraDataList, { from: voting.address })
      })

      // TODO: calculate those assert values
      const rewardAmountForOperator1 = '12441980402269210'
      const rewardAmountForOperator2 = '6220990201134605'
      const rewardAmountForOperator3 = '12441980402269210'
      const penaltyAmountForOperator2 = rewardAmountForOperator2
      const penaltyAmountForOperator3 = rewardAmountForOperator3

      it('Events should be emitted after exit/stuck report', async () => {
        const tx = reportTx

        assert.emits(
          tx,
          'ExitedSigningKeysCountChanged',
          { nodeOperatorId: Operator1.id, exitedValidatorsCount: 2 },
          NOR_ABI_ASSERT_EV
        )

        assert.emits(
          tx,
          'StuckPenaltyStateChanged',
          {
            nodeOperatorId: Operator2.id,
            stuckValidatorsCount: 1,
            refundedValidatorsCount: 0,
            stuckPenaltyEndTimestamp: 0,
          },
          NOR_ABI_ASSERT_EV
        )

        await assertRewardsDistributedEvent(tx, 0, rewards1, rewardAmountForOperator1)
        await assertRewardsDistributedEvent(tx, 1, rewards2, rewardAmountForOperator2)
        await assertRewardsDistributedEvent(tx, 2, rewards3, rewardAmountForOperator3)
        await assertNodeOperatorPenalizedEvent(tx, 0, rewards2, penaltyAmountForOperator2)
        await assertNodeOperatorPenalizedEvent(tx, 1, rewards3, penaltyAmountForOperator3)
      })

      it('Operator summaries after exit/stuck report', async () => {
        const operator1 = await nor.getNodeOperator(Operator1.id, true)
        const summaryOperator1 = await nor.getNodeOperatorSummary(Operator1.id)
        assert.equals(operator1.totalExitedValidators, 2)
        assert.equals(summaryOperator1.totalExitedValidators, 2)
        assert.equals(summaryOperator1.depositableValidatorsCount, 4)

        const summaryOperator2 = await nor.getNodeOperatorSummary(Operator2.id)
        assert.equals(summaryOperator2.stuckValidatorsCount, 1)
        assert.equals(summaryOperator2.depositableValidatorsCount, 0)

        const summaryOperator3 = await nor.getNodeOperatorSummary(Operator3.id)
        assert.equals(summaryOperator3.stuckValidatorsCount, 1)
        assert.equals(summaryOperator3.depositableValidatorsCount, 0)

        const sharesNORAfter = await lido.sharesOf(nor.address)
        const sharesRewards1After = await lido.sharesOf(rewards1)
        const sharesRewards2After = await lido.sharesOf(rewards2)
        const sharesRewards3After = await lido.sharesOf(rewards3)

        assert.isClose(sharesNORAfter, 0, 10)
        assert.isClose(sharesRewards1After, rewardAmountForOperator1, 10)
        assert.isClose(sharesRewards2After, rewardAmountForOperator2, 10)
        assert.isClose(sharesRewards3After, rewardAmountForOperator3, 10)
      })
    })

    context('Updating state unsafely', () => {
      let correctionTx

      it('unsafeSetExitedValidatorsCount', async () => {
        // should be distributed after update
        await lido.transfer(nor.address, ETH(10), { from: user1 })

        const operatorData = Operator1
        const correction = {
          currentModuleExitedValidatorsCount: 2,
          currentNodeOperatorExitedValidatorsCount: 2,
          currentNodeOperatorStuckValidatorsCount: 0,
          newModuleExitedValidatorsCount: 3,
          newNodeOperatorExitedValidatorsCount: 3,
          newNodeOperatorStuckValidatorsCount: 0,
        }

        // StakingRouter.unsafeSetExitedValidatorsCount() -> NOR.onExitedAndStuckValidatorsCountsUpdated()._distributeRewards()
        //                                                                                                     emits NOR.NodeOperatorPenalized
        //                                                                                                     emits NOR.RewardsDistributed
        //                                                                                                     -> stETH.transferShares()
        //                                                                                                     -> Burner.requestBurnShares()
        correctionTx = await stakingRouter.unsafeSetExitedValidatorsCount(
          curatedId,
          operatorData.id,
          true,
          correction,
          { from: voting.address }
        )

        const summaryModule = await nor.getStakingModuleSummary()
        const summaryOperator1 = await nor.getNodeOperatorSummary(operatorData.id)
        assert.equals(summaryModule.totalExitedValidators, correction.newModuleExitedValidatorsCount)
        assert.equals(summaryOperator1.totalExitedValidators, correction.newNodeOperatorExitedValidatorsCount)

        // TODO: calculate those assert values
        await assertRewardsDistributedEvent(correctionTx, 0, rewards2, '1658930720302561458')
        await assertRewardsDistributedEvent(correctionTx, 1, rewards3, '3317861440605122916')
      })

      // TODO: assert stuck operators and NodeOperatorPenalized event after unsafeSetExitedValidatorsCount()
    })

    context('Keys and limits settings tweaks', () => {
      it('Disable TargetLimit', async () => {
        const operatorData = Operator2

        await assertTargetLimit(operatorData, true, 1, 0)

        // StakingRouter.updateTargetValidatorsLimits() -> NOR.updateTargetValidatorsLimits()
        const tx = await stakingRouter.updateTargetValidatorsLimits(curatedId, operatorData.id, false, 0, {
          from: voting.address,
        })

        // keysLeft still zero because of stucked key
        await assertTargetLimit(operatorData, false, 0, 0)

        assert.emits(
          tx,
          'TargetValidatorsCountChanged',
          { nodeOperatorId: operatorData.id, targetValidatorsCount: 0 },
          NOR_ABI_ASSERT_EV
        )
      })

      it('Remove multiple signing keys', async () => {
        const operatorData = Operator1

        const operatorBefore = await nor.getNodeOperator(operatorData.id, true)
        const summaryBefore = await nor.getNodeOperatorSummary(operatorData.id)
        const keysCountBefore = await nor.getTotalSigningKeyCount(operatorData.id)
        const unusedKeysCountBefore = await nor.getUnusedSigningKeyCount(operatorData.id)
        const keyIdxToRemove = +operatorBefore.totalDepositedValidators + 1
        const keysCountToRemove = 2
        const key1Before = await nor.getSigningKey(operatorData.id, keyIdxToRemove)
        const key2Before = await nor.getSigningKey(operatorData.id, keyIdxToRemove + 1)

        assert.equals(operatorBefore.totalVettedValidators, operatorData.vettedSigningKeysCount)

        await nor.removeSigningKeys(operatorData.id, keyIdxToRemove, keysCountToRemove, { from: voting.address })

        const operatorAfter = await nor.getNodeOperator(operatorData.id, true)
        const summaryAfter = await nor.getNodeOperatorSummary(operatorData.id)
        const keysCountAfter = await nor.getTotalSigningKeyCount(operatorData.id)
        const unusedKeysCountAfter = await nor.getUnusedSigningKeyCount(operatorData.id)
        const key1After = await nor.getSigningKey(operatorData.id, keyIdxToRemove)
        const key2After = await nor.getSigningKey(operatorData.id, keyIdxToRemove + 1)

        assert.equals(operatorAfter.totalVettedValidators, keyIdxToRemove)
        assert.equals(+operatorBefore.totalAddedValidators - keysCountToRemove, +operatorAfter.totalAddedValidators)
        assert.equals(+keysCountBefore - keysCountToRemove, +keysCountAfter)
        assert.equals(+unusedKeysCountBefore - keysCountToRemove, +unusedKeysCountAfter)
        assert.equals(
          Math.min(
            +summaryBefore.depositableValidatorsCount - keysCountToRemove,
            +operatorAfter.totalVettedValidators - +operatorAfter.totalDepositedValidators
          ),
          +summaryAfter.depositableValidatorsCount
        )
        assert.notEqual(key1Before.key, key1After.key)
        assert.notEqual(key2Before.key, key2After.key)
        assert.notEqual(key1Before.depositSignature, key1After.depositSignature)
        assert.notEqual(key2Before.depositSignature, key2After.depositSignature)
      })

      it('Refund stucked keys for Operator 2', async () => {
        const operatorData = Operator2
        const penaltyDelay = await nor.getStuckPenaltyDelay()

        // StakingRouter.updateRefundedValidatorsCount() -> NOR.updateRefundedValidatorsCount()
        const tx = await stakingRouter.updateRefundedValidatorsCount(curatedId, operatorData.id, 1, {
          from: voting.address,
        })

        const timestamp = await getCurrentBlockTimestamp()
        const expectedPenaltyEnd = +timestamp + +penaltyDelay
        const summary = await nor.getNodeOperatorSummary(operatorData.id)

        assert.equals(summary.stuckPenaltyEndTimestamp, expectedPenaltyEnd)
        assert.equals(summary.depositableValidatorsCount, 0)
        assert.equals(summary.refundedValidatorsCount, 1)

        assert.emits(
          tx,
          'StuckPenaltyStateChanged',
          {
            nodeOperatorId: operatorData.id,
            stuckValidatorsCount: 1,
            refundedValidatorsCount: 1,
            stuckPenaltyEndTimestamp: expectedPenaltyEnd,
          },
          NOR_ABI_ASSERT_EV
        )
      })

      it('Wait for half of penalty delay and check that penalty still applies', async () => {
        const operatorData = Operator2
        const penaltyDelay = await nor.getStuckPenaltyDelay()

        await advanceChainTime(penaltyDelay / 2)
        await assert.reverts(nor.clearNodeOperatorPenalty(operatorData.id), 'CANT_CLEAR_PENALTY')

        const summary = await nor.getNodeOperatorSummary(operatorData.id)
        assert.equals(summary.depositableValidatorsCount, 0)
        assert.equals(summary.refundedValidatorsCount, 1)
      })

      it('Wait for end of penalty delay and check that it is gone', async () => {
        const operatorData = Operator2
        const penaltyDelay = await nor.getStuckPenaltyDelay()

        await advanceChainTime(penaltyDelay / 2 + 100)
        await nor.clearNodeOperatorPenalty(operatorData.id)

        const summary = await nor.getNodeOperatorSummary(operatorData.id)
        assert.equals(summary.depositableValidatorsCount, 9)
      })
    })

    context('Activation/deactivation', () => {
      it('Deactivate operator 1', async () => {
        await deactivateNodeOperator(Operator1.id)
      })

      it('Activate operator 4', async () => {
        const operatorData = Operator4
        const activeOperatorsBefore = await nor.getActiveNodeOperatorsCount()

        const tx = await nor.activateNodeOperator(operatorData.id, { from: voting.address })

        const operator = await nor.getNodeOperator(operatorData.id, true)
        const activeOperatorsAfter = await nor.getActiveNodeOperatorsCount()

        assert.isTrue(operator.active)
        assert.isTrue(await nor.getNodeOperatorIsActive(operatorData.id))
        assert.equals(+activeOperatorsBefore + 1, +activeOperatorsAfter)
        assert.emits(tx, 'NodeOperatorActiveSet', { nodeOperatorId: operatorData.id, active: true })
        assert.equals(operator.totalVettedValidators, operator.totalDepositedValidators)
      })

      it('Set operator 4 staking limit', async () => {
        await setNodeOperatorStakingLimit(Operator4.id, Operator4.vettedSigningKeysCount)
      })

      it('Make another deposit', async () => {
        /**
         * Expected deposits fill   1 2 3 4 5
         * Operator 1 (inactive)  [           ]
         * Operator 2 (refunded)  [ x x       ]
         * Operator 3 (stuck)     [           ]
         * Operator 4 (activated) [     x x x ]
         */

        await waitBlocks(+(await dsm.getMinDepositBlockDistance()))
        await makeDeposit(5)

        // Continuing numbers from previous deposit
        await assertDepositCall(6, Operator2.id, 1)
        await assertDepositCall(7, Operator2.id, 2)
        await assertDepositCall(8, Operator4.id, 0)
        await assertDepositCall(9, Operator4.id, 1)
        await assertDepositCall(10, Operator4.id, 2)

        await assertOperatorDeposits(Operator2, 3, 7)
        await assertOperatorDeposits(Operator4, 3, 2)
      })

      // TODO: [optional] Make a report again if needed
    })

    context('Withdrawal credentials modifying', () => {
      it('setWithdrawalCredentials', async () => {
        const summaryBefore = await nor.getStakingModuleSummary()
        withdrawalCredentials = '0x'.padEnd(66, '5678')
        await stakingRouter.setWithdrawalCredentials(withdrawalCredentials, { from: voting.address })
        const summary = await nor.getStakingModuleSummary()

        assert.equals(summaryBefore.totalExitedValidators, summary.totalExitedValidators)
        assert.equals(summaryBefore.totalDepositedValidators, summary.totalDepositedValidators)
        assert.notEqual(summary.depositableValidatorsCount, summaryBefore.depositableValidatorsCount)
        assert.equals(summary.depositableValidatorsCount, 0)
      })
    })

    // TODO: [optional] assert NOR.getNonce() and NonceChanged event if needed
  })
})
