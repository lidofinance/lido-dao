const { assert } = require('../../helpers/assert')
const { e9, e18, e27, hex } = require('../../helpers/utils')

const {
  CONSENSUS_VERSION,
  deployAndConfigureAccountingOracle,
  getReportDataItems,
  encodeExtraDataItems,
  packExtraDataList,
  calcExtraDataListHash,
  calcReportDataHash,
  EXTRA_DATA_FORMAT_LIST
} = require('./accounting-oracle-deploy.test')

const getDefaultExtraData = () => ({
  stuckKeys: [
    { moduleId: 1, nodeOpIds: [0], keysCounts: [1] },
    { moduleId: 2, nodeOpIds: [0], keysCounts: [2] },
    { moduleId: 3, nodeOpIds: [2], keysCounts: [3] }
  ],
  exitedKeys: [
    { moduleId: 2, nodeOpIds: [1, 2], keysCounts: [1, 3] },
    { moduleId: 3, nodeOpIds: [1], keysCounts: [2] }
  ]
})

const getDefaultReportFields = (overrides) => ({
  consensusVersion: CONSENSUS_VERSION,
  numValidators: 10,
  clBalanceGwei: e9(320),
  stakingModuleIdsWithNewlyExitedValidators: [1],
  numExitedValidatorsByStakingModule: [3],
  withdrawalVaultBalance: e18(1),
  elRewardsVaultBalance: e18(2),
  lastWithdrawalRequestIdToFinalize: 1,
  finalizationShareRate: e27(1),
  isBunkerMode: true,
  extraDataFormat: EXTRA_DATA_FORMAT_LIST,
  // required override: refSlot,
  // required override: extraDataHash,
  // required override: extraDataItemsCount
  ...overrides
})

contract('AccountingOracle', ([admin, account1, account2, member1, member2, stranger]) => {
  let consensus = null
  let oracle = null
  let oracleVersion = null
  let stakingRouter = null

  const deploy = async (options = undefined) => {
    const deployed = await deployAndConfigureAccountingOracle(admin)
    oracle = deployed.oracle
    consensus = deployed.consensus
    stakingRouter = deployed.stakingRouter
    oracleVersion = +(await oracle.getContractVersion())
    await consensus.addMember(member1, 1, { from: admin })
  }

  // note: reportFieldsArg.refSlot is required to pass here
  function getReportData({ extraData: extraDataArg, reportFields: reportFieldsArg } = {}) {
    const extraData = extraDataArg || getDefaultExtraData()

    const extraDataItems = encodeExtraDataItems(extraData)
    const extraDataList = packExtraDataList(extraDataItems)
    const extraDataHash = calcExtraDataListHash(extraDataList)

    const reportFields = getDefaultReportFields({
      extraDataHash,
      extraDataItemsCount: extraDataItems.length,
      ...reportFieldsArg
    })

    const reportItems = getReportDataItems(reportFields)
    const reportHash = calcReportDataHash(reportItems)

    return {
      extraData,
      extraDataItems,
      extraDataList,
      extraDataHash,
      reportFields,
      reportItems,
      reportHash
    }
  }

  async function prepareNextReport({ extraData, reportFields = {} } = {}) {
    const data = getReportData({ extraData, reportFields })

    await consensus.submitReport(data.reportFields.refSlot, data.reportHash, CONSENSUS_VERSION, { from: member1 })
    await oracle.submitReportData(data.reportItems, oracleVersion, { from: member1 })

    const deadline = (await oracle.getConsensusReport()).processingDeadlineTime

    return {
      ...data,
      deadline
    }
  }

  async function prepareNextReportInNextFrame({ extraData, reportFields = {} } = {}) {
    await consensus.advanceTimeToNextFrameStart()
    const { refSlot } = await consensus.getCurrentFrame()
    const next = await prepareNextReport({
      extraData,
      reportFields: {
        ...reportFields,
        refSlot
      }
    })
    return next
  }

  context('deploying', () => {
    before(deploy)

    it('deploying accounting oracle', async () => {
      assert.isNotNull(oracle)
      assert.isNotNull(consensus)
      assert.isNotNull(oracleVersion)
    })
  })

  context('submitReportExtraDataList', () => {
    beforeEach(deploy)

    context('enforces the deadline', () => {
      it('reverts with ProcessingDeadlineMissed if deadline missed', async () => {
        const { extraDataList, deadline } = await prepareNextReportInNextFrame()
        await consensus.advanceTimeToNextFrameStart()
        await assert.reverts(
          oracle.submitReportExtraDataList(extraDataList, { from: member1 }),
          `ProcessingDeadlineMissed(${+deadline})`
        )
      })

      it('pass successfully if time is equals exactly to deadline value', async () => {
        const { extraDataList, deadline, reportFields } = await prepareNextReportInNextFrame()
        await consensus.setTime(deadline)
        const tx = await oracle.submitReportExtraDataList(extraDataList, { from: member1 })
        assert.emits(tx, 'ExtraDataSubmitted', { refSlot: reportFields.refSlot })
      })
    })

    context('checks ref slot', () => {
      it('reverts with CannotSubmitExtraDataBeforeMainData in attempt of try to pass extra data ahead of submitReportData', async () => {
        const { refSlot } = await consensus.getCurrentFrame()
        const { reportHash, extraDataList } = getReportData({ reportFields: { refSlot } })
        await consensus.submitReport(refSlot, reportHash, CONSENSUS_VERSION, { from: member1 })
        // No submitReportData here — trying to send extra data ahead of it
        await assert.reverts(
          oracle.submitReportExtraDataList(extraDataList, { from: member1 }),
          `CannotSubmitExtraDataBeforeMainData()`
        )
      })

      it('pass successfully ', async () => {
        const { refSlot } = await consensus.getCurrentFrame()
        const { reportFields, reportItems, reportHash, extraDataList } = getReportData({ reportFields: { refSlot } })
        await consensus.submitReport(refSlot, reportHash, CONSENSUS_VERSION, { from: member1 })
        // Now submitReportData on it's place
        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
        const tx = await oracle.submitReportExtraDataList(extraDataList, { from: member1 })
        assert.emits(tx, 'ExtraDataSubmitted', { refSlot: reportFields.refSlot })
      })
    })

    context('checks extra data hash', () => {
      it('reverts with UnexpectedDataHash if hash did not match', async () => {
        const { extraDataHash } = await prepareNextReportInNextFrame()
        const incorrectExtraData = getDefaultExtraData()
        ++incorrectExtraData.stuckKeys[0].nodeOpIds[0]
        const incorrectExtraDataItems = encodeExtraDataItems(incorrectExtraData)
        const incorrectExtraDataList = packExtraDataList(incorrectExtraDataItems)
        const incorrectExtraDataHash = calcExtraDataListHash(incorrectExtraDataList)
        await assert.reverts(
          oracle.submitReportExtraDataList(incorrectExtraDataList, { from: member1 }),
          `UnexpectedExtraDataHash("${extraDataHash}", "${incorrectExtraDataHash}")`
        )
      })

      it('pass successfully if data hash matches', async () => {
        const { extraDataList, reportFields } = await prepareNextReportInNextFrame()
        const tx = await oracle.submitReportExtraDataList(extraDataList, { from: member1 })
        assert.emits(tx, 'ExtraDataSubmitted', { refSlot: reportFields.refSlot })
      })
    })

    context('enforces module ids sorting order', () => {
      beforeEach(deploy)

      it('should revert if incorrect extra data list stuckKeys moduleId', async () => {
        const extraDataDefault = getDefaultExtraData()
        const invalidExtraData = {
          ...extraDataDefault,
          stuckKeys: [
            ...extraDataDefault.stuckKeys,
            { moduleId: 4, nodeOpIds: [1], keysCounts: [2] },
            { moduleId: 4, nodeOpIds: [1], keysCounts: [2] }
          ]
        }

        const { extraDataList } = await prepareNextReportInNextFrame({ extraData: invalidExtraData })

        await assert.reverts(
          oracle.submitReportExtraDataList(extraDataList, {
            from: member1
          }),
          'InvalidExtraDataSortOrder(4)'
        )
      })

      it('should revert if incorrect extra data list exitedKeys moduleId', async () => {
        const extraDataDefault = getDefaultExtraData()
        const invalidExtraData = {
          ...extraDataDefault,
          exitedKeys: [
            ...extraDataDefault.exitedKeys,
            { moduleId: 4, nodeOpIds: [1], keysCounts: [2] },
            { moduleId: 4, nodeOpIds: [1], keysCounts: [2] }
          ]
        }

        const { extraDataList } = await prepareNextReportInNextFrame({ extraData: invalidExtraData })

        await assert.reverts(
          oracle.submitReportExtraDataList(extraDataList, {
            from: member1
          }),
          'InvalidExtraDataSortOrder(6)'
        )
      })

      it('should allow calling if correct extra data list moduleId', async () => {
        const extraDataDefault = getDefaultExtraData()
        const invalidExtraData = {
          stuckKeys: [
            ...extraDataDefault.stuckKeys,
            { moduleId: 4, nodeOpIds: [1], keysCounts: [2] },
            { moduleId: 5, nodeOpIds: [1], keysCounts: [2] }
          ],
          exitedKeys: [
            ...extraDataDefault.exitedKeys,
            { moduleId: 4, nodeOpIds: [1], keysCounts: [2] },
            { moduleId: 5, nodeOpIds: [1], keysCounts: [2] }
          ]
        }

        const { extraDataList, reportFields } = await prepareNextReportInNextFrame({ extraData: invalidExtraData })

        const tx = await oracle.submitReportExtraDataList(extraDataList, { from: member1 })
        assert.emits(tx, 'ExtraDataSubmitted', { refSlot: reportFields.refSlot })
      })
    })

    context('delivers the data to staking router', () => {
      it('calling reportStakingModuleStuckValidatorsCountByNodeOperator on StakingRouter', async () => {
        const { extraData, extraDataList } = await prepareNextReportInNextFrame()
        await oracle.submitReportExtraDataList(extraDataList, { from: member1 })

        const callsCount = await stakingRouter.totalCalls_reportStuckKeysByNodeOperator()
        assert.equals(callsCount, extraData.stuckKeys.length)

        for (let i = 0; i < callsCount; i++) {
          const call = await stakingRouter.calls_reportStuckKeysByNodeOperator(i)
          const item = extraData.stuckKeys[i]
          assert.equals(+call.stakingModuleId, item.moduleId)
          assert.equals(call.nodeOperatorIds, '0x' + item.nodeOpIds.map((id) => hex(id, 8)).join(''))
          assert.equals(call.keysCounts, '0x' + item.keysCounts.map((count) => hex(count, 16)).join(''))
        }
      })

      it('calling reportStakingModuleExitedValidatorsCountByNodeOperator on StakingRouter', async () => {
        const { extraData, extraDataList } = await prepareNextReportInNextFrame()
        await oracle.submitReportExtraDataList(extraDataList, { from: member1 })

        const callsCount = await stakingRouter.totalCalls_reportExitedKeysByNodeOperator()
        assert.equals(callsCount, extraData.exitedKeys.length)

        for (let i = 0; i < callsCount; i++) {
          const call = await stakingRouter.calls_reportExitedKeysByNodeOperator(i)
          const item = extraData.exitedKeys[i]
          assert.equals(+call.stakingModuleId, item.moduleId)
          assert.equals(call.nodeOperatorIds, '0x' + item.nodeOpIds.map((id) => hex(id, 8)).join(''))
          assert.equals(call.keysCounts, '0x' + item.keysCounts.map((count) => hex(count, 16)).join(''))
        }
      })
    })

    it('updates extra data processing state', async () => {
      const { extraDataItems, extraDataHash, reportFields, extraDataList } = await prepareNextReportInNextFrame()

      const stateBefore = await oracle.getExtraDataProcessingState()

      assert.equals(+stateBefore.refSlot, reportFields.refSlot)
      assert.equals(+stateBefore.dataFormat, EXTRA_DATA_FORMAT_LIST)
      assert.equals(+stateBefore.itemsCount, extraDataItems.length)
      assert.equals(+stateBefore.itemsProcessed, 0)
      assert.equals(+stateBefore.lastSortingKey, '0')
      assert.equals(stateBefore.dataHash, extraDataHash)

      await oracle.submitReportExtraDataList(extraDataList, { from: member1 })

      const stateAfter = await oracle.getExtraDataProcessingState()

      assert.equals(+stateAfter.refSlot, reportFields.refSlot)
      assert.equals(+stateAfter.dataFormat, EXTRA_DATA_FORMAT_LIST)
      assert.equals(+stateAfter.itemsCount, extraDataItems.length)
      assert.equals(stateAfter.itemsProcessed, extraDataItems.length)
      // TODO: figure out how to build this value and test it properly
      assert.equals(
        stateAfter.lastSortingKey,
        '3533694129556768659166595001485837031654967793751237971583444623713894401'
      )
      assert.equals(stateAfter.dataHash, extraDataHash)
    })
  })
})
