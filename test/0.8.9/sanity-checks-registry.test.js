const hre = require('hardhat')
const { assert } = require('../helpers/assert')
const { ETH } = require('../helpers/utils')

const LidoLocatorMock = hre.artifacts.require('LidoLocatorMock')
const LidoMock = hre.artifacts.require('LidoMockForAccountingOracleSanityChecks')
const AccountingOracleReportSanityChecks = hre.artifacts.require('AccountingOracleReportSanityChecks')
const WithdrawalQueueMock = hre.artifacts.require('WithdrawalQueueMockForAccountingOracleSanityChecks')

contract('SanityChecksRegistry', ([deployer, admin, manager, withdrawalVault, ...accounts]) => {
  let accountingOracleSanityChecks, lidoLocatorMock, lidoMock, withdrawalQueueMock
  const managersRoster = {
    allLimitsManagers: accounts.slice(0, 2),
    churnValidatorsByEpochLimitManagers: accounts.slice(2, 4),
    oneOffCLBalanceDecreaseLimitManagers: accounts.slice(4, 6),
    annualBalanceIncreaseLimitManagers: accounts.slice(6, 8),
    requestCreationBlockMarginManagers: accounts.slice(8, 10),
    finalizationPauseStartBlockManagers: accounts.slice(10, 12),
    maxPositiveTokenRebaseManagers: accounts.slice(12, 14)
  }
  const defaultLimitsList = {
    churnValidatorsByEpochLimit: 0,
    oneOffCLBalanceDecreaseLimit: 0,
    annualBalanceIncreaseLimit: 0,
    requestCreationBlockMargin: 0,
    finalizationPauseStartBlock: 0,
    maxPositiveTokenRebase: 0
  }

  before(async () => {
    lidoMock = await LidoMock.new({ from: deployer })
    withdrawalQueueMock = await WithdrawalQueueMock.new({ from: deployer })
    lidoLocatorMock = await LidoLocatorMock.new(lidoMock.address, withdrawalVault, withdrawalQueueMock.address)

    accountingOracleSanityChecks = await AccountingOracleReportSanityChecks.new(
      lidoLocatorMock.address,
      admin,
      Object.values(defaultLimitsList),
      Object.values(managersRoster),
      {
        from: deployer
      }
    )
  })

  describe('setAccountingOracleLimits()', () => {
    it('sets limits correctly', async () => {
      const churnValidatorsByEpochLimit = 55
      const oneOffCLBalanceDecreaseLimit = 5_00 // 5%
      const annualBalanceIncreaseLimit = 10_00 // 10%
      const requestCreationBlockMargin = 1024
      const finalizationPauseStartBlock = await hre.ethers.provider.getBlockNumber().then((bn) => bn + 1000)
      const maxPositiveTokenRebase = 5_000_000 // 0.05%

      const limitsBefore = await accountingOracleSanityChecks.getAccountingOracleLimits()
      assert.notEquals(limitsBefore.churnValidatorsByEpochLimit, churnValidatorsByEpochLimit)
      assert.notEquals(limitsBefore.oneOffCLBalanceDecreaseLimit, oneOffCLBalanceDecreaseLimit)
      assert.notEquals(limitsBefore.annualBalanceIncreaseLimit, annualBalanceIncreaseLimit)
      assert.notEquals(limitsBefore.requestCreationBlockMargin, requestCreationBlockMargin)
      assert.notEquals(limitsBefore.finalizationPauseStartBlock, finalizationPauseStartBlock)
      assert.notEquals(limitsBefore.maxPositiveTokenRebase, maxPositiveTokenRebase)

      await accountingOracleSanityChecks.setAccountingOracleLimits(
        [
          churnValidatorsByEpochLimit,
          oneOffCLBalanceDecreaseLimit,
          annualBalanceIncreaseLimit,
          requestCreationBlockMargin,
          finalizationPauseStartBlock,
          maxPositiveTokenRebase
        ],
        { from: managersRoster.allLimitsManagers[0] }
      )

      const limitsAfter = await accountingOracleSanityChecks.getAccountingOracleLimits()
      assert.equals(limitsAfter.churnValidatorsByEpochLimit, churnValidatorsByEpochLimit)
      assert.equals(limitsAfter.oneOffCLBalanceDecreaseLimit, oneOffCLBalanceDecreaseLimit)
      assert.equals(limitsAfter.annualBalanceIncreaseLimit, annualBalanceIncreaseLimit)
      assert.equals(limitsAfter.requestCreationBlockMargin, requestCreationBlockMargin)
      assert.equals(limitsAfter.finalizationPauseStartBlock, finalizationPauseStartBlock)
      assert.equals(limitsAfter.maxPositiveTokenRebase, maxPositiveTokenRebase)
    })
  })

  describe('validateAccountingOracleReport()', () => {
    const churnValidatorsByEpochLimit = 55
    const oneOffCLBalanceDecreaseLimit = 5_00 // 5%
    const annualBalanceIncreaseLimit = 10_00 // 10%
    const requestCreationBlockMargin = 100
    const maxPositiveTokenRebase = 5_000_000 // 0.05%
    let finalizationPauseStartBlock

    before(async () => {
      await hre.ethers.provider.send('hardhat_mine', ['0x400', '0xc'])
    })

    beforeEach(async () => {
      finalizationPauseStartBlock = await hre.ethers.provider.getBlockNumber().then((bn) => bn + 1000)
      await accountingOracleSanityChecks.setAccountingOracleLimits(
        [
          churnValidatorsByEpochLimit,
          oneOffCLBalanceDecreaseLimit,
          annualBalanceIncreaseLimit,
          requestCreationBlockMargin,
          finalizationPauseStartBlock,
          maxPositiveTokenRebase
        ],
        { from: managersRoster.allLimitsManagers[0] }
      )
    })

    it('passes on correct data', async () => {
      const requestId = 1
      await lidoMock.setShareRate(ETH(1))

      const requestIdToFinalizeUpTo = finalizationPauseStartBlock - 50
      await withdrawalQueueMock.setBlockNumber(requestId, requestIdToFinalizeUpTo - 10)

      const timeElapsed = 24 * 60 * 60 // 24 hours
      const preCLBalance = ETH(10_000)
      const postCLBalance = ETH(10_001)
      const appearedValidators = 5
      const exitedValidators = 3
      const withdrawalVaultBalance = await hre.ethers.provider.getBalance(withdrawalVault)
      const reportBlockNumber = await hre.ethers.provider.getBlockNumber()
      const finalizationShareRate = ETH(1)

      await accountingOracleSanityChecks.validateAccountingOracleReport(
        timeElapsed,
        preCLBalance,
        postCLBalance,
        withdrawalVaultBalance,
        appearedValidators,
        exitedValidators,
        requestIdToFinalizeUpTo,
        reportBlockNumber,
        finalizationShareRate
      )
    })
  })
})
