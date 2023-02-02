const hre = require('hardhat')
const { assert } = require('../helpers/assert')
const { ETH } = require('../helpers/utils')

const OssifiableProxy = hre.artifacts.require('OssifiableProxy')
const SanityChecksRegistry = hre.artifacts.require('SanityChecksRegistry')
const LidoMock = hre.artifacts.require('LidoMockForAccountingOracleSanityChecks')
const WithdrawalQueueMock = hre.artifacts.require('WithdrawalQueueMockForAccountingOracleSanityChecks')

contract('SanityChecksRegistry', ([owner, admin, manager, withdrawalVault]) => {
  let sanityChecksRegistry, lidoMock, withdrawalQueueMock

  before(async () => {
    lidoMock = await LidoMock.new({ from: owner })
    withdrawalQueueMock = await WithdrawalQueueMock.new({ from: owner })
    const sanityChecksImpl = await SanityChecksRegistry.new(
      lidoMock.address,
      withdrawalVault,
      withdrawalQueueMock.address,
      { from: owner }
    )
    const proxy = await OssifiableProxy.new(sanityChecksImpl.address, owner, [], { from: owner })
    sanityChecksRegistry = await SanityChecksRegistry.at(proxy.address)
    await sanityChecksRegistry.initialize(admin, manager)
  })

  describe('setAccountingOracleLimits()', () => {
    it('sets limits correctly', async () => {
      const churnValidatorsByEpochLimit = 55
      const oneOffCLBalanceDecreaseLimit = 5_00 // 5%
      const annualBalanceIncreaseLimit = 10_00 // 10%
      const requestCreationBlockMargin = 1024
      const finalizationPauseStartBlock = await hre.ethers.provider.getBlockNumber().then((bn) => bn + 1000)

      const limitsBefore = await sanityChecksRegistry.getAccountingOracleLimits()
      assert.notEquals(limitsBefore.churnValidatorsByEpochLimit, churnValidatorsByEpochLimit)
      assert.notEquals(limitsBefore.oneOffCLBalanceDecreaseLimit, oneOffCLBalanceDecreaseLimit)
      assert.notEquals(limitsBefore.annualBalanceIncreaseLimit, annualBalanceIncreaseLimit)
      assert.notEquals(limitsBefore.requestCreationBlockMargin, requestCreationBlockMargin)
      assert.notEquals(limitsBefore.finalizationPauseStartBlock, finalizationPauseStartBlock)

      await sanityChecksRegistry.setAccountingOracleLimits(
        churnValidatorsByEpochLimit,
        oneOffCLBalanceDecreaseLimit,
        annualBalanceIncreaseLimit,
        requestCreationBlockMargin,
        finalizationPauseStartBlock,
        { from: manager }
      )

      const limitsAfter = await sanityChecksRegistry.getAccountingOracleLimits()
      assert.equals(limitsAfter.churnValidatorsByEpochLimit, churnValidatorsByEpochLimit)
      assert.equals(limitsAfter.oneOffCLBalanceDecreaseLimit, oneOffCLBalanceDecreaseLimit)
      assert.equals(limitsAfter.annualBalanceIncreaseLimit, annualBalanceIncreaseLimit)
      assert.equals(limitsAfter.requestCreationBlockMargin, requestCreationBlockMargin)
      assert.equals(limitsAfter.finalizationPauseStartBlock, finalizationPauseStartBlock)
    })
  })

  describe('validateAccountingOracleReport()', () => {
    const churnValidatorsByEpochLimit = 55
    const oneOffCLBalanceDecreaseLimit = 5_00 // 5%
    const annualBalanceIncreaseLimit = 10_00 // 10%
    const requestCreationBlockMargin = 100
    let finalizationPauseStartBlock

    before(async () => {
      await hre.ethers.provider.send('hardhat_mine', ['0x400', '0xc'])
    })

    beforeEach(async () => {
      finalizationPauseStartBlock = await hre.ethers.provider.getBlockNumber().then((bn) => bn + 1000)
      await sanityChecksRegistry.setAccountingOracleLimits(
        churnValidatorsByEpochLimit,
        oneOffCLBalanceDecreaseLimit,
        annualBalanceIncreaseLimit,
        requestCreationBlockMargin,
        finalizationPauseStartBlock,
        { from: manager }
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

      await sanityChecksRegistry.validateAccountingOracleReport(
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
