const hre = require('hardhat')
const { assert } = require('../helpers/assert')
const { ETH } = require('../helpers/utils')

const mocksFilePath = 'contracts/0.8.9/test_helpers/AccountingSanityCheckerMocks.sol'
const AccountingSanityChecker = hre.artifacts.require('AccountingSanityChecker')
const LidoMock = hre.artifacts.require(`${mocksFilePath}:LidoStub`)
const LidoLocatorMock = hre.artifacts.require(`${mocksFilePath}:LidoLocatorStub`)
const WithdrawalQueueMock = hre.artifacts.require(`${mocksFilePath}:WithdrawalQueueStub`)

contract('AccountingSanityChecker', ([deployer, admin, withdrawalVault, ...accounts]) => {
  let accountingSanityChecker, lidoLocatorMock, lidoMock, withdrawalQueueMock
  const managersRoster = {
    allLimitsManagers: accounts.slice(0, 2),
    churnValidatorsByEpochLimitManagers: accounts.slice(2, 4),
    oneOffCLBalanceDecreaseLimitManagers: accounts.slice(4, 6),
    annualBalanceIncreaseLimitManagers: accounts.slice(6, 8),
    requestCreationBlockMarginManagers: accounts.slice(8, 10),
    maxPositiveTokenRebaseManagers: accounts.slice(10, 12)
  }
  const defaultReport = {
    timeElapsed: 24 * 60 * 60,
    preCLBalance: ETH(100_000),
    postCLBalance: ETH(100_001),
    withdrawalVaultBalance: 0,
    appearedValidators: 10,
    exitedValidators: 5,
    requestIdToFinalizeUpTo: 0,
    reportBlockNumber: 0,
    finalizationShareRate: ETH(1)
  }

  const defaultLimitsList = {
    churnValidatorsByEpochLimit: 55,
    oneOffCLBalanceDecreaseLimit: 5_00, // 5%
    annualBalanceIncreaseLimit: 10_00, // 10%
    requestCreationBlockMargin: 128,
    maxPositiveTokenRebase: 5_000_000 // 0.05%
  }

  before(async () => {
    await hre.ethers.provider.send('hardhat_mine', ['0x400', '0xc']) // mine 1024 blocks
    lidoMock = await LidoMock.new({ from: deployer })
    withdrawalQueueMock = await WithdrawalQueueMock.new({ from: deployer })
    lidoLocatorMock = await LidoLocatorMock.new(lidoMock.address, withdrawalVault, withdrawalQueueMock.address)

    accountingSanityChecker = await AccountingSanityChecker.new(
      lidoLocatorMock.address,
      admin,
      Object.values(defaultLimitsList),
      Object.values(managersRoster),
      {
        from: deployer
      }
    )
  })

  describe('setLimits()', () => {
    it('sets limits correctly', async () => {
      const newLimitsList = {
        churnValidatorsByEpochLimit: 50,
        oneOffCLBalanceDecreaseLimit: 10_00,
        annualBalanceIncreaseLimit: 15_00,
        requestCreationBlockMargin: 2048,
        maxPositiveTokenRebase: 10_000_000
      }
      const limitsBefore = await accountingSanityChecker.getLimits()
      assert.notEquals(limitsBefore.churnValidatorsByEpochLimit, newLimitsList.churnValidatorsByEpochLimit)
      assert.notEquals(limitsBefore.oneOffCLBalanceDecreaseLimit, newLimitsList.oneOffCLBalanceDecreaseLimit)
      assert.notEquals(limitsBefore.annualBalanceIncreaseLimit, newLimitsList.annualBalanceIncreaseLimit)
      assert.notEquals(limitsBefore.requestCreationBlockMargin, newLimitsList.requestCreationBlockMargin)
      assert.notEquals(limitsBefore.maxPositiveTokenRebase, newLimitsList.maxPositiveTokenRebase)

      await accountingSanityChecker.setLimits(Object.values(newLimitsList), {
        from: managersRoster.allLimitsManagers[0]
      })

      const limitsAfter = await accountingSanityChecker.getLimits()
      assert.equals(limitsAfter.churnValidatorsByEpochLimit, newLimitsList.churnValidatorsByEpochLimit)
      assert.equals(limitsAfter.oneOffCLBalanceDecreaseLimit, newLimitsList.oneOffCLBalanceDecreaseLimit)
      assert.equals(limitsAfter.annualBalanceIncreaseLimit, newLimitsList.annualBalanceIncreaseLimit)
      assert.equals(limitsAfter.requestCreationBlockMargin, newLimitsList.requestCreationBlockMargin)
      assert.equals(limitsAfter.maxPositiveTokenRebase, newLimitsList.maxPositiveTokenRebase)
    })
  })

  describe('checkReport()', () => {
    before(async () => {
      await hre.ethers.provider.send('hardhat_mine', ['0x400', '0xc'])
    })

    beforeEach(async () => {
      await accountingSanityChecker.setLimits(Object.values(defaultLimitsList), {
        from: managersRoster.allLimitsManagers[0]
      })
    })

    it('passes on correct data', async () => {
      await lidoMock.setShareRate(ETH(1))

      const requestIdToFinalizeUpTo = 1
      const requestCreationBlockNumber = await hre.ethers.provider.getBlockNumber().then((v) => v - 256)
      await withdrawalQueueMock.setBlockNumber(requestIdToFinalizeUpTo, requestCreationBlockNumber)

      const timeElapsed = 24 * 60 * 60 // 24 hours
      const preCLBalance = ETH(10_000)
      const postCLBalance = ETH(10_001)
      const appearedValidators = 5
      const exitedValidators = 3
      const withdrawalVaultBalance = await hre.ethers.provider.getBalance(withdrawalVault)
      const reportBlockNumber = await hre.ethers.provider.getBlockNumber()
      const finalizationShareRate = ETH(1)

      await accountingSanityChecker.checkReport(
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
