const { artifacts, contract, ethers } = require('hardhat')
const { ETH, ZERO_ADDRESS } = require('../helpers/utils')
const { assert } = require('../helpers/assert')
const { getCurrentBlockTimestamp, EvmSnapshot } = require('../helpers/blockchain')

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
  let oracleReportSanityChecker, lidoLocatorMock, lidoMock, withdrawalQueueMock, burnerMock, snapshot
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

    snapshot = new EvmSnapshot(ethers.provider)
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  it('constructor reverts if admin address is zero', async () => {
    await assert.reverts(
      OracleReportSanityChecker.new(
        lidoLocatorMock.address,
        ZERO_ADDRESS,
        Object.values(defaultLimitsList),
        Object.values(managersRoster),
        {
          from: deployer,
        }
      ),
      'AdminCannotBeZero()'
    )
  })

  describe('getLidoLocator()', () => {
    it('retrieves correct locator address', async () => {
      assert.equals(await oracleReportSanityChecker.getLidoLocator(), lidoLocatorMock.address)
    })
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

      await assert.revertsOZAccessControl(
        oracleReportSanityChecker.setOracleReportLimits(Object.values(newLimitsList), {
          from: deployer,
        }),
        deployer,
        'ALL_LIMITS_MANAGER_ROLE'
      )
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
      await assert.reverts(
        oracleReportSanityChecker.checkAccountingOracleReport(
          ...Object.values({ ...correctLidoOracleReport, withdrawalVaultBalance: currentWithdrawalVaultBalance.add(1) })
        ),
        `IncorrectWithdrawalsVaultBalance(${currentWithdrawalVaultBalance.toString()})`
      )
    })

    it('reverts with error IncorrectELRewardsVaultBalance() when actual el rewards vault balance is less than passed', async () => {
      const currentELRewardsVaultBalance = await ethers.provider.getBalance(elRewardsVault)
      await assert.reverts(
        oracleReportSanityChecker.checkAccountingOracleReport(
          ...Object.values({ ...correctLidoOracleReport, elRewardsVaultBalance: currentELRewardsVaultBalance.add(1) })
        ),
        `IncorrectELRewardsVaultBalance(${currentELRewardsVaultBalance.toString()})`
      )
    })

    it('reverts with error IncorrectSharesRequestedToBurn() when actual shares to burn is less than passed', async () => {
      await burnerMock.setSharesRequestedToBurn(10, 21)

      await assert.reverts(
        oracleReportSanityChecker.checkAccountingOracleReport(
          ...Object.values({ ...correctLidoOracleReport, sharesRequestedToBurn: 32 })
        ),
        `IncorrectSharesRequestedToBurn(31)`
      )
    })

    it('reverts with error IncorrectCLBalanceDecrease() when one off CL balance decrease more than limit', async () => {
      const maxBasisPoints = 10_000n
      const preCLBalance = wei(100_000, 'eth')
      const postCLBalance = wei(85_000, 'eth')
      const withdrawalVaultBalance = wei(500, 'eth')
      const unifiedPostCLBalance = postCLBalance + withdrawalVaultBalance
      const oneOffCLBalanceDecreaseBP = (maxBasisPoints * (preCLBalance - unifiedPostCLBalance)) / preCLBalance
      await assert.reverts(
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

      const postCLBalanceCorrect = wei(99_000, 'eth')
      await oracleReportSanityChecker.checkAccountingOracleReport(
        ...Object.values({
          ...correctLidoOracleReport,
          preCLBalance: preCLBalance.toString(),
          postCLBalance: postCLBalanceCorrect.toString(),
          withdrawalVaultBalance: withdrawalVaultBalance.toString(),
        })
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
      await assert.reverts(
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

    it('set one-off CL balance decrease', async () => {
      const previousValue = (await oracleReportSanityChecker.getOracleReportLimits()).oneOffCLBalanceDecreaseBPLimit
      const newValue = 3
      assert.notEquals(newValue, previousValue)
      await assert.revertsOZAccessControl(
        oracleReportSanityChecker.setOneOffCLBalanceDecreaseBPLimit(newValue, {
          from: deployer,
        }),
        deployer,
        'ONE_OFF_CL_BALANCE_DECREASE_LIMIT_MANAGER_ROLE'
      )
      const tx = await oracleReportSanityChecker.setOneOffCLBalanceDecreaseBPLimit(newValue, {
        from: managersRoster.oneOffCLBalanceDecreaseLimitManagers[0],
      })
      assert.equals((await oracleReportSanityChecker.getOracleReportLimits()).oneOffCLBalanceDecreaseBPLimit, newValue)
      assert.emits(tx, 'OneOffCLBalanceDecreaseBPLimitSet', { oneOffCLBalanceDecreaseBPLimit: newValue })
    })

    it('set annual balance increase', async () => {
      const previousValue = (await oracleReportSanityChecker.getOracleReportLimits()).annualBalanceIncreaseBPLimit
      const newValue = 9
      assert.notEquals(newValue, previousValue)
      await assert.revertsOZAccessControl(
        oracleReportSanityChecker.setAnnualBalanceIncreaseBPLimit(newValue, {
          from: deployer,
        }),
        deployer,
        'ANNUAL_BALANCE_INCREASE_LIMIT_MANAGER_ROLE'
      )
      const tx = await oracleReportSanityChecker.setAnnualBalanceIncreaseBPLimit(newValue, {
        from: managersRoster.annualBalanceIncreaseLimitManagers[0],
      })
      assert.equals((await oracleReportSanityChecker.getOracleReportLimits()).annualBalanceIncreaseBPLimit, newValue)
      assert.emits(tx, 'AnnualBalanceIncreaseBPLimitSet', { annualBalanceIncreaseBPLimit: newValue })
    })

    it('handles zero time passed for annual balance increase', async () => {
      const preCLBalance = BigInt(correctLidoOracleReport.preCLBalance)
      const postCLBalance = preCLBalance + 1000n

      await oracleReportSanityChecker.checkAccountingOracleReport(
        ...Object.values({
          ...correctLidoOracleReport,
          postCLBalance: postCLBalance.toString(),
          timeElapsed: 0,
        })
      )
    })

    it('handles zero pre CL balance estimating balance increase', async () => {
      const preCLBalance = BigInt(0)
      const postCLBalance = preCLBalance + 1000n

      await oracleReportSanityChecker.checkAccountingOracleReport(
        ...Object.values({
          ...correctLidoOracleReport,
          preCLBalance: preCLBalance.toString(),
          postCLBalance: postCLBalance.toString(),
        })
      )
    })

    it('handles zero time passed for appeared validators', async () => {
      const preCLValidators = BigInt(correctLidoOracleReport.preCLValidators)
      const postCLValidators = preCLValidators + 2n

      await oracleReportSanityChecker.checkAccountingOracleReport(
        ...Object.values({
          ...correctLidoOracleReport,
          preCLValidators: preCLValidators.toString(),
          postCLValidators: postCLValidators.toString(),
          timeElapsed: 0,
        })
      )
    })

    it('set simulated share rate deviation', async () => {
      const previousValue = (await oracleReportSanityChecker.getOracleReportLimits()).simulatedShareRateDeviationBPLimit
      const newValue = 7
      assert.notEquals(newValue, previousValue)
      await assert.revertsOZAccessControl(
        oracleReportSanityChecker.setSimulatedShareRateDeviationBPLimit(newValue, {
          from: deployer,
        }),
        deployer,
        'SHARE_RATE_DEVIATION_LIMIT_MANAGER_ROLE'
      )
      const tx = await oracleReportSanityChecker.setSimulatedShareRateDeviationBPLimit(newValue, {
        from: managersRoster.shareRateDeviationLimitManagers[0],
      })
      assert.equals(
        (await oracleReportSanityChecker.getOracleReportLimits()).simulatedShareRateDeviationBPLimit,
        newValue
      )
      assert.emits(tx, 'SimulatedShareRateDeviationBPLimitSet', { simulatedShareRateDeviationBPLimit: newValue })
    })
  })

  describe('checkWithdrawalQueueOracleReport()', () => {
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
      await assert.reverts(
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

    it('set timestamp margin for finalization', async () => {
      const previousValue = (await oracleReportSanityChecker.getOracleReportLimits()).requestTimestampMargin
      const newValue = 3302
      assert.notEquals(newValue, previousValue)
      await assert.revertsOZAccessControl(
        oracleReportSanityChecker.setRequestTimestampMargin(newValue, {
          from: deployer,
        }),
        deployer,
        'REQUEST_TIMESTAMP_MARGIN_MANAGER_ROLE'
      )
      const tx = await oracleReportSanityChecker.setRequestTimestampMargin(newValue, {
        from: managersRoster.requestTimestampMarginManagers[0],
      })
      assert.equals((await oracleReportSanityChecker.getOracleReportLimits()).requestTimestampMargin, newValue)
      assert.emits(tx, 'RequestTimestampMarginSet', { requestTimestampMargin: newValue })
    })
  })

  describe('checkSimulatedShareRate', () => {
    const correctSimulatedShareRate = {
      postTotalPooledEther: ETH(9),
      postTotalShares: ETH(4),
      etherLockedOnWithdrawalQueue: ETH(1),
      sharesBurntFromWithdrawalQueue: ETH(1),
      simulatedShareRate: (BigInt(2) * 10n ** 27n).toString(),
    }

    it('reverts with error IncorrectSimulatedShareRate() when simulated share rate is higher than expected', async () => {
      const simulatedShareRate = BigInt(ETH(2.1)) * 10n ** 9n
      const actualShareRate = BigInt(2) * 10n ** 27n
      await assert.reverts(
        oracleReportSanityChecker.checkSimulatedShareRate(
          ...Object.values({
            ...correctSimulatedShareRate,
            simulatedShareRate: simulatedShareRate.toString(),
          })
        ),
        `IncorrectSimulatedShareRate(${simulatedShareRate.toString()}, ${actualShareRate.toString()})`
      )
    })

    it('reverts with error IncorrectSimulatedShareRate() when simulated share rate is lower than expected', async () => {
      const simulatedShareRate = BigInt(ETH(1.9)) * 10n ** 9n
      const actualShareRate = BigInt(2) * 10n ** 27n
      await assert.reverts(
        oracleReportSanityChecker.checkSimulatedShareRate(
          ...Object.values({
            ...correctSimulatedShareRate,
            simulatedShareRate: simulatedShareRate.toString(),
          })
        ),
        `IncorrectSimulatedShareRate(${simulatedShareRate.toString()}, ${actualShareRate.toString()})`
      )
    })

    it('reverts with error ActualShareRateIsZero() when actual share rate is zero', async () => {
      await assert.reverts(
        oracleReportSanityChecker.checkSimulatedShareRate(
          ...Object.values({
            ...correctSimulatedShareRate,
            etherLockedOnWithdrawalQueue: ETH(0),
            postTotalPooledEther: ETH(0),
          })
        ),
        `ActualShareRateIsZero()`
      )
    })

    it('passes all checks with correct share rate', async () => {
      await oracleReportSanityChecker.checkSimulatedShareRate(...Object.values(correctSimulatedShareRate))
    })
  })

  describe('max positive rebase', () => {
    const defaultSmoothenTokenRebaseParams = {
      preTotalPooledEther: ETH(100),
      preTotalShares: ETH(100),
      preCLBalance: ETH(100),
      postCLBalance: ETH(100),
      withdrawalVaultBalance: 0,
      elRewardsVaultBalance: 0,
      sharesRequestedToBurn: 0,
      etherToLockForWithdrawals: 0,
      newSharesToBurnForWithdrawals: 0,
    }

    it('getMaxPositiveTokenRebase works', async () => {
      assert.equals(
        await oracleReportSanityChecker.getMaxPositiveTokenRebase(),
        defaultLimitsList.maxPositiveTokenRebase
      )
    })

    it('setMaxPositiveTokenRebase works', async () => {
      const newRebaseLimit = 1_000_000
      assert.notEquals(newRebaseLimit, defaultLimitsList.maxPositiveTokenRebase)

      await assert.revertsOZAccessControl(
        oracleReportSanityChecker.setMaxPositiveTokenRebase(newRebaseLimit, { from: deployer }),
        deployer,
        'MAX_POSITIVE_TOKEN_REBASE_MANAGER_ROLE'
      )

      const tx = await oracleReportSanityChecker.setMaxPositiveTokenRebase(newRebaseLimit, {
        from: managersRoster.maxPositiveTokenRebaseManagers[0],
      })

      assert.equals(await oracleReportSanityChecker.getMaxPositiveTokenRebase(), newRebaseLimit)
      assert.emits(tx, 'MaxPositiveTokenRebaseSet', { maxPositiveTokenRebase: newRebaseLimit })
    })

    it('all zero data works', async () => {
      const { withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultSmoothenTokenRebaseParams,
            preTotalPooledEther: 0,
            preTotalShares: 0,
            preCLBalance: 0,
            postCLBalance: 0,
          })
        )

      assert.equals(withdrawals, 0)
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, 0)
    })

    it('trivial smoothen rebase works when post CL < pre CL and no withdrawals', async () => {
      const newRebaseLimit = 100_000 // 0.01%
      await oracleReportSanityChecker.setMaxPositiveTokenRebase(newRebaseLimit, {
        from: managersRoster.maxPositiveTokenRebaseManagers[0],
      })

      let { withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({ ...defaultSmoothenTokenRebaseParams, postCLBalance: ETH(99) })
        )
      assert.equals(withdrawals, 0)
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, 0)
      // el rewards
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultSmoothenTokenRebaseParams,
            postCLBalance: ETH(99),
            elRewardsVaultBalance: ETH(0.1),
          })
        ))
      assert.equals(withdrawals, 0)
      assert.equals(elRewards, ETH(0.1))
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, 0)
      // withdrawals
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultSmoothenTokenRebaseParams,
            postCLBalance: ETH(99),
            withdrawalVaultBalance: ETH(0.1),
          })
        ))
      assert.equals(withdrawals, ETH(0.1))
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, 0)
      // shares requested to burn
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultSmoothenTokenRebaseParams,
            postCLBalance: ETH(99),
            sharesRequestedToBurn: ETH(0.1),
          })
        ))
      assert.equals(withdrawals, 0)
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, ETH(0.1))
      assert.equals(sharesToBurn, ETH(0.1))
    })

    it('trivial smoothen rebase works when post CL > pre CL and no withdrawals', async () => {
      const newRebaseLimit = 100_000_000 // 10%
      await oracleReportSanityChecker.setMaxPositiveTokenRebase(newRebaseLimit, {
        from: managersRoster.maxPositiveTokenRebaseManagers[0],
      })

      let { withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({ ...defaultSmoothenTokenRebaseParams, postCLBalance: ETH(100.01) })
        )
      assert.equals(withdrawals, 0)
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, 0)
      // el rewards
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultSmoothenTokenRebaseParams,
            postCLBalance: ETH(100.01),
            elRewardsVaultBalance: ETH(0.1),
          })
        ))
      assert.equals(withdrawals, 0)
      assert.equals(elRewards, ETH(0.1))
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, 0)
      // withdrawals
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultSmoothenTokenRebaseParams,
            postCLBalance: ETH(100.01),
            withdrawalVaultBalance: ETH(0.1),
          })
        ))
      assert.equals(withdrawals, ETH(0.1))
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, 0)
      // shares requested to burn
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultSmoothenTokenRebaseParams,
            postCLBalance: ETH(100.01),
            sharesRequestedToBurn: ETH(0.1),
          })
        ))
      assert.equals(withdrawals, 0)
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, ETH(0.1))
      assert.equals(sharesToBurn, ETH(0.1))
    })

    it('non-trivial smoothen rebase works when post CL < pre CL and no withdrawals', async () => {
      const newRebaseLimit = 10_000_000 // 1%
      await oracleReportSanityChecker.setMaxPositiveTokenRebase(newRebaseLimit, {
        from: managersRoster.maxPositiveTokenRebaseManagers[0],
      })

      let { withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({ ...defaultSmoothenTokenRebaseParams, postCLBalance: ETH(99) })
        )
      assert.equals(withdrawals, 0)
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, 0)
      // el rewards
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultSmoothenTokenRebaseParams,
            postCLBalance: ETH(99),
            elRewardsVaultBalance: ETH(5),
          })
        ))
      assert.equals(withdrawals, 0)
      assert.equals(elRewards, ETH(2))
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, 0)
      // withdrawals
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultSmoothenTokenRebaseParams,
            postCLBalance: ETH(99),
            withdrawalVaultBalance: ETH(5),
          })
        ))
      assert.equals(withdrawals, ETH(2))
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, 0)
      // withdrawals + el rewards
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultSmoothenTokenRebaseParams,
            postCLBalance: ETH(99),
            withdrawalVaultBalance: ETH(5),
            elRewardsVaultBalance: ETH(5),
          })
        ))
      assert.equals(withdrawals, ETH(2))
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, 0)
      // shares requested to burn
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultSmoothenTokenRebaseParams,
            postCLBalance: ETH(99),
            sharesRequestedToBurn: ETH(5),
          })
        ))
      assert.equals(withdrawals, 0)
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, '1980198019801980198') // ETH(100. - (99. / 1.01))
      assert.equals(sharesToBurn, '1980198019801980198') // the same as above since no withdrawals
    })

    it('non-trivial smoothen rebase works when post CL > pre CL and no withdrawals', async () => {
      const newRebaseLimit = 20_000_000 // 2%
      await oracleReportSanityChecker.setMaxPositiveTokenRebase(newRebaseLimit, {
        from: managersRoster.maxPositiveTokenRebaseManagers[0],
      })

      let { withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({ ...defaultSmoothenTokenRebaseParams, postCLBalance: ETH(101) })
        )
      assert.equals(withdrawals, 0)
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, 0)
      // el rewards
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultSmoothenTokenRebaseParams,
            postCLBalance: ETH(101),
            elRewardsVaultBalance: ETH(5),
          })
        ))
      assert.equals(withdrawals, 0)
      assert.equals(elRewards, ETH(1))
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, 0)
      // withdrawals
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultSmoothenTokenRebaseParams,
            postCLBalance: ETH(101),
            withdrawalVaultBalance: ETH(5),
          })
        ))
      assert.equals(withdrawals, ETH(1))
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, 0)
      // withdrawals + el rewards
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultSmoothenTokenRebaseParams,
            postCLBalance: ETH(101),
            elRewardsVaultBalance: ETH(5),
            withdrawalVaultBalance: ETH(5),
          })
        ))
      assert.equals(withdrawals, ETH(1))
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, 0)
      // shares requested to burn
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultSmoothenTokenRebaseParams,
            postCLBalance: ETH(101),
            sharesRequestedToBurn: ETH(5),
          })
        ))
      assert.equals(withdrawals, 0)
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, '980392156862745098') // ETH(100. - (101. / 1.02))
      assert.equals(sharesToBurn, '980392156862745098') // the same as above since no withdrawals
    })

    it('non-trivial smoothen rebase works when post CL < pre CL and withdrawals', async () => {
      const newRebaseLimit = 5_000_000 // 0.5%
      await oracleReportSanityChecker.setMaxPositiveTokenRebase(newRebaseLimit, {
        from: managersRoster.maxPositiveTokenRebaseManagers[0],
      })

      const defaultRebaseParams = {
        ...defaultSmoothenTokenRebaseParams,
        postCLBalance: ETH(99),
        etherToLockForWithdrawals: ETH(10),
        newSharesToBurnForWithdrawals: ETH(10),
      }

      let { withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(...Object.values(defaultRebaseParams))
      assert.equals(withdrawals, 0)
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, ETH(10))
      // el rewards
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultRebaseParams,
            elRewardsVaultBalance: ETH(5),
          })
        ))
      assert.equals(withdrawals, 0)
      assert.equals(elRewards, ETH(1.5))
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, '9950248756218905472') // 100. - 90.5 / 1.005
      // withdrawals
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultRebaseParams,
            withdrawalVaultBalance: ETH(5),
          })
        ))
      assert.equals(withdrawals, ETH(1.5))
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, '9950248756218905472') // 100. - 90.5 / 1.005
      // withdrawals + el rewards
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultRebaseParams,
            withdrawalVaultBalance: ETH(5),
            elRewardsVaultBalance: ETH(5),
          })
        ))
      assert.equals(withdrawals, ETH(1.5))
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, '9950248756218905472') // 100. - 90.5 / 1.005
      // shares requested to burn
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultRebaseParams,
            sharesRequestedToBurn: ETH(5),
          })
        ))
      assert.equals(withdrawals, 0)
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, '1492537313432835820') // ETH(100. - (99. / 1.005))
      assert.equals(sharesToBurn, '11442786069651741293') // ETH(100. - (89. / 1.005))
    })

    it('non-trivial smoothen rebase works when post CL > pre CL and withdrawals', async () => {
      const newRebaseLimit = 40_000_000 // 4%
      await oracleReportSanityChecker.setMaxPositiveTokenRebase(newRebaseLimit, {
        from: managersRoster.maxPositiveTokenRebaseManagers[0],
      })

      const defaultRebaseParams = {
        ...defaultSmoothenTokenRebaseParams,
        postCLBalance: ETH(102),
        etherToLockForWithdrawals: ETH(10),
        newSharesToBurnForWithdrawals: ETH(10),
      }

      let { withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(...Object.values(defaultRebaseParams))
      assert.equals(withdrawals, 0)
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, ETH(10))
      // el rewards
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultRebaseParams,
            elRewardsVaultBalance: ETH(5),
          })
        ))
      assert.equals(withdrawals, 0)
      assert.equals(elRewards, ETH(2))
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, '9615384615384615384') // 100. - 94. / 1.04
      // withdrawals
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultRebaseParams,
            withdrawalVaultBalance: ETH(5),
          })
        ))
      assert.equals(withdrawals, ETH(2))
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, '9615384615384615384') // 100. - 94. / 1.04
      // withdrawals + el rewards
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultRebaseParams,
            withdrawalVaultBalance: ETH(5),
            elRewardsVaultBalance: ETH(5),
          })
        ))
      assert.equals(withdrawals, ETH(2))
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, 0)
      assert.equals(sharesToBurn, '9615384615384615384') // 100. - 94. / 1.04
      // shares requested to burn
      ;({ withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(
          ...Object.values({
            ...defaultRebaseParams,
            sharesRequestedToBurn: ETH(5),
          })
        ))
      assert.equals(withdrawals, 0)
      assert.equals(elRewards, 0)
      assert.equals(simulatedSharesToBurn, '1923076923076923076') // ETH(100. - (102. / 1.04))
      assert.equals(sharesToBurn, '11538461538461538461') // ETH(100. - (92. / 1.04))
    })

    it('share rate ~1 case with huge withdrawal', async () => {
      const newRebaseLimit = 1_000_000 // 0.1%
      await oracleReportSanityChecker.setMaxPositiveTokenRebase(newRebaseLimit, {
        from: managersRoster.maxPositiveTokenRebaseManagers[0],
      })

      const rebaseParams = {
        preTotalPooledEther: ETH('1000000'),
        preTotalShares: ETH('1000000'),
        preCLBalance: ETH('1000000'),
        postCLBalance: ETH('1000000'),
        withdrawalVaultBalance: ETH(500),
        elRewardsVaultBalance: ETH(500),
        sharesRequestedToBurn: ETH(0),
        etherToLockForWithdrawals: ETH(40000),
        newSharesToBurnForWithdrawals: ETH(40000),
      }

      const { withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(...Object.values(rebaseParams))

      assert.equals(withdrawals, ETH(500))
      assert.equals(elRewards, ETH(500))
      assert.equals(simulatedSharesToBurn, ETH(0))
      assert.equals(sharesToBurn, '39960039960039960039960') // ETH(1000000 - 961000. / 1.001)
    })

    it('rounding case from Görli', async () => {
      const newRebaseLimit = 750_000 // 0.075% or 7.5 basis points
      await oracleReportSanityChecker.setMaxPositiveTokenRebase(newRebaseLimit, {
        from: managersRoster.maxPositiveTokenRebaseManagers[0],
      })

      const rebaseParams = {
        preTotalPooledEther: '125262263468962792235936',
        preTotalShares: '120111767594397261197918',
        preCLBalance: '113136253352529000000000',
        postCLBalance: '113134996436274000000000',
        withdrawalVaultBalance: '129959459000000000',
        elRewardsVaultBalance: '6644376444653811679390',
        sharesRequestedToBurn: '15713136097768852533',
        etherToLockForWithdrawals: '0',
        newSharesToBurnForWithdrawals: '0',
      }

      const { withdrawals, elRewards, simulatedSharesToBurn, sharesToBurn } =
        await oracleReportSanityChecker.smoothenTokenRebase(...Object.values(rebaseParams))

      assert.equals(withdrawals, '129959459000000000')
      assert.equals(elRewards, '95073654397722094176')
      assert.equals(simulatedSharesToBurn, '0')
      assert.equals(sharesToBurn, '0')
    })
  })

  describe('churn limit', () => {
    it('setChurnValidatorsPerDayLimit works', async () => {
      const oldChurnLimit = defaultLimitsList.churnValidatorsPerDayLimit
      await oracleReportSanityChecker.checkExitedValidatorsRatePerDay(oldChurnLimit)
      await assert.reverts(
        oracleReportSanityChecker.checkExitedValidatorsRatePerDay(oldChurnLimit + 1),
        `ExitedValidatorsLimitExceeded(${oldChurnLimit}, ${oldChurnLimit + 1})`
      )
      assert.equals((await oracleReportSanityChecker.getOracleReportLimits()).churnValidatorsPerDayLimit, oldChurnLimit)

      const newChurnLimit = 30
      assert.notEquals(newChurnLimit, oldChurnLimit)

      await assert.revertsOZAccessControl(
        oracleReportSanityChecker.setChurnValidatorsPerDayLimit(newChurnLimit, { from: deployer }),
        deployer,
        'CHURN_VALIDATORS_PER_DAY_LIMIT_MANAGER_ROLE'
      )

      const tx = await oracleReportSanityChecker.setChurnValidatorsPerDayLimit(newChurnLimit, {
        from: managersRoster.churnValidatorsPerDayLimitManagers[0],
      })

      assert.emits(tx, 'ChurnValidatorsPerDayLimitSet', { churnValidatorsPerDayLimit: newChurnLimit })
      assert.equals((await oracleReportSanityChecker.getOracleReportLimits()).churnValidatorsPerDayLimit, newChurnLimit)

      await oracleReportSanityChecker.checkExitedValidatorsRatePerDay(newChurnLimit)
      await assert.reverts(
        oracleReportSanityChecker.checkExitedValidatorsRatePerDay(newChurnLimit + 1),
        `ExitedValidatorsLimitExceeded(${newChurnLimit}, ${newChurnLimit + 1})`
      )
    })

    it('checkAccountingOracleReport: churnLimit works', async () => {
      const churnLimit = defaultLimitsList.churnValidatorsPerDayLimit
      assert.equals((await oracleReportSanityChecker.getOracleReportLimits()).churnValidatorsPerDayLimit, churnLimit)

      await oracleReportSanityChecker.checkAccountingOracleReport(
        ...Object.values({ ...correctLidoOracleReport, postCLValidators: churnLimit })
      )
      await assert.reverts(
        oracleReportSanityChecker.checkAccountingOracleReport(
          ...Object.values({
            ...correctLidoOracleReport,
            postCLValidators: churnLimit + 1,
          })
        ),
        `IncorrectAppearedValidators(${churnLimit + 1})`
      )
    })
  })

  describe('checkExitBusOracleReport', () => {
    beforeEach(async () => {
      await oracleReportSanityChecker.setOracleReportLimits(Object.values(defaultLimitsList), {
        from: managersRoster.allLimitsManagers[0],
      })
    })

    it('checkExitBusOracleReport works', async () => {
      const maxRequests = defaultLimitsList.maxValidatorExitRequestsPerReport
      assert.equals(
        (await oracleReportSanityChecker.getOracleReportLimits()).maxValidatorExitRequestsPerReport,
        maxRequests
      )

      await oracleReportSanityChecker.checkExitBusOracleReport(maxRequests)
      await assert.reverts(
        oracleReportSanityChecker.checkExitBusOracleReport(maxRequests + 1),
        `IncorrectNumberOfExitRequestsPerReport(${maxRequests})`
      )
    })

    it('setMaxExitRequestsPerOracleReport', async () => {
      const oldMaxRequests = defaultLimitsList.maxValidatorExitRequestsPerReport
      await oracleReportSanityChecker.checkExitBusOracleReport(oldMaxRequests)
      await assert.reverts(
        oracleReportSanityChecker.checkExitBusOracleReport(oldMaxRequests + 1),
        `IncorrectNumberOfExitRequestsPerReport(${oldMaxRequests})`
      )
      assert.equals(
        (await oracleReportSanityChecker.getOracleReportLimits()).maxValidatorExitRequestsPerReport,
        oldMaxRequests
      )

      const newMaxRequests = 306
      assert.notEquals(newMaxRequests, oldMaxRequests)

      await assert.revertsOZAccessControl(
        oracleReportSanityChecker.setMaxExitRequestsPerOracleReport(newMaxRequests, { from: deployer }),
        deployer,
        'MAX_VALIDATOR_EXIT_REQUESTS_PER_REPORT_ROLE'
      )

      const tx = await oracleReportSanityChecker.setMaxExitRequestsPerOracleReport(newMaxRequests, {
        from: managersRoster.maxValidatorExitRequestsPerReportManagers[0],
      })

      assert.emits(tx, 'MaxValidatorExitRequestsPerReportSet', { maxValidatorExitRequestsPerReport: newMaxRequests })
      assert.equals(
        (await oracleReportSanityChecker.getOracleReportLimits()).maxValidatorExitRequestsPerReport,
        newMaxRequests
      )

      await oracleReportSanityChecker.checkExitBusOracleReport(newMaxRequests)
      await assert.reverts(
        oracleReportSanityChecker.checkExitBusOracleReport(newMaxRequests + 1),
        `IncorrectNumberOfExitRequestsPerReport(${newMaxRequests})`
      )
    })
  })

  describe('extra data reporting', () => {
    beforeEach(async () => {
      await oracleReportSanityChecker.setOracleReportLimits(Object.values(defaultLimitsList), {
        from: managersRoster.allLimitsManagers[0],
      })
    })

    it('set maxNodeOperatorsPerExtraDataItemCount', async () => {
      const previousValue = (await oracleReportSanityChecker.getOracleReportLimits())
        .maxNodeOperatorsPerExtraDataItemCount
      const newValue = 33
      assert.notEquals(newValue, previousValue)
      await assert.revertsOZAccessControl(
        oracleReportSanityChecker.setMaxNodeOperatorsPerExtraDataItemCount(newValue, {
          from: deployer,
        }),
        deployer,
        'MAX_NODE_OPERATORS_PER_EXTRA_DATA_ITEM_COUNT_ROLE'
      )
      const tx = await oracleReportSanityChecker.setMaxNodeOperatorsPerExtraDataItemCount(newValue, {
        from: managersRoster.maxNodeOperatorsPerExtraDataItemCountManagers[0],
      })
      assert.equals(
        (await oracleReportSanityChecker.getOracleReportLimits()).maxNodeOperatorsPerExtraDataItemCount,
        newValue
      )
      assert.emits(tx, 'MaxNodeOperatorsPerExtraDataItemCountSet', { maxNodeOperatorsPerExtraDataItemCount: newValue })
    })

    it('set maxAccountingExtraDataListItemsCount', async () => {
      const previousValue = (await oracleReportSanityChecker.getOracleReportLimits())
        .maxAccountingExtraDataListItemsCount
      const newValue = 31
      assert.notEquals(newValue, previousValue)
      await assert.revertsOZAccessControl(
        oracleReportSanityChecker.setMaxAccountingExtraDataListItemsCount(newValue, {
          from: deployer,
        }),
        deployer,
        'MAX_ACCOUNTING_EXTRA_DATA_LIST_ITEMS_COUNT_ROLE'
      )
      const tx = await oracleReportSanityChecker.setMaxAccountingExtraDataListItemsCount(newValue, {
        from: managersRoster.maxAccountingExtraDataListItemsCountManagers[0],
      })
      assert.equals(
        (await oracleReportSanityChecker.getOracleReportLimits()).maxAccountingExtraDataListItemsCount,
        newValue
      )
      assert.emits(tx, 'MaxAccountingExtraDataListItemsCountSet', { maxAccountingExtraDataListItemsCount: newValue })
    })

    it('checkNodeOperatorsPerExtraDataItemCount', async () => {
      const maxCount = (await oracleReportSanityChecker.getOracleReportLimits()).maxNodeOperatorsPerExtraDataItemCount

      await oracleReportSanityChecker.checkNodeOperatorsPerExtraDataItemCount(12, maxCount)

      await assert.reverts(
        oracleReportSanityChecker.checkNodeOperatorsPerExtraDataItemCount(12, +maxCount + 1),
        `TooManyNodeOpsPerExtraDataItem(12, ${+maxCount + 1})`
      )
    })

    it('checkAccountingExtraDataListItemsCount', async () => {
      const maxCount = (await oracleReportSanityChecker.getOracleReportLimits()).maxAccountingExtraDataListItemsCount

      await oracleReportSanityChecker.checkAccountingExtraDataListItemsCount(maxCount)

      await assert.reverts(
        oracleReportSanityChecker.checkAccountingExtraDataListItemsCount(maxCount + 1),
        `MaxAccountingExtraDataItemsCountExceeded(${maxCount}, ${maxCount + 1})`
      )
    })
  })

  describe('check limit boundaries', () => {
    it('values must be less or equal to MAX_BASIS_POINTS', async () => {
      const MAX_BASIS_POINTS = 10000
      const INVALID_BASIS_POINTS = MAX_BASIS_POINTS + 1

      await assert.reverts(
        oracleReportSanityChecker.setOracleReportLimits(
          Object.values({ ...defaultLimitsList, oneOffCLBalanceDecreaseBPLimit: INVALID_BASIS_POINTS }),
          {
            from: managersRoster.allLimitsManagers[0],
          }
        ),
        'IncorrectLimitValue',
        [INVALID_BASIS_POINTS, 0, MAX_BASIS_POINTS]
      )

      await assert.reverts(
        oracleReportSanityChecker.setOracleReportLimits(
          Object.values({ ...defaultLimitsList, annualBalanceIncreaseBPLimit: 10001 }),
          {
            from: managersRoster.allLimitsManagers[0],
          }
        ),
        'IncorrectLimitValue',
        [INVALID_BASIS_POINTS, 0, MAX_BASIS_POINTS]
      )

      await assert.reverts(
        oracleReportSanityChecker.setOracleReportLimits(
          Object.values({ ...defaultLimitsList, simulatedShareRateDeviationBPLimit: 10001 }),
          {
            from: managersRoster.allLimitsManagers[0],
          }
        ),
        'IncorrectLimitValue',
        [INVALID_BASIS_POINTS, 0, MAX_BASIS_POINTS]
      )
    })

    it('values must be less or equal to type(uint16).max', async () => {
      const MAX_UINT_16 = 65535
      const INVALID_VALUE = MAX_UINT_16 + 1

      await assert.reverts(
        oracleReportSanityChecker.setOracleReportLimits(
          Object.values({ ...defaultLimitsList, churnValidatorsPerDayLimit: INVALID_VALUE }),
          {
            from: managersRoster.allLimitsManagers[0],
          }
        ),
        'IncorrectLimitValue',
        [INVALID_VALUE, 0, MAX_UINT_16]
      )

      await assert.reverts(
        oracleReportSanityChecker.setOracleReportLimits(
          Object.values({ ...defaultLimitsList, maxValidatorExitRequestsPerReport: INVALID_VALUE }),
          {
            from: managersRoster.allLimitsManagers[0],
          }
        ),
        'IncorrectLimitValue',
        [INVALID_VALUE, 0, MAX_UINT_16]
      )

      await assert.reverts(
        oracleReportSanityChecker.setOracleReportLimits(
          Object.values({ ...defaultLimitsList, maxAccountingExtraDataListItemsCount: INVALID_VALUE }),
          {
            from: managersRoster.allLimitsManagers[0],
          }
        ),
        'IncorrectLimitValue',
        [INVALID_VALUE, 0, MAX_UINT_16]
      )

      await assert.reverts(
        oracleReportSanityChecker.setOracleReportLimits(
          Object.values({ ...defaultLimitsList, maxNodeOperatorsPerExtraDataItemCount: INVALID_VALUE }),
          {
            from: managersRoster.allLimitsManagers[0],
          }
        ),
        'IncorrectLimitValue',
        [INVALID_VALUE, 0, MAX_UINT_16]
      )
    })

    it('values must be less or equals to type(uint64).max', async () => {
      const MAX_UINT_64 = BigInt(2) ** 64n - 1n
      const INVALID_VALUE = MAX_UINT_64 + 1n

      await assert.reverts(
        oracleReportSanityChecker.setOracleReportLimits(
          Object.values({ ...defaultLimitsList, requestTimestampMargin: INVALID_VALUE.toString() }),
          {
            from: managersRoster.allLimitsManagers[0],
          }
        ),
        'IncorrectLimitValue',
        [INVALID_VALUE.toString(), 0, MAX_UINT_64.toString()]
      )

      await assert.reverts(
        oracleReportSanityChecker.setOracleReportLimits(
          Object.values({ ...defaultLimitsList, maxPositiveTokenRebase: INVALID_VALUE.toString() }),
          {
            from: managersRoster.allLimitsManagers[0],
          }
        ),
        'IncorrectLimitValue',
        [INVALID_VALUE.toString(), 1, MAX_UINT_64.toString()]
      )
    })

    it('value must be greater than zero', async () => {
      const MAX_UINT_64 = BigInt(2) ** 64n - 1n
      const INVALID_VALUE = 0

      await assert.reverts(
        oracleReportSanityChecker.setMaxPositiveTokenRebase(0, {
          from: managersRoster.maxPositiveTokenRebaseManagers[0],
        }),
        'IncorrectLimitValue',
        [INVALID_VALUE, 1, MAX_UINT_64.toString()]
      )
    })
  })
})
