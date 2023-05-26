const { contract, web3, ethers } = require('hardhat')
const { assert } = require('../../helpers/assert')
const { e9, e18, e27, toNum } = require('../../helpers/utils')
const { EvmSnapshot } = require('../../helpers/blockchain')

const AccountingOracleAbi = require('../../../lib/abi/AccountingOracle.json')

const {
  CONSENSUS_VERSION,
  deployAndConfigureAccountingOracle,
  getAccountingReportDataItems,
  encodeExtraDataItems,
  packExtraDataList,
  calcExtraDataListHash,
  calcAccountingReportDataHash,
  EXTRA_DATA_FORMAT_LIST,
  EXTRA_DATA_FORMAT_EMPTY,
  SLOTS_PER_FRAME,
  SECONDS_PER_SLOT,
  GENESIS_TIME,
  ZERO_HASH,
  HASH_1,
} = require('./accounting-oracle-deploy.test')

contract('AccountingOracle', ([admin, member1, member2]) => {
  let consensus = null
  let oracle = null
  let reportItems = null
  let reportFields = null
  let reportHash = null
  let extraDataList = null
  let extraDataHash = null
  let extraDataItems = null
  let oracleVersion = null
  let deadline = null
  let mockStakingRouter = null
  let extraData = null
  let mockLido = null
  let oracleReportSanityChecker = null
  let mockLegacyOracle = null
  let mockWithdrawalQueue = null
  let snapshot = null

  const getReportFields = (override = {}) => ({
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
    extraDataHash,
    extraDataItemsCount: extraDataItems.length,
    ...override,
  })

  const deploy = async (options = undefined) => {
    snapshot = new EvmSnapshot(ethers.provider)
    const deployed = await deployAndConfigureAccountingOracle(admin)
    const { refSlot } = await deployed.consensus.getCurrentFrame()

    extraData = {
      stuckKeys: [
        { moduleId: 1, nodeOpIds: [0], keysCounts: [1] },
        { moduleId: 2, nodeOpIds: [0], keysCounts: [2] },
        { moduleId: 3, nodeOpIds: [2], keysCounts: [3] },
      ],
      exitedKeys: [
        { moduleId: 2, nodeOpIds: [1, 2], keysCounts: [1, 3] },
        { moduleId: 3, nodeOpIds: [1], keysCounts: [2] },
      ],
    }

    extraDataItems = encodeExtraDataItems(extraData)
    extraDataList = packExtraDataList(extraDataItems)
    extraDataHash = calcExtraDataListHash(extraDataList)
    reportFields = getReportFields({
      refSlot: +refSlot,
    })
    reportItems = getAccountingReportDataItems(reportFields)
    reportHash = calcAccountingReportDataHash(reportItems)
    await deployed.consensus.addMember(member1, 1, { from: admin })
    await deployed.consensus.submitReport(refSlot, reportHash, CONSENSUS_VERSION, { from: member1 })

    oracleVersion = +(await deployed.oracle.getContractVersion())
    deadline = (await deployed.oracle.getConsensusReport()).processingDeadlineTime

    oracle = deployed.oracle
    consensus = deployed.consensus
    mockStakingRouter = deployed.stakingRouter
    mockLido = deployed.lido
    oracleReportSanityChecker = deployed.oracleReportSanityChecker
    mockLegacyOracle = deployed.legacyOracle
    mockWithdrawalQueue = deployed.withdrawalQueue

    await snapshot.make()
  }

  async function rollback() {
    await snapshot.rollback()
  }

  async function prepareNextReport(newReportFields) {
    await consensus.setTime(deadline)

    const newReportItems = getAccountingReportDataItems(newReportFields)
    const reportHash = calcAccountingReportDataHash(newReportItems)

    await consensus.advanceTimeToNextFrameStart()
    await consensus.submitReport(newReportFields.refSlot, reportHash, CONSENSUS_VERSION, { from: member1 })

    return {
      newReportFields,
      newReportItems,
      reportHash,
    }
  }

  async function prepareNextReportInNextFrame(newReportFields) {
    const { refSlot } = await consensus.getCurrentFrame()
    const next = await prepareNextReport({
      ...newReportFields,
      refSlot: +refSlot + SLOTS_PER_FRAME,
    })
    return next
  }
  before(deploy)

  context('deploying', () => {
    after(rollback)

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
      assert.isNotNull(mockStakingRouter)
      assert.isNotNull(mockLido)
    })
  })

  context('discarded report prevents data submit', () => {
    after(rollback)

    it('report is discarded', async () => {
      const { refSlot } = await consensus.getCurrentFrame()
      const tx = await consensus.addMember(member2, 2, { from: admin })
      assert.emits(tx, 'ReportDiscarded', { refSlot, hash: reportHash }, { abi: AccountingOracleAbi })
    })

    it('processing state reverts to pre-report state ', async () => {
      const state = await oracle.getProcessingState()
      assert.equals(state.mainDataHash, ZERO_HASH)
      assert.equals(state.extraDataHash, ZERO_HASH)
      assert.equals(state.extraDataFormat, 0)
      assert.equals(state.mainDataSubmitted, false)
      assert.equals(state.extraDataFormat, 0)
      assert.equals(state.extraDataSubmitted, false)
      assert.equals(state.extraDataItemsCount, 0)
      assert.equals(state.extraDataItemsSubmitted, 0)
    })

    it('reverts on trying to submit the discarded report', async () => {
      await assert.reverts(oracle.submitReportData(reportItems, oracleVersion, { from: member1 }))
    })
  })

  context('submitReportData', () => {
    afterEach(rollback)

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
        assert.emits(tx, 'ProcessingStarted', { refSlot: reportFields.refSlot })
      })
    })

    context('checks ref slot', () => {
      it('should revert if incorrect ref slot', async () => {
        await consensus.setTime(deadline)
        const { refSlot } = await consensus.getCurrentFrame()

        const incorrectRefSlot = +refSlot + 1

        const newReportFields = {
          ...reportFields,
          refSlot: incorrectRefSlot,
        }
        const reportItems = getAccountingReportDataItems(newReportFields)

        await assert.reverts(
          oracle.submitReportData(reportItems, oracleVersion, { from: member1 }),
          `UnexpectedRefSlot(${refSlot}, ${incorrectRefSlot})`
        )
      })

      it('should should allow calling if correct ref slot', async () => {
        await consensus.setTime(deadline)
        const { newReportFields, newReportItems } = await prepareNextReportInNextFrame({ ...reportFields })
        const tx = await oracle.submitReportData(newReportItems, oracleVersion, { from: member1 })
        assert.emits(tx, 'ProcessingStarted', { refSlot: newReportFields.refSlot })
      })
    })

    context('only allows submitting main data for the same ref. slot once', () => {
      it('reverts on trying to submit the second time', async () => {
        const tx = await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
        assert.emits(tx, 'ProcessingStarted', { refSlot: reportFields.refSlot })

        await assert.reverts(
          oracle.submitReportData(reportItems, oracleVersion, { from: member1 }),
          'RefSlotAlreadyProcessing()'
        )
      })
    })

    context('checks consensus version', () => {
      it('should revert if incorrect consensus version', async () => {
        await consensus.setTime(deadline)

        const incorrectNextVersion = CONSENSUS_VERSION + 1
        const incorrectPrevVersion = CONSENSUS_VERSION + 1

        const newReportFields = {
          ...reportFields,
          consensusVersion: incorrectNextVersion,
        }
        const reportItems = getAccountingReportDataItems(newReportFields)

        const reportFieldsPrevVersion = { ...reportFields, consensusVersion: incorrectPrevVersion }
        const reportItemsPrevVersion = getAccountingReportDataItems(reportFieldsPrevVersion)

        await assert.reverts(
          oracle.submitReportData(reportItems, oracleVersion, { from: member1 }),
          `UnexpectedConsensusVersion(${oracleVersion}, ${incorrectNextVersion})`
        )

        await assert.reverts(
          oracle.submitReportData(reportItemsPrevVersion, oracleVersion, { from: member1 }),
          `UnexpectedConsensusVersion(${oracleVersion}, ${incorrectPrevVersion})`
        )
      })

      it('should allow calling if correct consensus version', async () => {
        await consensus.setTime(deadline)
        const { refSlot } = await consensus.getCurrentFrame()

        const tx = await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
        assert.emits(tx, 'ProcessingStarted', { refSlot: reportFields.refSlot })

        const newConsensusVersion = CONSENSUS_VERSION + 1
        const nextRefSlot = +refSlot + SLOTS_PER_FRAME
        const newReportFields = {
          ...reportFields,
          refSlot: nextRefSlot,
          consensusVersion: newConsensusVersion,
        }
        const newReportItems = getAccountingReportDataItems(newReportFields)
        const newReportHash = calcAccountingReportDataHash(newReportItems)

        await oracle.setConsensusVersion(newConsensusVersion, { from: admin })
        await consensus.advanceTimeToNextFrameStart()
        await consensus.submitReport(newReportFields.refSlot, newReportHash, newConsensusVersion, { from: member1 })

        const txNewVersion = await oracle.submitReportData(newReportItems, oracleVersion, { from: member1 })
        assert.emits(txNewVersion, 'ProcessingStarted', { refSlot: newReportFields.refSlot })
      })
    })

    context('enforces module ids sorting order', () => {
      beforeEach(deploy)

      it('should revert if incorrect stakingModuleIdsWithNewlyExitedValidators order (when next number in list is less than previous)', async () => {
        const { newReportItems } = await prepareNextReportInNextFrame({
          ...reportFields,
          stakingModuleIdsWithNewlyExitedValidators: [2, 1],
          numExitedValidatorsByStakingModule: [3, 4],
        })

        await assert.reverts(
          oracle.submitReportData(newReportItems, oracleVersion, { from: member1 }),
          'InvalidExitedValidatorsData()'
        )
      })

      it('should revert if incorrect stakingModuleIdsWithNewlyExitedValidators order (when next number in list equals to previous)', async () => {
        const { newReportItems } = await prepareNextReportInNextFrame({
          ...reportFields,
          stakingModuleIdsWithNewlyExitedValidators: [1, 1],
          numExitedValidatorsByStakingModule: [3, 4],
        })

        await assert.reverts(
          oracle.submitReportData(newReportItems, oracleVersion, { from: member1 }),
          'InvalidExitedValidatorsData()'
        )
      })

      it('should should allow calling if correct extra data list moduleId', async () => {
        const { newReportFields, newReportItems } = await prepareNextReportInNextFrame({
          ...reportFields,
          stakingModuleIdsWithNewlyExitedValidators: [1, 2],
          numExitedValidatorsByStakingModule: [3, 4],
        })

        const tx = await oracle.submitReportData(newReportItems, oracleVersion, { from: member1 })
        assert.emits(tx, 'ProcessingStarted', { refSlot: newReportFields.refSlot })
      })
    })

    context('checks data hash', () => {
      it('reverts with UnexpectedDataHash', async () => {
        const incorrectReportItems = getAccountingReportDataItems({
          ...reportFields,
          numValidators: reportFields.numValidators - 1,
        })

        const correctDataHash = calcAccountingReportDataHash(reportItems)
        const incorrectDataHash = calcAccountingReportDataHash(incorrectReportItems)

        await assert.reverts(
          oracle.submitReportData(incorrectReportItems, oracleVersion, { from: member1 }),
          `UnexpectedDataHash("${correctDataHash}", "${incorrectDataHash}")`
        )
      })

      it('submits if data successfully pass hash validation', async () => {
        const tx = await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
        assert.emits(tx, 'ProcessingStarted', { refSlot: reportFields.refSlot })
      })
    })

    context('enforces data safety boundaries', () => {
      it('reverts with MaxAccountingExtraDataItemsCountExceeded if data limit exceeds', async () => {
        const MAX_ACCOUNTING_EXTRA_DATA_LIMIT = 1
        await oracleReportSanityChecker.setMaxAccountingExtraDataListItemsCount(MAX_ACCOUNTING_EXTRA_DATA_LIMIT, {
          from: admin,
        })

        assert.equals(
          (await oracleReportSanityChecker.getOracleReportLimits()).maxAccountingExtraDataListItemsCount,
          MAX_ACCOUNTING_EXTRA_DATA_LIMIT
        )

        await assert.reverts(
          oracle.submitReportData(reportItems, oracleVersion, { from: member1 }),
          `MaxAccountingExtraDataItemsCountExceeded(${MAX_ACCOUNTING_EXTRA_DATA_LIMIT}, ${reportFields.extraDataItemsCount})`
        )
      })

      it('passes fine on borderline data limit value — when it equals to count of passed items', async () => {
        const MAX_ACCOUNTING_EXTRA_DATA_LIMIT = reportFields.extraDataItemsCount

        await oracleReportSanityChecker.setMaxAccountingExtraDataListItemsCount(MAX_ACCOUNTING_EXTRA_DATA_LIMIT, {
          from: admin,
        })

        assert.equals(
          (await oracleReportSanityChecker.getOracleReportLimits()).maxAccountingExtraDataListItemsCount,
          MAX_ACCOUNTING_EXTRA_DATA_LIMIT
        )

        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
      })

      it('reverts with InvalidExitedValidatorsData if counts of stakingModuleIds and numExitedValidatorsByStakingModule does not match', async () => {
        const { newReportItems } = await prepareNextReportInNextFrame({
          ...reportFields,
          stakingModuleIdsWithNewlyExitedValidators: [1, 2],
          numExitedValidatorsByStakingModule: [3],
        })
        await assert.reverts(
          oracle.submitReportData(newReportItems, oracleVersion, { from: member1 }),
          'InvalidExitedValidatorsData()'
        )
      })

      it('reverts with InvalidExitedValidatorsData if any record for number of exited validators equals 0', async () => {
        const { newReportItems } = await prepareNextReportInNextFrame({
          ...reportFields,
          stakingModuleIdsWithNewlyExitedValidators: [1, 2],
          numExitedValidatorsByStakingModule: [3, 0],
        })
        await assert.reverts(
          oracle.submitReportData(newReportItems, oracleVersion, { from: member1 }),
          'InvalidExitedValidatorsData()'
        )
      })

      it('reverts with ExitedValidatorsLimitExceeded if exited validators rate limit will be reached', async () => {
        // Really simple test here for now
        // TODO: Come up with more tests for better coverage of edge-case scenarios that can be accrued
        //       during calculation `exitedValidatorsPerDay` rate in AccountingOracle:612
        const totalExitedValidators = reportFields.numExitedValidatorsByStakingModule.reduce(
          (sum, curr) => sum + curr,
          0
        )
        const exitingRateLimit = totalExitedValidators - 1
        await oracleReportSanityChecker.setChurnValidatorsPerDayLimit(exitingRateLimit)
        assert.equals(
          (await oracleReportSanityChecker.getOracleReportLimits()).churnValidatorsPerDayLimit,
          exitingRateLimit
        )
        await assert.reverts(
          oracle.submitReportData(reportItems, oracleVersion, { from: member1 }),
          `ExitedValidatorsLimitExceeded(${exitingRateLimit}, ${totalExitedValidators})`
        )
      })
    })

    context('delivers the data to corresponded contracts', () => {
      it('should call handleOracleReport on Lido', async () => {
        assert.equals((await mockLido.getLastCall_handleOracleReport()).callCount, 0)
        await consensus.setTime(deadline)
        const tx = await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
        assert.emits(tx, 'ProcessingStarted', { refSlot: reportFields.refSlot })

        const lastOracleReportToLido = await mockLido.getLastCall_handleOracleReport()

        assert.equals(lastOracleReportToLido.callCount, 1)
        assert.equals(
          lastOracleReportToLido.currentReportTimestamp,
          GENESIS_TIME + reportFields.refSlot * SECONDS_PER_SLOT
        )

        assert.equals(lastOracleReportToLido.clBalance, reportFields.clBalanceGwei + '000000000')
        assert.equals(lastOracleReportToLido.withdrawalVaultBalance, reportFields.withdrawalVaultBalance)
        assert.equals(lastOracleReportToLido.elRewardsVaultBalance, reportFields.elRewardsVaultBalance)
        assert.sameOrderedMembers(
          toNum(lastOracleReportToLido.withdrawalFinalizationBatches),
          toNum(reportFields.withdrawalFinalizationBatches)
        )
        assert.equals(lastOracleReportToLido.simulatedShareRate, reportFields.simulatedShareRate)
      })

      it('should call updateExitedValidatorsCountByStakingModule on StakingRouter', async () => {
        assert.equals((await mockStakingRouter.lastCall_updateExitedKeysByModule()).callCount, 0)
        await consensus.setTime(deadline)
        const tx = await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
        assert.emits(tx, 'ProcessingStarted', { refSlot: reportFields.refSlot })

        const lastOracleReportToStakingRouter = await mockStakingRouter.lastCall_updateExitedKeysByModule()

        assert.equals(lastOracleReportToStakingRouter.callCount, 1)
        assert.equals(lastOracleReportToStakingRouter.moduleIds, reportFields.stakingModuleIdsWithNewlyExitedValidators)
        assert.equals(lastOracleReportToStakingRouter.exitedKeysCounts, reportFields.numExitedValidatorsByStakingModule)
      })

      it('does not calling StakingRouter.updateExitedKeysByModule if lists of exited validators is empty', async () => {
        const { newReportItems, newReportFields } = await prepareNextReportInNextFrame({
          ...reportFields,
          stakingModuleIdsWithNewlyExitedValidators: [],
          numExitedValidatorsByStakingModule: [],
        })
        const tx = await oracle.submitReportData(newReportItems, oracleVersion, { from: member1 })
        assert.emits(tx, 'ProcessingStarted', { refSlot: newReportFields.refSlot })
        const lastOracleReportToStakingRouter = await mockStakingRouter.lastCall_updateExitedKeysByModule()
        assert.equals(lastOracleReportToStakingRouter.callCount, 0)
      })

      it('should call handleConsensusLayerReport on legacyOracle', async () => {
        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
        const lastCall = await mockLegacyOracle.lastCall__handleConsensusLayerReport()
        assert.equals(lastCall.totalCalls, 1)
        assert.equals(lastCall.refSlot, reportFields.refSlot)
        assert.equals(lastCall.clBalance, e9(reportFields.clBalanceGwei))
        assert.equals(lastCall.clValidators, reportFields.numValidators)
      })

      it('should call onOracleReport on WithdrawalQueue', async () => {
        const prevProcessingRefSlot = +(await oracle.getLastProcessingRefSlot())
        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
        const currentProcessingRefSlot = +(await oracle.getLastProcessingRefSlot())
        const lastCall = await mockWithdrawalQueue.lastCall__onOracleReport()
        assert.equals(lastCall.callCount, 1)
        assert.equals(lastCall.isBunkerMode, reportFields.isBunkerMode)
        assert.equals(lastCall.prevReportTimestamp, GENESIS_TIME + prevProcessingRefSlot * SECONDS_PER_SLOT)
        assert.equals(lastCall.currentReportTimestamp, GENESIS_TIME + currentProcessingRefSlot * SECONDS_PER_SLOT)
      })
    })

    context('warns when prev extra data has not been processed yet', () => {
      it('emits WarnExtraDataIncompleteProcessing', async () => {
        await consensus.setTime(deadline)
        const prevRefSlot = +(await consensus.getCurrentFrame()).refSlot
        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
        await consensus.advanceTimeToNextFrameStart()
        const nextRefSlot = +(await consensus.getCurrentFrame()).refSlot
        const tx = await consensus.submitReport(nextRefSlot, HASH_1, CONSENSUS_VERSION, { from: member1 })
        assert.emits(
          tx,
          'WarnExtraDataIncompleteProcessing',
          {
            refSlot: prevRefSlot,
            processedItemsCount: 0,
            itemsCount: extraDataItems.length,
          },
          { abi: AccountingOracleAbi }
        )
      })
    })

    context('enforces extra data format', () => {
      it('should revert on invalid extra data format', async () => {
        await consensus.setTime(deadline)
        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })

        const nextRefSlot = reportFields.refSlot + SLOTS_PER_FRAME
        const changedReportItems = getAccountingReportDataItems({
          ...reportFields,
          refSlot: nextRefSlot,
          extraDataFormat: EXTRA_DATA_FORMAT_LIST + 1,
        })

        const changedReportHash = calcAccountingReportDataHash(changedReportItems)
        await consensus.advanceTimeToNextFrameStart()
        await consensus.submitReport(nextRefSlot, changedReportHash, CONSENSUS_VERSION, {
          from: member1,
        })

        await assert.revertsWithCustomError(
          oracle.submitReportData(changedReportItems, oracleVersion, { from: member1 }),
          `UnsupportedExtraDataFormat(${EXTRA_DATA_FORMAT_LIST + 1})`
        )
      })

      it('should revert on non-empty format but zero length', async () => {
        await consensus.setTime(deadline)
        const { refSlot } = await consensus.getCurrentFrame()
        const reportFields = getReportFields({
          refSlot: +refSlot,
          extraDataItemsCount: 0,
        })
        const reportItems = getAccountingReportDataItems(reportFields)
        const reportHash = calcAccountingReportDataHash(reportItems)
        await consensus.submitReport(refSlot, reportHash, CONSENSUS_VERSION, { from: member1 })
        await assert.revertsWithCustomError(
          oracle.submitReportData(reportItems, oracleVersion, { from: member1 }),
          `ExtraDataItemsCountCannotBeZeroForNonEmptyData()`
        )
      })

      it('should revert on non-empty format but zero hash', async () => {
        await consensus.setTime(deadline)
        const { refSlot } = await consensus.getCurrentFrame()
        const reportFields = getReportFields({
          refSlot: +refSlot,
          extraDataHash: ZERO_HASH,
        })
        const reportItems = getAccountingReportDataItems(reportFields)
        const reportHash = calcAccountingReportDataHash(reportItems)
        await consensus.submitReport(refSlot, reportHash, CONSENSUS_VERSION, { from: member1 })
        await assert.revertsWithCustomError(
          oracle.submitReportData(reportItems, oracleVersion, { from: member1 }),
          `ExtraDataHashCannotBeZeroForNonEmptyData()`
        )
      })
    })

    context('enforces zero extraData fields for the empty format', () => {
      it('should revert for non empty ExtraDataHash', async () => {
        await consensus.setTime(deadline)
        const { refSlot } = await consensus.getCurrentFrame()
        const nonZeroHash = web3.utils.keccak256('nonZeroHash')
        const reportFields = getReportFields({
          refSlot: +refSlot,
          isBunkerMode: false,
          extraDataFormat: EXTRA_DATA_FORMAT_EMPTY,
          extraDataHash: nonZeroHash,
          extraDataItemsCount: 0,
        })
        const reportItems = getAccountingReportDataItems(reportFields)
        const reportHash = calcAccountingReportDataHash(reportItems)
        await consensus.submitReport(refSlot, reportHash, CONSENSUS_VERSION, { from: member1 })
        await assert.revertsWithCustomError(
          oracle.submitReportData(reportItems, oracleVersion, { from: member1 }),
          `UnexpectedExtraDataHash("${ZERO_HASH}", "${nonZeroHash}")`
        )
      })

      it('should revert for non zero ExtraDataLength', async () => {
        await consensus.setTime(deadline)
        const { refSlot } = await consensus.getCurrentFrame()
        const reportFields = getReportFields({
          refSlot: +refSlot,
          isBunkerMode: false,
          extraDataFormat: EXTRA_DATA_FORMAT_EMPTY,
          extraDataHash: ZERO_HASH,
          extraDataItemsCount: 10,
        })
        const reportItems = getAccountingReportDataItems(reportFields)
        const reportHash = calcAccountingReportDataHash(reportItems)
        await consensus.submitReport(refSlot, reportHash, CONSENSUS_VERSION, { from: member1 })
        await assert.revertsWithCustomError(
          oracle.submitReportData(reportItems, oracleVersion, { from: member1 }),
          `UnexpectedExtraDataItemsCount(0, 10)`
        )
      })
    })

    context('ExtraDataProcessingState', () => {
      it('should be empty from start', async () => {
        const data = await oracle.getExtraDataProcessingState()
        assert.equals(data.refSlot, '0')
        assert.equals(data.dataFormat, '0')
        assert.equals(data.itemsCount, '0')
        assert.equals(data.itemsProcessed, '0')
        assert.equals(data.lastSortingKey, '0')
        assert.equals(data.dataHash, ZERO_HASH)
      })

      it('should be filled with report data after submitting', async () => {
        await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
        const data = await oracle.getExtraDataProcessingState()
        assert.equals(data.refSlot, reportFields.refSlot)
        assert.equals(data.dataFormat, reportFields.extraDataFormat)
        assert.equals(data.itemsCount, reportFields.extraDataItemsCount)
        assert.equals(data.itemsProcessed, '0')
        assert.equals(data.lastSortingKey, '0')
        assert.equals(data.dataHash, reportFields.extraDataHash)
      })
    })
  })
})
