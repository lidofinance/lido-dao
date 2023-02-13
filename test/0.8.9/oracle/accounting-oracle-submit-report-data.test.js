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
  let mockLido = null
  let reportItems = null
  let reportFields = null
  let extraDataList = null
  let extraDataHash = null
  let extraDataItems = null
  let oracleVersion = null
  let deadline = null

  const deploy = async (options = undefined) => {
    const deployed = await deployAndConfigureAccountingOracle(admin)
    const { refSlot } = await deployed.consensus.getCurrentFrame()

    const extraData = {
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
      stakingModuleIdsWithNewlyExitedValidators: [1],
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
    mockLido = deploy.mockLido
  }

  context('deploying', () => {
    before(deploy)

    it('deploying accounting oracle', async () => {
      assert.isNotNull(oracle)
      assert.isNotNull(consensus)
      assert.isNotNull(mockLido)
      assert.isNotNull(reportItems)
      assert.isNotNull(extraDataList)
      assert.isNotNull(extraDataHash)
      assert.isNotNull(extraDataItems)
      assert.isNotNull(oracleVersion)
      assert.isNotNull(deadline)
    })
  })

  context('submitReportData', () => {
    beforeEach(deploy)

    context('checks contract version', () => {
      it('should revert if incorrect contract version', async () => {
        await consensus.setTime(deadline)

        const incorrectNextVersion = oracleVersion + 1
        const incorrectPrevVersion = oracleVersion - 1

        await assert.reverts(
          oracle.submitReportData(reportItems, incorrectNextVersion, { from: member1 }),
          `UnexpectedContractVersion(${oracleVersion}, ${incorrectNextVersion})`
        )

        await assert.reverts(
          oracle.submitReportData(reportItems, incorrectPrevVersion, { from: member1 }),
          `UnexpectedContractVersion(${oracleVersion}, ${incorrectPrevVersion})`
        )
      })

      it('should should allow calling if correct contract version', async () => {
        await consensus.setTime(deadline)

        const tx = await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
        assertEvent(tx, 'ProcessingStarted', { expectedArgs: { refSlot: reportFields.refSlot } })
      })
    })

    context('checks ref slot', () => {
      it('should revert if incorrect ref slot', async () => {
        await consensus.setTime(deadline)
        const { refSlot } = await consensus.getCurrentFrame()

        const incorrectRefSlot = +refSlot + 1

        const newReportFields = {
          ...reportFields,
          refSlot: incorrectRefSlot
        }
        const reportItems = getReportDataItems(newReportFields)

        await assert.reverts(
          oracle.submitReportData(reportItems, oracleVersion, { from: member1 }),
          `UnexpectedRefSlot(${refSlot}, ${incorrectRefSlot})`
        )
      })

      it('should should allow calling if correct ref slot', async () => {
        await consensus.setTime(deadline)
        const { refSlot } = await consensus.getCurrentFrame()

        const nextRefSlot = +refSlot + SLOTS_PER_FRAME

        const newReportFields = {
          ...reportFields,
          refSlot: nextRefSlot
        }
        const reportItems = getReportDataItems(newReportFields)

        const reportHash = calcReportDataHash(reportItems)
        await consensus.advanceTimeToNextFrameStart()
        await consensus.submitReport(nextRefSlot, reportHash, CONSENSUS_VERSION, { from: member1 })

        const tx = await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
        assertEvent(tx, 'ProcessingStarted', { expectedArgs: { refSlot: newReportFields.refSlot } })
      })
    })

    context('checks consensus version', () => {
      it('should revert if incorrect consensus version', async () => {
        await consensus.setTime(deadline)

        const incorrectNextVersion = CONSENSUS_VERSION + 1
        const incorrectPrevVersion = CONSENSUS_VERSION + 1

        const newReportFields = {
          ...reportFields,
          consensusVersion: incorrectNextVersion
        }
        const reportItems = getReportDataItems(newReportFields)

        const reportFiledsPrevVersion = { ...reportFields, consensusVersion: incorrectPrevVersion }
        const reportItemsPrevVersion = getReportDataItems(reportFiledsPrevVersion)

        await assert.reverts(
          oracle.submitReportData(reportItems, oracleVersion, { from: member1 }),
          `UnexpectedConsensusVersion(${oracleVersion}, ${incorrectNextVersion})`
        )

        await assert.reverts(
          oracle.submitReportData(reportItemsPrevVersion, oracleVersion, { from: member1 }),
          `UnexpectedConsensusVersion(${oracleVersion}, ${incorrectPrevVersion})`
        )
      })

      it('should should allow calling if correct consensus version', async () => {
        await consensus.setTime(deadline)
        const { refSlot } = await consensus.getCurrentFrame()

        const tx = await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
        assertEvent(tx, 'ProcessingStarted', { expectedArgs: { refSlot: reportFields.refSlot } })

        const newConsensusVersion = CONSENSUS_VERSION + 1
        const nextRefSlot = +refSlot + SLOTS_PER_FRAME
        const newReportFields = {
          ...reportFields,
          refSlot: nextRefSlot,
          consensusVersion: newConsensusVersion
        }
        const newReportItems = getReportDataItems(newReportFields)
        const newReportHash = calcReportDataHash(newReportItems)

        await oracle.setConsensusVersion(newConsensusVersion, { from: admin })
        await consensus.advanceTimeToNextFrameStart()
        await consensus.submitReport(newReportFields.refSlot, newReportHash, newConsensusVersion, { from: member1 })

        const txNewVersion = await oracle.submitReportData(newReportItems, oracleVersion, { from: member1 })
        assertEvent(txNewVersion, 'ProcessingStarted', { expectedArgs: { refSlot: newReportFields.refSlot } })
      })
    })

    context('checks data cache', () => {
      it('reverts with UnexpectedDataHash', async () => {
        const incorrectReportItems = getReportDataItems({
          ...reportFields,
          numValidators: reportFields.numValidators - 1
        })

        const correctDataHash = calcReportDataHash(reportItems)
        const incorrectDataHash = calcReportDataHash(incorrectReportItems)

        await assert.reverts(
          oracle.submitReportData(incorrectReportItems, oracleVersion, { from: member1 }),
          `UnexpectedDataHash("${correctDataHash}", "${incorrectDataHash}")`
        )
      })
    })
  })
})
