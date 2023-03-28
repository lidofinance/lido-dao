const { contract } = require('hardhat')
const { assert } = require('../../helpers/assert')
const { e9, e18, e27, hex } = require('../../helpers/utils')

const {
  CONSENSUS_VERSION,
  deployAndConfigureAccountingOracle,
  getAccountingReportDataItems,
  encodeExtraDataItem,
  encodeExtraDataItems,
  packExtraDataList,
  calcExtraDataListHash,
  calcAccountingReportDataHash,
  ZERO_HASH,
  EXTRA_DATA_FORMAT_EMPTY,
  EXTRA_DATA_FORMAT_LIST,
  EXTRA_DATA_TYPE_STUCK_VALIDATORS,
} = require('./accounting-oracle-deploy.test')

const getDefaultExtraData = () => ({
  stuckKeys: [
    { moduleId: 1, nodeOpIds: [0], keysCounts: [1] },
    { moduleId: 2, nodeOpIds: [0], keysCounts: [2] },
    { moduleId: 3, nodeOpIds: [2], keysCounts: [3] },
  ],
  exitedKeys: [
    { moduleId: 2, nodeOpIds: [1, 2], keysCounts: [1, 3] },
    { moduleId: 3, nodeOpIds: [1], keysCounts: [2] },
  ],
})

const getDefaultReportFields = (overrides) => ({
  consensusVersion: CONSENSUS_VERSION,
  numValidators: 10,
  clBalanceGwei: e9(320),
  stakingModuleIdsWithNewlyExitedValidators: [1],
  numExitedValidatorsByStakingModule: [3],
  withdrawalVaultBalance: e18(1),
  elRewardsVaultBalance: e18(2),
  sharesRequestedToBurn: e18(3),
  withdrawalFinalizationBatches: [1],
  simulatedShareRate: e27(1),
  isBunkerMode: true,
  extraDataFormat: EXTRA_DATA_FORMAT_LIST,
  // required override: refSlot,
  // required override: extraDataHash,
  // required override: extraDataItemsCount
  ...overrides,
})

contract('AccountingOracle', ([admin, account1, account2, member1, member2, stranger]) => {
  let consensus = null
  let oracle = null
  let oracleVersion = null
  let stakingRouter = null
  let oracleReportSanityChecker = null

  const deploy = async (options = undefined) => {
    const deployed = await deployAndConfigureAccountingOracle(admin)
    oracle = deployed.oracle
    consensus = deployed.consensus
    stakingRouter = deployed.stakingRouter
    oracleReportSanityChecker = deployed.oracleReportSanityChecker
    oracleVersion = +(await oracle.getContractVersion())
    await consensus.addMember(member1, 1, { from: admin })
  }

  // note: reportFieldsArg.refSlot is required to pass here
  function getReportData({
    extraData: extraDataArg,
    extraDataItems: extraDataItemsArgs,
    reportFields: reportFieldsArg,
  } = {}) {
    const extraData = extraDataArg || getDefaultExtraData()
    const extraDataItems = extraDataItemsArgs || encodeExtraDataItems(extraData)
    const extraDataList = packExtraDataList(extraDataItems)
    const extraDataHash = calcExtraDataListHash(extraDataList)

    const reportFields = getDefaultReportFields({
      extraDataHash,
      extraDataItemsCount: extraDataItems.length,
      ...reportFieldsArg,
    })

    const reportItems = getAccountingReportDataItems(reportFields)
    const reportHash = calcAccountingReportDataHash(reportItems)

    return {
      extraData,
      extraDataItems,
      extraDataList,
      extraDataHash,
      reportFields,
      reportItems,
      reportHash,
    }
  }

  async function prepareReport({ extraData, extraDataItems, reportFields = {} } = {}) {
    const { refSlot } = await consensus.getCurrentFrame()
    return getReportData({ extraData, extraDataItems, reportFields: { ...reportFields, refSlot } })
  }

  async function submitReportHash({ extraData, extraDataItems, reportFields = {} } = {}) {
    const data = await prepareReport({ extraData, extraDataItems, reportFields })
    await consensus.submitReport(data.reportFields.refSlot, data.reportHash, CONSENSUS_VERSION, { from: member1 })
    return data
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
        await consensus.advanceTimeToNextFrameStart()
        const { reportItems, extraDataList } = await submitReportHash()
        const deadline = (await oracle.getConsensusReport()).processingDeadlineTime
        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
        await consensus.advanceTimeToNextFrameStart()
        await assert.reverts(
          oracle.submitReportExtraDataList(extraDataList, { from: member1 }),
          `ProcessingDeadlineMissed(${+deadline})`
        )
      })

      it('pass successfully if time is equals exactly to deadline value', async () => {
        await consensus.advanceTimeToNextFrameStart()
        const { extraDataList, reportFields, reportItems } = await submitReportHash()
        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
        const deadline = (await oracle.getConsensusReport()).processingDeadlineTime
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
        await consensus.advanceTimeToNextFrameStart()
        const { reportItems, extraDataHash } = await submitReportHash()
        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
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
        await consensus.advanceTimeToNextFrameStart()
        const { extraDataList, reportFields, reportItems } = await submitReportHash()
        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
        const tx = await oracle.submitReportExtraDataList(extraDataList, { from: member1 })
        assert.emits(tx, 'ExtraDataSubmitted', { refSlot: reportFields.refSlot })
      })
    })

    context('checks items count', () => {
      it('reverts with UnexpectedExtraDataItemsCount if there was wrong amount of items', async () => {
        const wrongItemsCount = 1
        const reportFields = {
          extraDataItemsCount: wrongItemsCount,
        }
        await consensus.advanceTimeToNextFrameStart()
        const { reportItems, extraDataList, extraDataItems } = await submitReportHash({ reportFields })
        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
        await assert.reverts(
          oracle.submitReportExtraDataList(extraDataList, { from: member1 }),
          `UnexpectedExtraDataItemsCount(${reportFields.extraDataItemsCount}, ${extraDataItems.length})`
        )
      })
    })

    context('enforces data format', () => {
      it('reverts with UnexpectedExtraDataFormat if there was empty format submitted on first phase', async () => {
        const reportFields = {
          extraDataHash: ZERO_HASH,
          extraDataFormat: EXTRA_DATA_FORMAT_EMPTY,
          extraDataItemsCount: 0,
        }
        await consensus.advanceTimeToNextFrameStart()
        const { reportItems, extraDataList } = await submitReportHash({ reportFields })
        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
        await assert.reverts(
          oracle.submitReportExtraDataList(extraDataList, { from: member1 }),
          `UnexpectedExtraDataFormat(${EXTRA_DATA_FORMAT_EMPTY}, ${EXTRA_DATA_FORMAT_LIST})`
        )
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
            { moduleId: 4, nodeOpIds: [1], keysCounts: [2] },
          ],
        }

        await consensus.advanceTimeToNextFrameStart()
        const { reportItems, extraDataList } = await submitReportHash({ extraData: invalidExtraData })
        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })

        await assert.reverts(
          oracle.submitReportExtraDataList(extraDataList, {
            from: member1,
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
            { moduleId: 4, nodeOpIds: [1], keysCounts: [2] },
          ],
        }

        await consensus.advanceTimeToNextFrameStart()
        const { reportItems, extraDataList } = await submitReportHash({ extraData: invalidExtraData })
        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })

        await assert.reverts(
          oracle.submitReportExtraDataList(extraDataList, {
            from: member1,
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
            { moduleId: 5, nodeOpIds: [1], keysCounts: [2] },
          ],
          exitedKeys: [
            ...extraDataDefault.exitedKeys,
            { moduleId: 4, nodeOpIds: [1], keysCounts: [2] },
            { moduleId: 5, nodeOpIds: [1], keysCounts: [2] },
          ],
        }

        await consensus.advanceTimeToNextFrameStart()
        const { reportFields, reportItems, extraDataList } = await submitReportHash({ extraData: invalidExtraData })
        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })

        const tx = await oracle.submitReportExtraDataList(extraDataList, { from: member1 })
        assert.emits(tx, 'ExtraDataSubmitted', { refSlot: reportFields.refSlot })
      })
    })

    context('enforces data safety boundaries', () => {
      context('checks encoded data indexes for UnexpectedExtraDataIndex reverts', () => {
        // contextual helper to prepeare wrong indexed data
        const getExtraWithCustomLastIndex = (itemsCount, lastIndexCustom) => {
          const dummyArr = Array.from(Array(itemsCount))
          const stuckKeys = dummyArr.map((_, i) => ({ moduleId: i + 1, nodeOpIds: [0], keysCounts: [i + 1] }))
          const extraData = { stuckKeys, exitedKeys: [] }
          const extraDataItems = []
          const type = EXTRA_DATA_TYPE_STUCK_VALIDATORS
          dummyArr.forEach((_, i) => {
            const item = extraData.stuckKeys[i]
            const index = i < itemsCount - 1 ? i : lastIndexCustom
            extraDataItems.push(encodeExtraDataItem(index, type, item.moduleId, item.nodeOpIds, item.keysCounts))
          })
          return {
            extraData,
            extraDataItems,
            lastIndexDefault: itemsCount - 1,
            lastIndexCustom,
          }
        }

        it('if first item index is not zero', async () => {
          const { extraData, extraDataItems, lastIndexDefault, lastIndexCustom } = getExtraWithCustomLastIndex(1, 1)
          await consensus.advanceTimeToNextFrameStart()
          const { reportItems, extraDataList } = await submitReportHash({ extraData, extraDataItems })
          await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
          await assert.reverts(
            oracle.submitReportExtraDataList(extraDataList, { from: member1 }),
            `UnexpectedExtraDataIndex(${lastIndexDefault}, ${lastIndexCustom})`
          )
        })

        it('if next index is greater than previous for more than +1', async () => {
          const { extraData, extraDataItems, lastIndexDefault, lastIndexCustom } = getExtraWithCustomLastIndex(2, 2)
          await consensus.advanceTimeToNextFrameStart()
          const { reportItems, extraDataList } = await submitReportHash({ extraData, extraDataItems })
          await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
          await assert.reverts(
            oracle.submitReportExtraDataList(extraDataList, { from: member1 }),
            `UnexpectedExtraDataIndex(${lastIndexDefault}, ${lastIndexCustom})`
          )
        })

        it('if next index equals to previous', async () => {
          const { extraData, extraDataItems, lastIndexDefault, lastIndexCustom } = getExtraWithCustomLastIndex(3, 1)
          await consensus.advanceTimeToNextFrameStart()
          const { reportItems, extraDataList } = await submitReportHash({ extraData, extraDataItems })
          await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
          await assert.reverts(
            oracle.submitReportExtraDataList(extraDataList, { from: member1 }),
            `UnexpectedExtraDataIndex(${lastIndexDefault}, ${lastIndexCustom})`
          )
        })

        it('if next index less than previous', async () => {
          const { extraData, extraDataItems, lastIndexDefault, lastIndexCustom } = getExtraWithCustomLastIndex(3, 0)
          await consensus.advanceTimeToNextFrameStart()
          const { reportItems, extraDataList } = await submitReportHash({ extraData, extraDataItems })
          await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
          await assert.reverts(
            oracle.submitReportExtraDataList(extraDataList, { from: member1 }),
            `UnexpectedExtraDataIndex(${lastIndexDefault}, ${lastIndexCustom})`
          )
        })

        it('succeeds if indexes were passed sequentially', async () => {
          const { extraData, extraDataItems } = getExtraWithCustomLastIndex(3, 2)
          await consensus.advanceTimeToNextFrameStart()
          const { reportFields, reportItems, extraDataList } = await submitReportHash({ extraData, extraDataItems })
          await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
          const tx = await oracle.submitReportExtraDataList(extraDataList, { from: member1 })
          assert.emits(tx, 'ExtraDataSubmitted', { refSlot: reportFields.refSlot })
        })
      })

      context('checks data type for UnsupportedExtraDataType reverts (only supported types are `1` and `2`)', () => {
        // contextual helper to prepeare wrong typed data
        const getExtraWithCustomType = (typeCustom) => {
          const extraData = {
            stuckKeys: [{ moduleId: 1, nodeOpIds: [1], keysCounts: [2] }],
            exitedKeys: [],
          }
          const item = extraData.stuckKeys[0]
          const extraDataItems = []
          extraDataItems.push(encodeExtraDataItem(0, typeCustom, item.moduleId, item.nodeOpIds, item.keysCounts))
          return {
            extraData,
            extraDataItems,
            wrongTypedIndex: 0,
            typeCustom,
          }
        }

        it('if type `0` was passed', async () => {
          const { extraData, extraDataItems, wrongTypedIndex, typeCustom } = getExtraWithCustomType(0)
          await consensus.advanceTimeToNextFrameStart()
          const { reportItems, extraDataList } = await submitReportHash({ extraData, extraDataItems })
          await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
          await assert.reverts(
            oracle.submitReportExtraDataList(extraDataList, { from: member1 }),
            `UnsupportedExtraDataType(${wrongTypedIndex}, ${typeCustom})`
          )
        })

        it('if type `3` was passed', async () => {
          const { extraData, extraDataItems, wrongTypedIndex, typeCustom } = getExtraWithCustomType(3)
          await consensus.advanceTimeToNextFrameStart()
          const { reportItems, extraDataList } = await submitReportHash({ extraData, extraDataItems })
          await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
          await assert.reverts(
            oracle.submitReportExtraDataList(extraDataList, { from: member1 }),
            `UnsupportedExtraDataType(${wrongTypedIndex}, ${typeCustom})`
          )
        })

        it('succeeds if `1` was passed', async () => {
          const { extraData, extraDataItems } = getExtraWithCustomType(1)
          await consensus.advanceTimeToNextFrameStart()
          const { reportFields, reportItems, extraDataList } = await submitReportHash({ extraData, extraDataItems })
          await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
          const tx = await oracle.submitReportExtraDataList(extraDataList, { from: member1 })
          assert.emits(tx, 'ExtraDataSubmitted', { refSlot: reportFields.refSlot })
        })

        it('succeeds if `2` was passed', async () => {
          const { extraData, extraDataItems } = getExtraWithCustomType(2)
          await consensus.advanceTimeToNextFrameStart()
          const { reportFields, reportItems, extraDataList } = await submitReportHash({ extraData, extraDataItems })
          await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
          const tx = await oracle.submitReportExtraDataList(extraDataList, { from: member1 })
          assert.emits(tx, 'ExtraDataSubmitted', { refSlot: reportFields.refSlot })
        })
      })

      context('should check node operators processing limits with OracleReportSanityChecker', () => {
        it('by reverting TooManyNodeOpsPerExtraDataItem if there was too much node operators', async () => {
          const problematicItemIdx = 0
          const extraData = {
            stuckKeys: [{ moduleId: 1, nodeOpIds: [1, 2], keysCounts: [2, 3] }],
            exitedKeys: [],
          }
          const problematicItemsCount = extraData.stuckKeys[problematicItemIdx].nodeOpIds.length
          await consensus.advanceTimeToNextFrameStart()
          const { reportItems, extraDataList } = await submitReportHash({ extraData })
          await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
          await oracleReportSanityChecker.setMaxNodeOperatorsPerExtraDataItemCount(problematicItemsCount - 1)
          await assert.reverts(
            oracle.submitReportExtraDataList(extraDataList, { from: member1 }),
            `TooManyNodeOpsPerExtraDataItem(${problematicItemIdx}, ${problematicItemsCount})`
          )
        })

        it('should not revert in case when items count exactly equals limit', async () => {
          const problematicItemIdx = 0
          const extraData = {
            stuckKeys: [{ moduleId: 1, nodeOpIds: [1, 2], keysCounts: [2, 3] }],
            exitedKeys: [],
          }
          const problematicItemsCount = extraData.stuckKeys[problematicItemIdx].nodeOpIds.length
          await consensus.advanceTimeToNextFrameStart()
          const { reportFields, reportItems, extraDataList } = await submitReportHash({ extraData })
          await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
          await oracleReportSanityChecker.setMaxAccountingExtraDataListItemsCount(problematicItemsCount)
          const tx = await oracle.submitReportExtraDataList(extraDataList, { from: member1 })
          assert.emits(tx, 'ExtraDataSubmitted', { refSlot: reportFields.refSlot })
        })
      })

      context('checks for InvalidExtraDataItem reverts', () => {
        it('reverts if some item not long enough to contain all necessary data — early cut', async () => {
          const invalidItemIndex = 1
          const extraData = {
            stuckKeys: [
              { moduleId: 1, nodeOpIds: [1], keysCounts: [2] },
              { moduleId: 2, nodeOpIds: [1], keysCounts: [2] },
            ],
            exitedKeys: [],
          }
          const extraDataItems = encodeExtraDataItems(extraData)
          // Cutting item to provoke error on early stage
          // of `_processExtraDataItem` function, check on 776 line in AccountingOracle
          const cutStop = 36
          extraDataItems[invalidItemIndex] = extraDataItems[invalidItemIndex].slice(0, cutStop)
          await consensus.advanceTimeToNextFrameStart()
          const { reportItems, extraDataList } = await submitReportHash({ extraData, extraDataItems })
          await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
          await assert.reverts(
            oracle.submitReportExtraDataList(extraDataList, { from: member1 }),
            `InvalidExtraDataItem(${invalidItemIndex})`
          )
        })

        it('reverts if some item not long enough to contain all necessary data — late cut', async () => {
          const invalidItemIndex = 1
          const extraData = {
            stuckKeys: [
              { moduleId: 1, nodeOpIds: [1], keysCounts: [2] },
              { moduleId: 2, nodeOpIds: [1, 2, 3, 4], keysCounts: [2] },
            ],
            exitedKeys: [],
          }
          const extraDataItems = encodeExtraDataItems(extraData)
          // Providing long items and cutting them from end to provoke error on late stage
          // of `_processExtraDataItem` function, check on 812 line in AccountingOracle, first condition
          const cutStop = extraDataItems[invalidItemIndex].length - 2
          extraDataItems[invalidItemIndex] = extraDataItems[invalidItemIndex].slice(0, cutStop)
          await consensus.advanceTimeToNextFrameStart()
          const { reportItems, extraDataList } = await submitReportHash({ extraData, extraDataItems })
          await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
          await assert.reverts(
            oracle.submitReportExtraDataList(extraDataList, { from: member1 }),
            `InvalidExtraDataItem(${invalidItemIndex})`
          )
        })

        it('moduleId cannot be zero', async () => {
          const invalidItemIndex = 1
          const extraData = {
            stuckKeys: [
              { moduleId: 1, nodeOpIds: [1], keysCounts: [2] },
              { moduleId: 0, nodeOpIds: [1], keysCounts: [2] },
            ],
            exitedKeys: [],
          }
          await consensus.advanceTimeToNextFrameStart()
          const { reportItems, extraDataList } = await submitReportHash({ extraData })
          await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
          await assert.reverts(
            oracle.submitReportExtraDataList(extraDataList, { from: member1 }),
            `InvalidExtraDataItem(${invalidItemIndex})`
          )
        })

        it('checks node ops count to be non-zero', async () => {
          const invalidItemIndex = 0
          // Empty nodeOpIds list should provoke check fail
          //  in `_processExtraDataItem` function, 812 line in AccountingOracle, second condition
          const extraData = {
            stuckKeys: [
              { moduleId: 1, nodeOpIds: [], keysCounts: [2] },
              { moduleId: 2, nodeOpIds: [1], keysCounts: [2] },
            ],
            exitedKeys: [],
          }
          const extraDataItems = encodeExtraDataItems(extraData)
          await consensus.advanceTimeToNextFrameStart()
          const { reportItems, extraDataList } = await submitReportHash({ extraData, extraDataItems })
          await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
          await assert.reverts(
            oracle.submitReportExtraDataList(extraDataList, { from: member1 }),
            `InvalidExtraDataItem(${invalidItemIndex})`
          )
        })
      })

      it('reverts on extra bytes in data', async () => {
        await consensus.advanceTimeToNextFrameStart()
        const { refSlot } = await consensus.getCurrentFrame()

        const extraDataItems = encodeExtraDataItems(getDefaultExtraData())
        const extraDataList = packExtraDataList(extraDataItems) + 'ffff'
        const extraDataHash = calcExtraDataListHash(extraDataList)

        const reportFields = getDefaultReportFields({
          extraDataHash,
          extraDataItemsCount: extraDataItems.length,
          refSlot,
        })

        const reportItems = getAccountingReportDataItems(reportFields)
        const reportHash = calcAccountingReportDataHash(reportItems)

        await consensus.submitReport(reportFields.refSlot, reportHash, CONSENSUS_VERSION, {
          from: member1,
        })
        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })

        await assert.reverts(
          oracle.submitReportExtraDataList(extraDataList, { from: member1 }),
          'UnexpectedExtraDataIndex(5, 16776960)'
        )
      })
    })

    context('delivers the data to staking router', () => {
      it('calls reportStakingModuleStuckValidatorsCountByNodeOperator on StakingRouter', async () => {
        await consensus.advanceTimeToNextFrameStart()
        const { reportItems, extraData, extraDataList } = await submitReportHash()
        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })

        await oracle.submitReportExtraDataList(extraDataList, { from: member1 })

        const callsCount = await stakingRouter.totalCalls_reportStuckKeysByNodeOperator()
        assert.equals(callsCount, extraData.stuckKeys.length)

        for (let i = 0; i < callsCount; i++) {
          const call = await stakingRouter.calls_reportStuckKeysByNodeOperator(i)
          const item = extraData.stuckKeys[i]
          assert.equals(call.stakingModuleId, item.moduleId)
          assert.equals(call.nodeOperatorIds, '0x' + item.nodeOpIds.map((id) => hex(id, 8)).join(''))
          assert.equals(call.keysCounts, '0x' + item.keysCounts.map((count) => hex(count, 16)).join(''))
        }
      })

      it('calls reportStakingModuleExitedValidatorsCountByNodeOperator on StakingRouter', async () => {
        await consensus.advanceTimeToNextFrameStart()
        const { reportItems, extraData, extraDataList } = await submitReportHash()
        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })

        await oracle.submitReportExtraDataList(extraDataList, { from: member1 })

        const callsCount = await stakingRouter.totalCalls_reportExitedKeysByNodeOperator()
        assert.equals(callsCount, extraData.exitedKeys.length)

        for (let i = 0; i < callsCount; i++) {
          const call = await stakingRouter.calls_reportExitedKeysByNodeOperator(i)
          const item = extraData.exitedKeys[i]
          assert.equals(call.stakingModuleId, item.moduleId)
          assert.equals(call.nodeOperatorIds, '0x' + item.nodeOpIds.map((id) => hex(id, 8)).join(''))
          assert.equals(call.keysCounts, '0x' + item.keysCounts.map((count) => hex(count, 16)).join(''))
        }
      })

      it('calls onValidatorsCountsByNodeOperatorReportingFinished on StakingRouter', async () => {
        await consensus.advanceTimeToNextFrameStart()
        const { reportItems, extraDataList } = await submitReportHash()
        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })

        await oracle.submitReportExtraDataList(extraDataList, { from: member1 })
        const callsCount = await stakingRouter.totalCalls_onValidatorsCountsByNodeOperatorReportingFinished()
        assert.equals(callsCount, 1)
      })
    })

    it('reverts if extraData has already been already processed', async () => {
      await consensus.advanceTimeToNextFrameStart()
      const { reportItems, extraDataItems, extraDataList } = await submitReportHash()
      await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
      await oracle.submitReportExtraDataList(extraDataList, { from: member1 })
      const state = await oracle.getExtraDataProcessingState()
      assert.equals(state.itemsCount, extraDataItems.length)
      assert.equals(state.itemsCount, state.itemsProcessed)
      await assert.revertsWithCustomError(
        oracle.submitReportExtraDataList(extraDataList, { from: member1 }),
        `ExtraDataAlreadyProcessed()`
      )
    })

    it('reverts if main data has not been processed yet', async () => {
      await consensus.advanceTimeToNextFrameStart()
      const report1 = await prepareReport()

      await assert.revertsWithCustomError(
        oracle.submitReportExtraDataList(report1.extraDataList, { from: member1 }),
        'CannotSubmitExtraDataBeforeMainData()'
      )

      await consensus.submitReport(report1.reportFields.refSlot, report1.reportHash, CONSENSUS_VERSION, {
        from: member1,
      })

      await assert.revertsWithCustomError(
        oracle.submitReportExtraDataList(report1.extraDataList, { from: member1 }),
        'CannotSubmitExtraDataBeforeMainData()'
      )

      await oracle.submitReportData(report1.reportItems, oracleVersion, { from: member1 })

      await consensus.advanceTimeToNextFrameStart()
      const report2 = await submitReportHash()

      await assert.revertsWithCustomError(
        oracle.submitReportExtraDataList(report1.extraDataList, { from: member1 }),
        'CannotSubmitExtraDataBeforeMainData()'
      )

      await assert.revertsWithCustomError(
        oracle.submitReportExtraDataList(report2.extraDataList, { from: member1 }),
        'CannotSubmitExtraDataBeforeMainData()'
      )
    })

    it('updates extra data processing state', async () => {
      await consensus.advanceTimeToNextFrameStart()
      const { reportItems, reportFields, extraDataItems, extraDataHash, extraDataList } = await submitReportHash()
      await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })

      const stateBefore = await oracle.getExtraDataProcessingState()

      assert.equals(stateBefore.refSlot, reportFields.refSlot)
      assert.equals(stateBefore.dataFormat, EXTRA_DATA_FORMAT_LIST)
      assert.isFalse(stateBefore.submitted)
      assert.equals(stateBefore.itemsCount, extraDataItems.length)
      assert.equals(stateBefore.itemsProcessed, 0)
      assert.equals(stateBefore.lastSortingKey, '0')
      assert.equals(stateBefore.dataHash, extraDataHash)

      await oracle.submitReportExtraDataList(extraDataList, { from: member1 })

      const stateAfter = await oracle.getExtraDataProcessingState()

      assert.equals(stateAfter.refSlot, reportFields.refSlot)
      assert.equals(stateAfter.dataFormat, EXTRA_DATA_FORMAT_LIST)
      assert.isTrue(stateAfter.submitted)
      assert.equals(stateAfter.itemsCount, extraDataItems.length)
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
