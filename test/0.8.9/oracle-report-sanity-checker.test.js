const { artifacts, contract, ethers } = require('hardhat')
const { ETH } = require('../helpers/utils')
const { assert } = require('../helpers/assert')
const { getCurrentBlockTimestamp } = require('../helpers/blockchain')

const mocksFilePath = 'contracts/0.8.9/test_helpers/OracleReportSanityCheckerMocks.sol'
const LidoStub = artifacts.require(`${mocksFilePath}:LidoStub`)
const OracleReportSanityChecker = artifacts.require('OracleReportSanityChecker')
const LidoLocatorStub = artifacts.require(`${mocksFilePath}:LidoLocatorStub`)
const WithdrawalQueueStub = artifacts.require(`${mocksFilePath}:WithdrawalQueueStub`)
const BurnerStub = artifacts.require(`${mocksFilePath}:BurnerStub`)

function wei(number, units = 'wei') {
  switch (units.toLowerCase()) {
    case 'wei':
      return BigInt(number)
    case 'eth':
    case 'ether':
      return BigInt(number) * 10n ** 18n
  }
  throw new Error(`Unsupported units "${units}"`)
}

contract('OracleReportSanityChecker', ([deployer, admin, withdrawalVault, elRewardsVault, ...accounts]) => {
  let oracleReportSanityChecker, lidoLocatorMock, lidoMock, withdrawalQueueMock, burnerMock
  const managersRoster = {
    allLimitsManagers: accounts.slice(0, 2),
    churnValidatorsPerDayLimitManagers: accounts.slice(2, 4),
    oneOffCLBalanceDecreaseLimitManagers: accounts.slice(4, 6),
    annualBalanceIncreaseLimitManagers: accounts.slice(6, 8),
    shareRateDeviationLimitManagers: accounts.slice(8, 10),
    maxValidatorExitRequestsPerReportManagers: accounts.slice(10, 12),
    maxAccountingExtraDataListItemsCountManagers: accounts.slice(12, 14),
    maxNodeOperatorsPerExtraDataItemCountManagers: accounts.slice(14, 16),
    requestTimestampMarginManagers: accounts.slice(16, 18),
    maxPositiveTokenRebaseManagers: accounts.slice(18, 20),
  }
  const defaultLimitsList = {
    churnValidatorsPerDayLimit: 55,
    oneOffCLBalanceDecreaseBPLimit: 5_00, // 5%
    annualBalanceIncreaseBPLimit: 10_00, // 10%
    simulatedShareRateDeviationBPLimit: 2_50, // 2.5%
    maxValidatorExitRequestsPerReport: 2000,
    maxAccountingExtraDataListItemsCount: 15,
    maxNodeOperatorsPerExtraDataItemCount: 16,
    requestTimestampMargin: 128,
    maxPositiveTokenRebase: 5_000_000, // 0.05%
  }
  const correctLidoOracleReport = {
    timeElapsed: 24 * 60 * 60,
    preCLBalance: ETH(100_000),
    postCLBalance: ETH(100_001),
    withdrawalVaultBalance: 0,
    elRewardsVaultBalance: 0,
    sharesRequestedToBurn: 0,
    preCLValidators: 0,
    postCLValidators: 0,
  }

  before(async () => {
    // mine 1024 blocks with block duration 12 seconds
    await ethers.provider.send('hardhat_mine', ['0x' + Number(1024).toString(16), '0x' + Number(12).toString(16)])
    lidoMock = await LidoStub.new({ from: deployer })
    withdrawalQueueMock = await WithdrawalQueueStub.new({ from: deployer })
    burnerMock = await BurnerStub.new({ from: deployer })
    lidoLocatorMock = await LidoLocatorStub.new(
      lidoMock.address,
      withdrawalVault,
      withdrawalQueueMock.address,
      elRewardsVault,
      burnerMock.address,
      { from: deployer }
    )

    oracleReportSanityChecker = await OracleReportSanityChecker.new(
      lidoLocatorMock.address,
      admin,
      Object.values(defaultLimitsList),
      Object.values(managersRoster),
      {
        from: deployer,
      }
    )
  })

  describe('setOracleReportLimits()', () => {
    it('sets limits correctly', async () => {
      const newLimitsList = {
        churnValidatorsPerDayLimit: 50,
        oneOffCLBalanceDecreaseBPLimit: 10_00,
        annualBalanceIncreaseBPLimit: 15_00,
        simulatedShareRateDeviationBPLimit: 1_50, // 1.5%
        maxValidatorExitRequestsPerReport: 3000,
        maxAccountingExtraDataListItemsCount: 15 + 1,
        maxNodeOperatorsPerExtraDataItemCount: 16 + 1,
        requestTimestampMargin: 2048,
        maxPositiveTokenRebase: 10_000_000,
      }
      const limitsBefore = await oracleReportSanityChecker.getOracleReportLimits()
      assert.notEquals(limitsBefore.churnValidatorsPerDayLimit, newLimitsList.churnValidatorsPerDayLimit)
      assert.notEquals(limitsBefore.oneOffCLBalanceDecreaseBPLimit, newLimitsList.oneOffCLBalanceDecreaseBPLimit)
      assert.notEquals(limitsBefore.annualBalanceIncreaseBPLimit, newLimitsList.annualBalanceIncreaseBPLimit)
      assert.notEquals(
        limitsBefore.simulatedShareRateDeviationBPLimit,
        newLimitsList.simulatedShareRateDeviationBPLimit
      )
      assert.notEquals(limitsBefore.maxValidatorExitRequestsPerReport, newLimitsList.maxValidatorExitRequestsPerReport)
      assert.notEquals(
        limitsBefore.maxAccountingExtraDataListItemsCount,
        newLimitsList.maxAccountingExtraDataListItemsCount
      )
      assert.notEquals(
        limitsBefore.maxNodeOperatorsPerExtraDataItemCount,
        newLimitsList.maxNodeOperatorsPerExtraDataItemCount
      )
      assert.notEquals(limitsBefore.requestTimestampMargin, newLimitsList.requestTimestampMargin)
      assert.notEquals(limitsBefore.maxPositiveTokenRebase, newLimitsList.maxPositiveTokenRebase)

      await oracleReportSanityChecker.setOracleReportLimits(Object.values(newLimitsList), {
        from: managersRoster.allLimitsManagers[0],
      })

      const limitsAfter = await oracleReportSanityChecker.getOracleReportLimits()
      assert.equals(limitsAfter.churnValidatorsPerDayLimit, newLimitsList.churnValidatorsPerDayLimit)
      assert.equals(limitsAfter.oneOffCLBalanceDecreaseBPLimit, newLimitsList.oneOffCLBalanceDecreaseBPLimit)
      assert.equals(limitsAfter.annualBalanceIncreaseBPLimit, newLimitsList.annualBalanceIncreaseBPLimit)
      assert.equals(limitsAfter.simulatedShareRateDeviationBPLimit, newLimitsList.simulatedShareRateDeviationBPLimit)
      assert.equals(limitsAfter.maxValidatorExitRequestsPerReport, newLimitsList.maxValidatorExitRequestsPerReport)
      assert.equals(
        limitsAfter.maxAccountingExtraDataListItemsCount,
        newLimitsList.maxAccountingExtraDataListItemsCount
      )
      assert.equals(
        limitsAfter.maxNodeOperatorsPerExtraDataItemCount,
        newLimitsList.maxNodeOperatorsPerExtraDataItemCount
      )
      assert.equals(limitsAfter.requestTimestampMargin, newLimitsList.requestTimestampMargin)
      assert.equals(limitsAfter.maxPositiveTokenRebase, newLimitsList.maxPositiveTokenRebase)
    })
  })

  describe('checkAccountingOracleReport()', () => {
    beforeEach(async () => {
      await oracleReportSanityChecker.setOracleReportLimits(Object.values(defaultLimitsList), {
        from: managersRoster.allLimitsManagers[0],
      })
    })

    it('reverts with error IncorrectWithdrawalsVaultBalance() when actual withdrawal vault balance is less than passed', async () => {
      const currentWithdrawalVaultBalance = await ethers.provider.getBalance(withdrawalVault)
      await assert.revertsWithCustomError(
        oracleReportSanityChecker.checkAccountingOracleReport(
          ...Object.values({ ...correctLidoOracleReport, withdrawalVaultBalance: currentWithdrawalVaultBalance.add(1) })
        ),
        `IncorrectWithdrawalsVaultBalance(${currentWithdrawalVaultBalance.toString()})`
      )
    })

    it('reverts with error IncorrectELRewardsVaultBalance() when actual el rewards vault balance is less than passed', async () => {
      const currentELRewardsVaultBalance = await ethers.provider.getBalance(elRewardsVault)
      await assert.revertsWithCustomError(
        oracleReportSanityChecker.checkAccountingOracleReport(
          ...Object.values({ ...correctLidoOracleReport, elRewardsVaultBalance: currentELRewardsVaultBalance.add(1) })
        ),
        `IncorrectELRewardsVaultBalance(${currentELRewardsVaultBalance.toString()})`
      )
    })

    it('reverts with error IncorrectCLBalanceDecrease() when one off CL balance decrease more than limit', async () => {
      const maxBasisPoints = 10_000n
      const preCLBalance = wei(100_000, 'eth')
      const postCLBalance = wei(85_000, 'eth')
      const withdrawalVaultBalance = wei(500, 'eth')
      const unifiedPostCLBalance = postCLBalance + withdrawalVaultBalance
      const oneOffCLBalanceDecreaseBP = (maxBasisPoints * (preCLBalance - unifiedPostCLBalance)) / preCLBalance
      await assert.revertsWithCustomError(
        oracleReportSanityChecker.checkAccountingOracleReport(
          ...Object.values({
            ...correctLidoOracleReport,
            preCLBalance: preCLBalance.toString(),
            postCLBalance: postCLBalance.toString(),
            withdrawalVaultBalance: withdrawalVaultBalance.toString(),
          })
        ),
        `IncorrectCLBalanceDecrease(${oneOffCLBalanceDecreaseBP.toString()})`
      )
    })

    it('reverts with error IncorrectCLBalanceIncrease() when reported values overcome annual CL balance limit', async () => {
      const maxBasisPoints = 10_000n
      const secondsInOneYear = 365n * 24n * 60n * 60n
      const preCLBalance = BigInt(correctLidoOracleReport.preCLBalance)
      const postCLBalance = wei(150_000, 'eth')
      const timeElapsed = BigInt(correctLidoOracleReport.timeElapsed)
      const annualBalanceIncrease =
        (secondsInOneYear * maxBasisPoints * (postCLBalance - preCLBalance)) / preCLBalance / timeElapsed
      await assert.revertsWithCustomError(
        oracleReportSanityChecker.checkAccountingOracleReport(
          ...Object.values({
            ...correctLidoOracleReport,
            postCLBalance: postCLBalance.toString(),
          })
        ),
        `IncorrectCLBalanceIncrease(${annualBalanceIncrease.toString()})`
      )
    })

    it('passes all checks with correct oracle report data', async () => {
      await oracleReportSanityChecker.checkAccountingOracleReport(...Object.values(correctLidoOracleReport))
    })

    it('set maxAccountingExtraDataListItemsCount', async () => {
      const previousValue = (await oracleReportSanityChecker.getOracleReportLimits())
        .maxAccountingExtraDataListItemsCount
      const newValue = 31
      assert.notEquals(newValue, previousValue)
      await oracleReportSanityChecker.setMaxAccountingExtraDataListItemsCount(newValue, {
        from: managersRoster.maxAccountingExtraDataListItemsCountManagers[0],
      })
      assert.equals(
        (await oracleReportSanityChecker.getOracleReportLimits()).maxAccountingExtraDataListItemsCount,
        newValue
      )
    })

    it('set maxNodeOperatorsPerExtraDataItemCount', async () => {
      const previousValue = (await oracleReportSanityChecker.getOracleReportLimits())
        .maxNodeOperatorsPerExtraDataItemCount
      const newValue = 33
      assert.notEquals(newValue, previousValue)
      await oracleReportSanityChecker.setMaxNodeOperatorsPerExtraDataItemCount(newValue, {
        from: managersRoster.maxNodeOperatorsPerExtraDataItemCountManagers[0],
      })
      assert.equals(
        (await oracleReportSanityChecker.getOracleReportLimits()).maxNodeOperatorsPerExtraDataItemCount,
        newValue
      )
    })
  })

  describe('checkWithdrawalQueueOracleReport()', async () => {
    const oldRequestId = 1
    const newRequestId = 2
    let oldRequestCreationTimestamp, newRequestCreationTimestamp
    const correctWithdrawalQueueOracleReport = {
      lastFinalizableRequestId: oldRequestId,
      refReportTimestamp: -1,
    }

    before(async () => {
      const currentBlockTimestamp = await getCurrentBlockTimestamp()
      correctWithdrawalQueueOracleReport.refReportTimestamp = currentBlockTimestamp
      oldRequestCreationTimestamp = currentBlockTimestamp - defaultLimitsList.requestTimestampMargin
      correctWithdrawalQueueOracleReport.lastFinalizableRequestId = oldRequestCreationTimestamp
      await withdrawalQueueMock.setRequestTimestamp(oldRequestId, oldRequestCreationTimestamp)
      newRequestCreationTimestamp = currentBlockTimestamp - Math.floor(defaultLimitsList.requestTimestampMargin / 2)
      await withdrawalQueueMock.setRequestTimestamp(newRequestId, newRequestCreationTimestamp)
    })

    it('reverts with the error IncorrectRequestFinalization() when the creation timestamp of requestIdToFinalizeUpTo is too close to report timestamp', async () => {
      await assert.revertsWithCustomError(
        oracleReportSanityChecker.checkWithdrawalQueueOracleReport(
          ...Object.values({
            ...correctWithdrawalQueueOracleReport,
            lastFinalizableRequestId: newRequestId,
          })
        ),
        `IncorrectRequestFinalization(${newRequestCreationTimestamp})`
      )
    })

    it('passes all checks with correct withdrawal queue report data', async () => {
      await oracleReportSanityChecker.checkWithdrawalQueueOracleReport(
        ...Object.values(correctWithdrawalQueueOracleReport)
      )
    })
  })

  describe('checkSimulatedShareRate', async () => {
    const correctSimulatedShareRate = {
      postTotalPooledEther: ETH(9),
      postTotalShares: ETH(4),
      etherLockedOnWithdrawalQueue: ETH(1),
      sharesBurntFromWithdrawalQueue: ETH(1),
      simulatedShareRate: (BigInt(2) * 10n ** 27n).toString(),
    }

    it('reverts with error IncorrectSimulatedShareRate() when reported and onchain share rate differs', async () => {
      const simulatedShareRate = BigInt(ETH(2.1)) * 10n ** 9n
      const actualShareRate = BigInt(2) * 10n ** 27n
      const deviation = (100_00n * (simulatedShareRate - actualShareRate)) / actualShareRate
      await assert.revertsWithCustomError(
        oracleReportSanityChecker.checkSimulatedShareRate(
          ...Object.values({
            ...correctSimulatedShareRate,
            simulatedShareRate: simulatedShareRate.toString(),
          })
        ),
        `IncorrectSimulatedShareRate(${deviation.toString()})`
      )
    })

    it('reverts with error IncorrectSimulatedShareRate() when actual share rate is zero', async () => {
      const deviation = 100_00n
      await assert.revertsWithCustomError(
        oracleReportSanityChecker.checkSimulatedShareRate(
          ...Object.values({
            ...correctSimulatedShareRate,
            etherLockedOnWithdrawalQueue: ETH(0),
            postTotalPooledEther: ETH(0),
          })
        ),
        `IncorrectSimulatedShareRate(${deviation.toString()})`
      )
    })

    it('passes all checks with correct share rate', async () => {
      await oracleReportSanityChecker.checkSimulatedShareRate(...Object.values(correctSimulatedShareRate))
    })
  })
})
