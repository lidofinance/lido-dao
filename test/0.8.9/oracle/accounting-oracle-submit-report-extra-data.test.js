const { assert } = require('../../helpers/assert')
const { e9, e18, e27 } = require('../../helpers/utils')

const {
  CONSENSUS_VERSION,
  deployAndConfigureAccountingOracle,
  getReportDataItems,
  encodeExtraDataItems,
  packExtraDataList,
  calcExtraDataListHash,
  calcReportDataHash,
  EXTRA_DATA_FORMAT_LIST,
  SLOTS_PER_FRAME
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

  const deploy = async (options = undefined) => {
    const deployed = await deployAndConfigureAccountingOracle(admin)
    oracle = deployed.oracle
    consensus = deployed.consensus
    oracleVersion = +(await oracle.getContractVersion())
    await consensus.addMember(member1, 1, { from: admin })
  }

  async function prepareNextReport({ extraData: extraDataArg, reportFields: reportFieldsArg = {} } = {}) {
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

    await consensus.advanceTimeToNextFrameStart()
    await consensus.submitReport(reportFields.refSlot, reportHash, CONSENSUS_VERSION, { from: member1 })
    const deadline = (await oracle.getConsensusReport()).processingDeadlineTime
    await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })

    return {
      extraData,
      extraDataItems,
      extraDataList,
      extraDataHash,
      reportFields,
      reportItems,
      reportHash,
      deadline
    }
  }

  async function prepareNextReportInNextFrame({ extraData, reportFields = {} } = {}) {
    const { refSlot } = await consensus.getCurrentFrame()
    const next = await prepareNextReport({
      extraData,
      reportFields: {
        ...reportFields,
        refSlot: +refSlot + SLOTS_PER_FRAME
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
        await assert.revertsWithCustomError(
          oracle.submitReportExtraDataList(extraDataList, { from: member1 }),
          `ProcessingDeadlineMissed(${+deadline})`
        )
      })

      it('pass successsfully if time is equals exactly to deadline value', async () => {
        const { extraDataList, deadline } = await prepareNextReportInNextFrame()
        await consensus.setTime(deadline)
        await oracle.submitReportExtraDataList(extraDataList, { from: member1 })
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
  })
})
