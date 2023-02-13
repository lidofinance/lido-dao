const { assert } = require('../../helpers/assert')
const { assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
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

contract('AccountingOracle', ([admin, account1, account2, member1, member2, stranger]) => {
  let consensus = null
  let oracle = null
  let reportItems = null
  let reportFields = null
  let extraDataList = null
  let extraDataHash = null
  let extraDataItems = null
  let oracleVersion = null
  let deadline = null
  let extraData = null

  const deploy = async (options = undefined) => {
    const deployed = await deployAndConfigureAccountingOracle(admin)
    const { refSlot } = await deployed.consensus.getCurrentFrame()

    extraData = {
      stuckKeys: [
        { moduleId: 1, nodeOpIds: [0], keysCounts: [1] },
        { moduleId: 2, nodeOpIds: [0], keysCounts: [2] },
        { moduleId: 3, nodeOpIds: [2], keysCounts: [3] }
      ],
      exitedKeys: [
        { moduleId: 2, nodeOpIds: [1, 2], keysCounts: [1, 3] },
        { moduleId: 3, nodeOpIds: [1], keysCounts: [2] }
      ]
    }

    extraDataItems = encodeExtraDataItems(extraData)
    extraDataList = packExtraDataList(extraDataItems)
    extraDataHash = calcExtraDataListHash(extraDataList)
    reportFields = {
      consensusVersion: CONSENSUS_VERSION,
      refSlot: +refSlot,
      numValidators: 10,
      clBalanceGwei: e9(320),
      stakingModuleIdsWithNewlyExitedValidators: [1, 2, 1],
      numExitedValidatorsByStakingModule: [3],
      withdrawalVaultBalance: e18(1),
      elRewardsVaultBalance: e18(2),
      lastWithdrawalRequestIdToFinalize: 1,
      finalizationShareRate: e27(1),
      isBunkerMode: true,
      extraDataFormat: EXTRA_DATA_FORMAT_LIST,
      extraDataHash: extraDataHash,
      extraDataItemsCount: extraDataItems.length
    }
    reportItems = getReportDataItems(reportFields)
    const reportHash = calcReportDataHash(reportItems)
    await deployed.consensus.addMember(member1, 1, { from: admin })
    await deployed.consensus.submitReport(refSlot, reportHash, CONSENSUS_VERSION, { from: member1 })

    oracleVersion = +(await deployed.oracle.getContractVersion())
    deadline = (await deployed.oracle.getConsensusReport()).processingDeadlineTime

    oracle = deployed.oracle
    consensus = deployed.consensus
  }

  async function prepareNextReport(newReportFields) {
    await consensus.setTime(deadline)

    const newReportItems = getReportDataItems(newReportFields)
    const reportHash = calcReportDataHash(newReportItems)

    await consensus.advanceTimeToNextFrameStart()
    await consensus.submitReport(newReportFields.refSlot, reportHash, CONSENSUS_VERSION, { from: member1 })
    await oracle.submitReportData(newReportItems, oracleVersion, { from: member1 })
  }

  context('deploying', () => {
    before(deploy)

    it('deploying accounting oracle', async () => {
      assert.isNotNull(oracle)
      assert.isNotNull(consensus)
      assert.isNotNull(reportItems)
      assert.isNotNull(extraData)
      assert.isNotNull(extraDataList)
      assert.isNotNull(extraDataHash)
      assert.isNotNull(extraDataItems)
      assert.isNotNull(oracleVersion)
      assert.isNotNull(deadline)
    })
  })

  context('submitReportExtraDataList', () => {
    beforeEach(deploy)

    context('enforces module ids sorting order', () => {
      beforeEach(deploy)

      it('should revert if incorrect extra data list stuckKeys moduleId', async () => {
        const { refSlot } = await consensus.getCurrentFrame()

        const nextRefSlot = +refSlot + SLOTS_PER_FRAME
        const invalidExtraData = {
          ...extraData,
          stuckKeys: [
            ...extraData.stuckKeys,
            { moduleId: 4, nodeOpIds: [1], keysCounts: [2] },
            { moduleId: 4, nodeOpIds: [1], keysCounts: [2] }
          ]
        }
        const extraDataItems = encodeExtraDataItems(invalidExtraData)
        const extraDataList = packExtraDataList(extraDataItems)
        const extraDataHash = calcExtraDataListHash(extraDataList)

        const newReportFields = {
          ...reportFields,
          refSlot: nextRefSlot,
          extraDataHash: extraDataHash,
          extraDataItemsCount: extraDataItems.length
        }

        await prepareNextReport(newReportFields)

        await assert.reverts(
          oracle.submitReportExtraDataList(extraDataList, {
            from: member1
          }),
          'InvalidExtraDataSortOrder(4)'
        )
      })

      it('should revert if incorrect extra data list exitedKeys moduleId', async () => {
        const { refSlot } = await consensus.getCurrentFrame()

        const nextRefSlot = +refSlot + SLOTS_PER_FRAME
        const invalidExtraData = {
          ...extraData,
          exitedKeys: [
            ...extraData.exitedKeys,
            { moduleId: 4, nodeOpIds: [1], keysCounts: [2] },
            { moduleId: 4, nodeOpIds: [1], keysCounts: [2] }
          ]
        }
        const extraDataItems = encodeExtraDataItems(invalidExtraData)
        const extraDataList = packExtraDataList(extraDataItems)
        const extraDataHash = calcExtraDataListHash(extraDataList)

        const newReportFields = {
          ...reportFields,
          refSlot: nextRefSlot,
          extraDataHash: extraDataHash,
          extraDataItemsCount: extraDataItems.length
        }

        await prepareNextReport(newReportFields)

        await assert.reverts(
          oracle.submitReportExtraDataList(extraDataList, {
            from: member1
          }),
          'InvalidExtraDataSortOrder(6)'
        )
      })

      it('should should allow calling if correct extra data list moduleId', async () => {
        const { refSlot } = await consensus.getCurrentFrame()

        const nextRefSlot = +refSlot + SLOTS_PER_FRAME
        const invalidExtraData = {
          stuckKeys: [
            ...extraData.stuckKeys,
            { moduleId: 4, nodeOpIds: [1], keysCounts: [2] },
            { moduleId: 5, nodeOpIds: [1], keysCounts: [2] }
          ],
          exitedKeys: [
            ...extraData.exitedKeys,
            { moduleId: 4, nodeOpIds: [1], keysCounts: [2] },
            { moduleId: 5, nodeOpIds: [1], keysCounts: [2] }
          ]
        }
        const extraDataItems = encodeExtraDataItems(invalidExtraData)
        const extraDataList = packExtraDataList(extraDataItems)
        const extraDataHash = calcExtraDataListHash(extraDataList)

        const newReportFields = {
          ...reportFields,
          refSlot: nextRefSlot,
          extraDataHash: extraDataHash,
          extraDataItemsCount: extraDataItems.length
        }

        await prepareNextReport(newReportFields)

        const tx = await oracle.submitReportExtraDataList(extraDataList, { from: member1 })
        assertEvent(tx, 'ExtraDataSubmitted', { expectedArgs: { refSlot: newReportFields.refSlot } })
      })
    })
  })
})
