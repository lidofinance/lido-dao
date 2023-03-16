const { contract, web3 } = require('hardhat')
const { assert } = require('../helpers/assert')

const signingKeys = require('../helpers/signing-keys')
const { DSMAttestMessage } = require('../helpers/signatures')
const { deployProtocol } = require('../helpers/protocol')
const { setupNodeOperatorsRegistry, NodeOperatorsRegistry } = require('../helpers/staking-modules')
const { e18, e27, toBN, ETH } = require('../helpers/utils')
const {
  getAccountingReportDataItems,
  encodeExtraDataItems,
  packExtraDataList,
  calcExtraDataListHash,
  calcAccountingReportDataHash,
} = require('../0.8.9/oracle/accounting-oracle-deploy.test')

const E9 = toBN(10).pow(toBN(9))

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'
const ADDRESS_3 = '0x0000000000000000000000000000000000000003'

const NODE_OPERATORS = [
  {
    id: 0,
    name: 'Node operator #1',
    rewardAddressInitial: ADDRESS_1,
    totalSigningKeysCount: 10,
    vettedSigningKeysCount: 6,
  },
  {
    id: 1,
    isActive: false,
    name: 'Node operator #2',
    rewardAddressInitial: ADDRESS_2,
    totalSigningKeysCount: 15,
    vettedSigningKeysCount: 10,
  },
  {
    id: 2,
    isActive: false,
    name: 'Node operator #3',
    rewardAddressInitial: ADDRESS_3,
    totalSigningKeysCount: 10,
    vettedSigningKeysCount: 5,
  },
]

const Operator1 = NODE_OPERATORS[0]
const Operator2 = NODE_OPERATORS[1]
const Operator3 = NODE_OPERATORS[2]

const forEachSync = async (arr, cb) => {
  for (let i = 0; i < arr.length; ++i) {
    await cb(arr[i], i)
  }
}

contract('NodeOperatorsRegistry', ([appManager, rewards1, rewards2, rewards3, user1, nobody]) => {
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

  async function assertDepositCall(operatorId, callIdx, keyIdx) {
    const regCall = await depositContract.calls.call(callIdx)
    const { key, depositSignature } = await nor.getSigningKey(operatorId, keyIdx)
    assert.equal(regCall.pubkey, key)
    assert.equal(regCall.signature, depositSignature)
    assert.equal(regCall.withdrawal_credentials, withdrawalCredentials)
    assert.equals(regCall.value, ETH(32))
  }

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

    rewardAddresses = [rewards1, rewards2, rewards3]

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

    consensusVersion = await oracle.getConsensusVersion()
    await consensus.removeMember(signers[4].address, 2, { from: voting.address })
    await consensus.removeMember(signers[3].address, 1, { from: voting.address })

    withdrawalCredentials = '0x'.padEnd(66, '1234')
    await stakingRouter.setWithdrawalCredentials(withdrawalCredentials, { from: voting.address })
  })

  describe('Happy path', () => {
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
        assert.equals(operator.stakingLimit, 0)
        assert.equals(operator.stoppedValidators, 0)
        assert.equals(operator.totalSigningKeys, 0)
        assert.equals(operator.usedSigningKeys, 0)
      })

      assert.equals(await nor.getNodeOperatorsCount(), NODE_OPERATORS.length)
    })

    // TODO: Move this block after keys manipulations to check how it will affect them
    it('Deactivate node operator 3', async () => {
      const activeOperatorsBefore = await nor.getActiveNodeOperatorsCount()
      const tx = await nor.deactivateNodeOperator(Operator3.id, { from: voting.address })
      const operator = await nor.getNodeOperator(Operator3.id, true)
      const activeOperatorsAfter = await nor.getActiveNodeOperatorsCount()

      assert.isFalse(await nor.getNodeOperatorIsActive(Operator3.id))
      assert.isFalse(operator.active)
      assert.equals(Number(activeOperatorsBefore) - 1, Number(activeOperatorsAfter))
      assert.emits(tx, 'NodeOperatorActiveSet', { nodeOperatorId: Operator3.id, active: false })
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
        const keys = new signingKeys.FakeValidatorKeys(operatorData.totalSigningKeysCount)
        await nor.addSigningKeys(operatorData.id, keys.count, ...keys.slice(), { from: voting.address })

        const operator = await nor.getNodeOperator(operatorData.id, true)
        const keysCount = await nor.getTotalSigningKeyCount(operatorData.id)
        const unusedKeysCount = await nor.getUnusedSigningKeyCount(operatorData.id)
        assert.equals(keys.count, operator.totalSigningKeys.toNumber())
        assert.equals(keys.count, keysCount)
        assert.equals(keys.count, unusedKeysCount)

        for (let i = 0; i < keys.count; ++i) {
          const { key, depositSignature } = await nor.getSigningKey(operatorData.id, i)
          const [expectedPublicKey, expectedSignature] = keys.get(i)
          assert.equals(key, expectedPublicKey)
          assert.equals(depositSignature, expectedSignature)
        }
      })
    })

    let stateTotalVetted = 0
    let stateTotaldeposited = 0

    it('Set staking limit', async () => {
      await forEachSync(NODE_OPERATORS, async (operatorData, i) => {
        if (!(await nor.getNodeOperatorIsActive(operatorData.id))) return
        stateTotalVetted += operatorData.vettedSigningKeysCount
        await nor.setNodeOperatorStakingLimit(operatorData.id, operatorData.vettedSigningKeysCount, {
          from: voting.address,
        })
        const operator = await nor.getNodeOperator(operatorData.id, true)
        assert.equals(operator.stakingLimit, operatorData.vettedSigningKeysCount)
      })

      const stakingModuleSummary = await nor.getStakingModuleSummary()
      assert.equals(stakingModuleSummary.depositableValidatorsCount, stateTotalVetted)
    })

    it('Set target limit', async () => {
      const [curated] = await stakingRouter.getStakingModules()
      const operatorId = Operator2.id

      let summary = await nor.getNodeOperatorSummary(operatorId)
      assert.equals(summary.isTargetLimitActive, false)
      assert.equals(summary.targetValidatorsCount, 0)
      assert.equals(summary.depositableValidatorsCount, 10)

      // StakingRouter.updateTargetValidatorsLimits() -> NOR.updateTargetValidatorsLimits()
      const tx = await stakingRouter.updateTargetValidatorsLimits(curated.id, operatorId, true, 1, {
        from: voting.address,
      })

      summary = await nor.getNodeOperatorSummary(operatorId)
      assert.equals(summary.isTargetLimitActive, true)
      assert.equals(summary.targetValidatorsCount, 1)
      assert.equals(summary.depositableValidatorsCount, 1)

      assert.emits(
        tx,
        'TargetValidatorsCountChanged',
        { nodeOperatorId: operatorId, targetValidatorsCount: 1 },
        { abi: NodeOperatorsRegistry._json.abi }
      )
    })

    it('Obtain deposit data', async () => {
      const [curated] = await stakingRouter.getStakingModules()

      const stakesDeposited = 4
      await web3.eth.sendTransaction({ to: lido.address, from: user1, value: ETH(32 * stakesDeposited) })

      const block = await web3.eth.getBlock('latest')
      const keysOpIndex = await nor.getKeysOpIndex()

      DSMAttestMessage.setMessagePrefix(await dsm.ATTEST_MESSAGE_PREFIX())

      const attest = new DSMAttestMessage(block.number, block.hash, depositRoot, curated.id, keysOpIndex)
      const signatures = [
        attest.sign(guardians.privateKeys[guardians.addresses[0]]),
        attest.sign(guardians.privateKeys[guardians.addresses[1]]),
      ]

      // triggers flow:
      // DSM.depositBufferedEther() -> Lido.deposit() -> StakingRouter.deposit() -> Module.obtainDepositData()
      await dsm.depositBufferedEther(block.number, block.hash, depositRoot, curated.id, keysOpIndex, '0x', signatures)

      stateTotaldeposited += stakesDeposited

      const depositCallCount = await depositContract.totalCalls()
      assert.equals(depositCallCount, stakesDeposited)

      // Target Limit affects here, that's why operator 1 receives 3 deposits, while operator 2 got only 1
      await assertDepositCall(Operator1.id, 0, 0)
      await assertDepositCall(Operator1.id, 1, 1)
      await assertDepositCall(Operator1.id, 2, 2)
      await assertDepositCall(Operator2.id, 3, 0)

      const stakingModuleSummary = await nor.getStakingModuleSummary()
      assert.equals(stakingModuleSummary.totalDepositedValidators, stateTotaldeposited)
      assert.equals(stakingModuleSummary.depositableValidatorsCount, 3)

      const summaryOperator1 = await nor.getNodeOperatorSummary(Operator1.id)
      assert.equals(summaryOperator1.totalDepositedValidators, 3)
      assert.equals(summaryOperator1.depositableValidatorsCount, 3)

      const summaryOperator2 = await nor.getNodeOperatorSummary(Operator2.id)
      assert.equals(summaryOperator2.totalDepositedValidators, 1)
      assert.equals(summaryOperator2.depositableValidatorsCount, 0)
    })

    it('Rewards distribution', async () => {
      const totalRewardsShare = web3.utils.toWei('20')
      const distribution = await nor.getRewardsDistribution(totalRewardsShare)
      assert.equal(distribution.shares[0], web3.utils.toWei('15'))
      assert.equal(distribution.shares[1], web3.utils.toWei('5'))
      assert.equal(distribution.recipients[0], rewards1)
      assert.equal(distribution.recipients[1], rewards2)
    })

    it('Validators exiting and stuck', async () => {
      const { refSlot } = await consensus.getCurrentFrame()
      const [curated] = await stakingRouter.getStakingModules()

      const extraData = {
        exitedKeys: [{ moduleId: 1, nodeOpIds: [0], keysCounts: [2] }],
        stuckKeys: [{ moduleId: 1, nodeOpIds: [1], keysCounts: [1] }],
      }

      const extraDataItems = encodeExtraDataItems(extraData)
      const extraDataList = packExtraDataList(extraDataItems)
      const extraDataHash = calcExtraDataListHash(extraDataList)

      const reportFields = {
        consensusVersion,
        numValidators: 4,
        clBalanceGwei: toBN(ETH(32 * 4)).div(E9),
        stakingModuleIdsWithNewlyExitedValidators: [curated.id],
        numExitedValidatorsByStakingModule: [1],
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
      // TODO: [optional] assert those tied calls
      await oracle.submitReportData(reportItems, consensusVersion, { from: consensusMember })

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
      const tx = await oracle.submitReportExtraDataList(extraDataList, { from: voting.address })

      assert.emits(
        tx,
        'ExitedSigningKeysCountChanged',
        { nodeOperatorId: Operator1.id, exitedValidatorsCount: 2 },
        { abi: NodeOperatorsRegistry._json.abi }
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
        { abi: NodeOperatorsRegistry._json.abi }
      )

      const summaryOperator1 = await nor.getNodeOperatorSummary(Operator1.id)
      assert.equals(summaryOperator1.totalExitedValidators, 2)

      const summaryOperator2 = await nor.getNodeOperatorSummary(Operator2.id)
      assert.equals(summaryOperator2.stuckValidatorsCount, 1)

      // TODO: assert emits NodeOperatorPenalized
      // TODO: assert emits RewardsDistributed
      // TODO: assert rewards was transfered with NOR._distributeRewards()
      // TODO: assert rewards was transfered to operators for his exited validators
      // TODO: assert TargetLimit was changed to zero if any key stucked. ... -> NOR._updateSummaryMaxValidatorsCount()
    })

    it('unsafeSetExitedValidatorsCount', async () => {
      const [curated] = await stakingRouter.getStakingModules()
      const correction = {
        currentModuleExitedValidatorsCount: 1,
        currentNodeOperatorExitedValidatorsCount: 2,
        currentNodeOperatorStuckValidatorsCount: 0,
        newModuleExitedValidatorsCount: 1,
        newNodeOperatorExitedValidatorsCount: 3,
        newNodeOperatorStuckValidatorsCount: 0,
      }

      // StakingRouter.unsafeSetExitedValidatorsCount() -> NOR.onExitedAndStuckValidatorsCountsUpdated()._distributeRewards()
      //                                                                                                     emits NOR.NodeOperatorPenalized
      //                                                                                                     emits NOR.RewardsDistributed
      //                                                                                                     -> stETH.transferShares()
      //                                                                                                     -> Burner.requestBurnShares()
      await stakingRouter.unsafeSetExitedValidatorsCount(curated.id, Operator1.id, true, correction, {
        from: voting.address,
      })

      const summaryOperator1 = await nor.getNodeOperatorSummary(Operator1.id)
      assert.equals(summaryOperator1.totalExitedValidators, 3)

      // TODO: assert emits NOR.NodeOperatorPenalized
      // TODO: assert emits NOR.RewardsDistributed
      // TODO: assert rewards was transfered with NOR._distributeRewards()
      // TODO: assert rewards was transfered to operators for his exited validators
    })

    // TODO: TargetLimit allows to deposit after exit

    // TODO: disable TargetLimit and try to deposit again

    // TODO: NOR.removeSigningKey()
    //       NOR.removeSigningKeys()
    //           assert that staking limit was changed
    //           check if we need to assert target limit

    // TODO: NOR....()
    //       Deactivate Operator that was in use before
    //       Make another deposit to check that deactivated node operator will not get deposit
    //       Assert rewards not distributed to disabled operator

    // TODO: NOR.activateNodeOperator()
    //           Activate Operator again and it will be used in deposit flow

    // TODO: StakingRouter.setWithdrawalCredentials() -> NOR.onWithdrawalCredentialsChanged()
    //          assert depositable of all operators should be zero
    //          assert totalValidatorsCount of all operators == deposited validators
    //          assert NOR.getStakingModuleSummary() — depositable = 0, exited = same, deposited = same

    // TODO: manipulate with stuck validators
    //       this value can come from from two sources:
    //            AccountingOracle.submitReportExtraDataList()
    //            NOR.unsafeUpdateValidatorsCount()
    //       assert that NOR.onExitedAndStuckValidatorsCountsUpdated() should be called

    // TODO: [optional] unsafeUpdateValidatorsCount

    // TODO: [do more research] Refuneded keys
    //           1. Operator already have stucked keys
    //           2. Set refunded via StakingRouter...() -> NOR.updateRefundedValidatorsCount() with refunded == stuckKeys
    //           3. Wait for half of penalty delay and check that penalty still with NOR.getRewardsDistribution() and Oracle report and obtain deposit data
    //           4. Wait for end of penalty delay and check that it is gone
    //         assert NOR.getStuckPenaltyDelay()
    //         assert NOR.setStuckPenaltyDelay()
    //         assert penalty affects on TargetLimit

    // TODO: [optional] add NOR.getNonce() somewhere

    // TODO: [optional] assert NOR._getSigningKeysAllocationData() if it is possible
  })
})
