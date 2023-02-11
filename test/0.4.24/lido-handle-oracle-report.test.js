const hre = require('hardhat')
const { assert } = require('../helpers/assert')
const { ETH, toBN, genKeys } = require('../helpers/utils')
const { deployProtocol } = require('../helpers/protocol')
const { EvmSnapshot } = require('../helpers/blockchain')
const { ZERO_ADDRESS } = require('../helpers/constants')
const { setupNodeOperatorsRegistry } = require('../helpers/staking-modules')

const ONE_YEAR = 3600 * 24 * 365

contract('Lido: handleOracleReport', ([, , , , , , , stranger, anotherStranger, depositor, operator]) => {
  let deployed, snapshot, lido, treasury, voting
  let curatedModule, oracleReportSanityChecker
  let strangerBalanceBefore,
    anotherStrangerBalanceBefore,
    totalPooledEtherBefore,
    curatedModuleBalanceBefore,
    treasuryBalanceBefore

  before('deploy base app', async () => {
    deployed = await deployProtocol({
      stakingModulesFactory: async (protocol) => {
        curatedModule = await setupNodeOperatorsRegistry(protocol)
        return [
          {
            module: curatedModule,
            name: 'Curated',
            targetShares: 10000,
            moduleFee: 500,
            treasuryFee: 500
          }
        ]
      },
      depositSecurityModuleFactory: async (protocol) => {
        return { address: depositor }
      }
    })

    await curatedModule.addNodeOperator('1', operator, { from: deployed.voting.address })
    const keysAmount = 50
    const keys1 = genKeys(keysAmount)
    await curatedModule.addSigningKeys(0, keysAmount, keys1.pubkeys, keys1.sigkeys, { from: deployed.voting.address })
    await curatedModule.setNodeOperatorStakingLimit(0, keysAmount, { from: deployed.voting.address })

    lido = deployed.pool
    treasury = deployed.treasury.address
    voting = deployed.voting.address
    oracleReportSanityChecker = deployed.oracleReportSanityChecker

    await lido.submit(ZERO_ADDRESS, { from: stranger, value: ETH(30) })
    await lido.submit(ZERO_ADDRESS, { from: anotherStranger, value: ETH(70) })

    await checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: 0 })


    snapshot = new EvmSnapshot(hre.ethers.provider)
    await snapshot.make()
  })

  beforeEach(async () => {
    await updateBalancesBefore()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  const checkStat = async ({ depositedValidators, beaconValidators, beaconBalance }) => {
    const stat = await lido.getBeaconStat()
    assert.equals(stat.depositedValidators, depositedValidators, 'depositedValidators check')
    assert.equals(stat.beaconValidators, beaconValidators, 'beaconValidators check')
    assert.equals(stat.beaconBalance, beaconBalance, 'beaconBalance check')
  }

  const updateBalancesBefore = async () => {
    totalPooledEtherBefore = await lido.getTotalPooledEther()
    strangerBalanceBefore = await lido.balanceOf(stranger)
    anotherStrangerBalanceBefore = await lido.balanceOf(anotherStranger)
    treasuryBalanceBefore = await lido.balanceOf(treasury)
    curatedModuleBalanceBefore = await lido.balanceOf(curatedModule.address)
  }

  const checkBalanceDeltas = async ({
    totalPooledEtherDiff,
    treasuryBalanceDiff,
    strangerBalanceDiff,
    anotherStrangerBalanceDiff,
    curatedModuleBalanceDiff
  }) => {
    assert.equals(
      await lido.getTotalPooledEther(),
      toBN(totalPooledEtherBefore).add(toBN(totalPooledEtherDiff)),
      'totalPooledEther check'
    )
    assert.equalsDelta(
      await lido.balanceOf(treasury),
      toBN(treasuryBalanceBefore).add(toBN(treasuryBalanceDiff)),
      1,
      'treasury balance check'
    )
    assert.equalsDelta(
      await lido.balanceOf(curatedModule.address),
      toBN(curatedModuleBalanceBefore).add(toBN(curatedModuleBalanceDiff)),
      1,
      'curated module balance check'
    )
    assert.equalsDelta(
      await lido.balanceOf(stranger),
      toBN(strangerBalanceBefore).add(toBN(strangerBalanceDiff)),
      1,
      'stranger balance check'
    )
    assert.equalsDelta(
      await lido.balanceOf(anotherStranger),
      toBN(anotherStrangerBalanceBefore).add(toBN(anotherStrangerBalanceDiff)),
      1,
      'another stranger balance check'
    )
  }

  it('handleOracleReport access control', async () => {
    await assert.reverts(lido.handleOracleReport(0, 0, 0, 0, 0, 0, 0, 0, { from: stranger }), 'APP_AUTH_FAILED')
  })

  it('handleOracleReport reverts whe protocol stopped', async () => {
    await lido.stop({ from: deployed.voting.address })
    await assert.reverts(lido.handleOracleReport(0, 0, 0, 0, 0, 0, 0, 0, { from: stranger }), 'CONTRACT_IS_STOPPED')
  })

  it('zero report should do nothing', async () => {
    await lido.handleOracleReportDirect(0, 0, 0, 0, 0, 0, 0, 0)
    await checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: 0 })
    await checkBalanceDeltas({
      totalPooledEtherDiff: 0,
      treasuryBalanceDiff: 0,
      strangerBalanceDiff: 0,
      anotherStrangerBalanceDiff: 0,
      curatedModuleBalanceDiff: 0
    })
  })

  describe('clBalance', () => {
    beforeEach(async () => {
      await await lido.deposit(3, 1, '0x', { from: depositor })
      await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: 0 })
      await checkBalanceDeltas({
        totalPooledEtherDiff: 0,
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: 0,
        anotherStrangerBalanceDiff: 0,
        curatedModuleBalanceDiff: 0
      })
    })

    it('first report after deposit without rewards', async () => {
      await lido.handleOracleReportDirect(0, 0, 1, ETH(32), 0, 0, 0, 0)
      await checkStat({ depositedValidators: 3, beaconValidators: 1, beaconBalance: ETH(32) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: 0,
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: 0,
        anotherStrangerBalanceDiff: 0,
        curatedModuleBalanceDiff: 0
      })
    })

    it('first report after deposit with rewards', async () => {
      // elapsed time set to 1000000 because of annualBalanceIncrease limited by 10000
      await lido.handleOracleReportDirect(0, 1000000, 1, ETH(33), 0, 0, 0, 0)
      await checkStat({ depositedValidators: 3, beaconValidators: 1, beaconBalance: ETH(33) })

      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(1),
        treasuryBalanceDiff: ETH(0.05),
        strangerBalanceDiff: ETH(0.3 * 0.9),
        anotherStrangerBalanceDiff: ETH(0.7 * 0.9),
        curatedModuleBalanceDiff: ETH(0.05)
      })
    })
  })

  describe('sanity checks', async () => {
    beforeEach(async () => {
      await await lido.deposit(3, 1, '0x', { from: depositor })
    })

    it('reverts on reported more than deposited', async () => {
      await assert.reverts(lido.handleOracleReportDirect(0, 0, 4, 0, 0, 0, 0, 0), 'REPORTED_MORE_DEPOSITED')
    })

    it('reverts on reported less than reported previously', async () => {
      await lido.handleOracleReportDirect(0, 0, 3, ETH(96), 0, 0, 0, 0)
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await assert.reverts(lido.handleOracleReportDirect(0, 0, 2, 0, 0, 0, 0, 0), 'REPORTED_LESS_VALIDATORS')
    })

    it('withdrawal vault balance check', async () => {
      await assert.reverts(lido.handleOracleReportDirect(0, 0, 0, 0, 1, 0, 0, 0), 'IncorrectWithdrawalsVaultBalance(0)')
    })

    it('withdrawal vault balance check', async () => {
      await assert.reverts(lido.handleOracleReportDirect(0, 0, 0, 0, 1, 0, 0, 0), 'IncorrectWithdrawalsVaultBalance(0)')
    })

    it('does not revert on new total balance stay the same', async () => {
      await lido.handleOracleReportDirect(0, 0, 3, ETH(96), 0, 0, 0, 0)
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: 0,
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: 0,
        anotherStrangerBalanceDiff: 0,
        curatedModuleBalanceDiff: 0
      })
      await lido.handleOracleReportDirect(0, 0, 3, ETH(96), 0, 0, 0, 0)
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: 0,
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: 0,
        anotherStrangerBalanceDiff: 0,
        curatedModuleBalanceDiff: 0
      })
    })

    it('does not revert on new total balance decrease under the limit', async () => {
      // set oneOffCLBalanceDecreaseBPLimit = 1%
      await oracleReportSanityChecker.setOracleReportLimits(
        {
          churnValidatorsByEpochLimit: 255,
          oneOffCLBalanceDecreaseBPLimit: 100,
          annualBalanceIncreaseBPLimit: 10000,
          shareRateDeviationBPLimit: 10000,
          maxValidatorExitRequestsPerReport: 10000,
          requestTimestampMargin: 0,
          maxPositiveTokenRebase: 1000000000
        },
        { from: voting }
      )

      await lido.handleOracleReportDirect(0, 0, 3, ETH(96), 0, 0, 0, 0)
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: 0,
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: 0,
        anotherStrangerBalanceDiff: 0,
        curatedModuleBalanceDiff: 0
      })
      await lido.handleOracleReportDirect(0, 0, 3, ETH(95.04), 0, 0, 0, 0)
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(95.04) })

      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(-0.96),
        treasuryBalanceDiff: ETH(0),
        strangerBalanceDiff: ETH(-30 * 0.0096),
        anotherStrangerBalanceDiff: toBN(ETH(0.0096)).mul(toBN(-70)).toString(),
        curatedModuleBalanceDiff: ETH(0)
      })
    })

    it('reverts on new total balance decrease over the limit', async () => {
      // set oneOffCLBalanceDecreaseBPLimit = 1%
      await oracleReportSanityChecker.setOracleReportLimits(
        {
          churnValidatorsByEpochLimit: 255,
          oneOffCLBalanceDecreaseBPLimit: 100,
          annualBalanceIncreaseBPLimit: 10000,
          shareRateDeviationBPLimit: 10000,
          maxValidatorExitRequestsPerReport: 10000,
          requestTimestampMargin: 0,
          maxPositiveTokenRebase: 1000000000
        },
        { from: voting }
      )

      await lido.handleOracleReportDirect(0, 0, 3, ETH(96), 0, 0, 0, 0)
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: 0,
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: 0,
        anotherStrangerBalanceDiff: 0,
        curatedModuleBalanceDiff: 0
      })
      await assert.reverts(
        lido.handleOracleReportDirect(0, 0, 3, ETH(95.03), 0, 0, 0, 0),
        'IncorrectCLBalanceDecrease(101)'
      )
    })

    it('does not revert on new total balance increase under the limit', async () => {
      // set annualBalanceIncreaseBPLimit = 1%
      await oracleReportSanityChecker.setOracleReportLimits(
        {
          churnValidatorsByEpochLimit: 255,
          oneOffCLBalanceDecreaseBPLimit: 100,
          annualBalanceIncreaseBPLimit: 100,
          shareRateDeviationBPLimit: 10000,
          maxValidatorExitRequestsPerReport: 10000,
          requestTimestampMargin: 0,
          maxPositiveTokenRebase: 1000000000
        },
        { from: voting }
      )

      await lido.handleOracleReportDirect(0, 0, 3, ETH(96), 0, 0, 0, 0)
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: 0,
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: 0,
        anotherStrangerBalanceDiff: 0,
        curatedModuleBalanceDiff: 0
      })
      await lido.handleOracleReportDirect(0, ONE_YEAR, 3, ETH(96.96), 0, 0, 0, 0)
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96.96) })

      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(0.96),
        treasuryBalanceDiff: ETH(0.96 * 0.05),
        strangerBalanceDiff: ETH(30 * 0.0096 * 0.9),
        anotherStrangerBalanceDiff: ETH(70 * 0.0096 * 0.9),
        curatedModuleBalanceDiff: ETH(0.96 * 0.05)
      })
    })

    it('reverts on new total balance increase over the limit', async () => {
      // set annualBalanceIncreaseBPLimit = 1%
      await oracleReportSanityChecker.setOracleReportLimits(
        {
          churnValidatorsByEpochLimit: 255,
          oneOffCLBalanceDecreaseBPLimit: 100,
          annualBalanceIncreaseBPLimit: 100,
          shareRateDeviationBPLimit: 10000,
          maxValidatorExitRequestsPerReport: 10000,
          requestTimestampMargin: 0,
          maxPositiveTokenRebase: 1000000000
        },
        { from: voting }
      )

      await lido.handleOracleReportDirect(0, 0, 3, ETH(96), 0, 0, 0, 0)
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: 0,
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: 0,
        anotherStrangerBalanceDiff: 0,
        curatedModuleBalanceDiff: 0
      })
      await assert.reverts(
        lido.handleOracleReportDirect(0, ONE_YEAR, 3, ETH(96.97), 0, 0, 0, 0),
        'IncorrectCLBalanceIncrease(101)'
      )
    })

    it('check finalization share rate', async () => {
      await oracleReportSanityChecker.setOracleReportLimits(
        {
          churnValidatorsByEpochLimit: 255,
          oneOffCLBalanceDecreaseBPLimit: 10000,
          annualBalanceIncreaseBPLimit: 10000,
          shareRateDeviationBPLimit: 100,
          maxValidatorExitRequestsPerReport: 10000,
          requestTimestampMargin: 0,
          maxPositiveTokenRebase: 1000000000
        },
        { from: voting }
      )
      await lido.handleOracleReportDirect(0, ONE_YEAR, 3, ETH(97), 0, 0, 0, ETH(1))
      assert.equals(await lido.getPooledEthByShares(ETH(1)), ETH(1.009))
      await lido.handleOracleReportDirect(0, ONE_YEAR, 3, ETH(97), 0, 0, 0, ETH(1))
    })

    it('check finalization share rate', async () => {
      await oracleReportSanityChecker.setOracleReportLimits(
        {
          churnValidatorsByEpochLimit: 255,
          oneOffCLBalanceDecreaseBPLimit: 10000,
          annualBalanceIncreaseBPLimit: 10000,
          shareRateDeviationBPLimit: 100,
          maxValidatorExitRequestsPerReport: 10000,
          requestTimestampMargin: 0,
          maxPositiveTokenRebase: 1000000000
        },
        { from: voting }
      )
      await lido.handleOracleReportDirect(0, ONE_YEAR, 3, ETH(95), 0, 0, 0, ETH(1))
    })
  })
})
