const { artifacts, contract, ethers } = require('hardhat')

const { assert } = require('../helpers/assert')
const { ETH, toBN, genKeys, StETH, calcSharesMintedAsFees } = require('../helpers/utils')
const { deployProtocol } = require('../helpers/protocol')
const { EvmSnapshot, setBalance } = require('../helpers/blockchain')
const { ZERO_ADDRESS, INITIAL_HOLDER } = require('../helpers/constants')
const { setupNodeOperatorsRegistry } = require('../helpers/staking-modules')

const Lido = artifacts.require('Lido')

const ONE_YEAR = 3600 * 24 * 365
const ONE_DAY = 3600 * 24
const ORACLE_REPORT_LIMITS_BOILERPLATE = {
  churnValidatorsPerDayLimit: 255,
  oneOffCLBalanceDecreaseBPLimit: 100,
  annualBalanceIncreaseBPLimit: 10000,
  simulatedShareRateDeviationBPLimit: 10000,
  maxValidatorExitRequestsPerReport: 10000,
  maxAccountingExtraDataListItemsCount: 10000,
  maxNodeOperatorsPerExtraDataItemCount: 10000,
  requestTimestampMargin: 0,
  maxPositiveTokenRebase: 1000000000,
}

const checkEvents = async ({
  tx,
  reportTimestamp = 0,
  preCLValidators,
  postCLValidators,
  preCLBalance,
  postCLBalance,
  withdrawalsWithdrawn,
  executionLayerRewardsWithdrawn,
  postBufferedEther,
  timeElapsed,
  preTotalShares,
  preTotalEther,
  postTotalShares,
  postTotalEther,
  sharesMintedAsFees,
}) => {
  assert.emits(
    tx,
    'CLValidatorsUpdated',
    {
      reportTimestamp: 0,
      preCLValidators,
      postCLValidators,
    },
    {
      abi: Lido.abi,
    }
  )
  assert.emits(
    tx,
    'ETHDistributed',
    {
      reportTimestamp,
      preCLBalance,
      postCLBalance,
      withdrawalsWithdrawn,
      executionLayerRewardsWithdrawn,
      postBufferedEther,
    },
    {
      abi: Lido.abi,
    }
  )
  assert.emits(
    tx,
    'TokenRebased',
    {
      reportTimestamp,
      timeElapsed,
      preTotalShares,
      preTotalEther,
      postTotalShares,
      postTotalEther,
      sharesMintedAsFees,
    },
    {
      abi: Lido.abi,
    }
  )
}

contract('Lido: handleOracleReport', ([appManager, , , , , , , stranger, anotherStranger, depositor, operator]) => {
  let deployed, snapshot, lido, treasury, voting, oracle
  let curatedModule, oracleReportSanityChecker, elRewardsVault
  let withdrawalVault
  let strangerBalanceBefore,
    anotherStrangerBalanceBefore,
    totalPooledEtherBefore,
    curatedModuleBalanceBefore,
    treasuryBalanceBefore,
    initialHolderBalanceBefore

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
            treasuryFee: 500,
          },
        ]
      },
      depositSecurityModuleFactory: async (protocol) => {
        return { address: depositor }
      },
    })

    await setBalance(deployed.oracle.address, ETH(1))
    await ethers.getImpersonatedSigner(deployed.oracle.address)

    await curatedModule.addNodeOperator('1', operator, { from: deployed.voting.address })
    const keysAmount = 120
    const keys1 = genKeys(keysAmount)
    await curatedModule.addSigningKeys(0, keysAmount, keys1.pubkeys, keys1.sigkeys, { from: deployed.voting.address })
    await curatedModule.setNodeOperatorStakingLimit(0, keysAmount, { from: deployed.voting.address })

    lido = deployed.pool
    treasury = deployed.treasury.address
    voting = deployed.voting.address
    oracle = deployed.oracle.address
    oracleReportSanityChecker = deployed.oracleReportSanityChecker
    withdrawalVault = deployed.withdrawalVault.address
    elRewardsVault = deployed.elRewardsVault.address

    assert.equals(await lido.balanceOf(INITIAL_HOLDER), StETH(1))
    await lido.submit(ZERO_ADDRESS, { from: stranger, value: ETH(30) })
    await lido.submit(ZERO_ADDRESS, { from: anotherStranger, value: ETH(69) })

    await checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: 0 })

    snapshot = new EvmSnapshot(ethers.provider)
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
    initialHolderBalanceBefore = await lido.balanceOf(INITIAL_HOLDER)
  }

  const checkBalanceDeltas = async ({
    totalPooledEtherDiff,
    treasuryBalanceDiff,
    strangerBalanceDiff,
    anotherStrangerBalanceDiff,
    curatedModuleBalanceDiff,
    initialHolderBalanceDiff,
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
    assert.equalsDelta(
      await lido.balanceOf(INITIAL_HOLDER),
      toBN(initialHolderBalanceBefore).add(toBN(initialHolderBalanceDiff)),
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
    const tx = await lido.handleOracleReport(0, 0, 0, 0, 0, 0, 0, 0, { from: oracle })
    await checkEvents({
      tx,
      preCLValidators: 0,
      postCLValidators: 0,
      preCLBalance: ETH(0),
      postCLBalance: ETH(0),
      withdrawalsWithdrawn: 0,
      executionLayerRewardsWithdrawn: 0,
      postBufferedEther: ETH(100),
      timeElapsed: 0,
      preTotalShares: ETH(100),
      preTotalEther: ETH(100),
      postTotalShares: ETH(100),
      postTotalEther: ETH(100),
      sharesMintedAsFees: 0,
    })

    await checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: 0 })
    await checkBalanceDeltas({
      totalPooledEtherDiff: 0,
      treasuryBalanceDiff: 0,
      strangerBalanceDiff: 0,
      anotherStrangerBalanceDiff: 0,
      curatedModuleBalanceDiff: 0,
      initialHolderBalanceDiff: 0,
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
        curatedModuleBalanceDiff: 0,
        initialHolderBalanceDiff: 0,
      })
    })

    it('first report after deposit without rewards', async () => {
      const tx = await lido.handleOracleReport(0, 0, 1, ETH(32), 0, 0, 0, 0, { from: oracle })
      await checkEvents({
        tx,
        preCLValidators: 0,
        postCLValidators: 1,
        preCLBalance: ETH(32),
        postCLBalance: ETH(32),
        withdrawalsWithdrawn: 0,
        executionLayerRewardsWithdrawn: 0,
        postBufferedEther: ETH(4),
        timeElapsed: 0,
        preTotalShares: ETH(100),
        preTotalEther: ETH(100),
        postTotalShares: ETH(100),
        postTotalEther: ETH(100),
        sharesMintedAsFees: 0,
      })

      await checkStat({ depositedValidators: 3, beaconValidators: 1, beaconBalance: ETH(32) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: 0,
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: 0,
        anotherStrangerBalanceDiff: 0,
        curatedModuleBalanceDiff: 0,
        initialHolderBalanceDiff: 0,
      })
    })

    it('first report after deposit with rewards', async () => {
      const tx = await lido.handleOracleReport(0, ONE_YEAR, 1, ETH(33), 0, 0, 0, 0, { from: oracle })
      const sharesMintedAsFees = calcSharesMintedAsFees(ETH(1), 10, 100, ETH(100), ETH(101))
      await checkEvents({
        tx,
        preCLValidators: 0,
        postCLValidators: 1,
        preCLBalance: ETH(32),
        postCLBalance: ETH(33),
        withdrawalsWithdrawn: 0,
        executionLayerRewardsWithdrawn: 0,
        postBufferedEther: ETH(4),
        timeElapsed: ONE_YEAR,
        preTotalShares: ETH(100),
        preTotalEther: ETH(100),
        postTotalShares: toBN(ETH(100)).add(sharesMintedAsFees).toString(),
        postTotalEther: ETH(101),
        sharesMintedAsFees,
      })

      await checkStat({ depositedValidators: 3, beaconValidators: 1, beaconBalance: ETH(33) })

      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(1),
        treasuryBalanceDiff: ETH(0.05),
        strangerBalanceDiff: ETH(0.3 * 0.9),
        anotherStrangerBalanceDiff: ETH(0.69 * 0.9),
        curatedModuleBalanceDiff: ETH(0.05),
        initialHolderBalanceDiff: ETH(0.01 * 0.9),
      })
    })
  })

  describe('sanity checks', async () => {
    beforeEach(async () => {
      await await lido.deposit(3, 1, '0x', { from: depositor })
    })

    it('reverts on reported more than deposited', async () => {
      await assert.reverts(lido.handleOracleReport(0, 0, 4, 0, 0, 0, 0, 0, { from: oracle }), 'REPORTED_MORE_DEPOSITED')
    })

    it('reverts on reported less than reported previously', async () => {
      await lido.handleOracleReport(0, 0, 3, ETH(96), 0, 0, 0, 0, { from: oracle })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await assert.reverts(
        lido.handleOracleReport(0, 0, 2, 0, 0, 0, 0, 0, { from: oracle }),
        'REPORTED_LESS_VALIDATORS'
      )
    })

    it('withdrawal vault balance check', async () => {
      await assert.reverts(
        lido.handleOracleReport(0, 0, 0, 0, 1, 0, 0, 0, { from: oracle }),
        'IncorrectWithdrawalsVaultBalance(0)'
      )
    })

    it('withdrawal vault balance check 2', async () => {
      await assert.reverts(
        lido.handleOracleReport(0, 0, 0, 0, 1, 0, 0, 0, { from: oracle }),
        'IncorrectWithdrawalsVaultBalance(0)'
      )
    })

    it('does not revert on new total balance stay the same', async () => {
      let tx = await lido.handleOracleReport(0, 0, 3, ETH(96), 0, 0, 0, 0, { from: oracle })
      await checkEvents({
        tx,
        preCLValidators: 0,
        postCLValidators: 3,
        preCLBalance: ETH(96),
        postCLBalance: ETH(96),
        withdrawalsWithdrawn: 0,
        executionLayerRewardsWithdrawn: 0,
        postBufferedEther: ETH(4),
        timeElapsed: 0,
        preTotalShares: ETH(100),
        preTotalEther: ETH(100),
        postTotalShares: ETH(100),
        postTotalEther: ETH(100),
        sharesMintedAsFees: 0,
      })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: 0,
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: 0,
        anotherStrangerBalanceDiff: 0,
        curatedModuleBalanceDiff: 0,
        initialHolderBalanceDiff: 0,
      })
      tx = await lido.handleOracleReport(0, 0, 3, ETH(96), 0, 0, 0, 0, { from: oracle })
      await checkEvents({
        tx,
        preCLValidators: 3,
        postCLValidators: 3,
        preCLBalance: ETH(96),
        postCLBalance: ETH(96),
        withdrawalsWithdrawn: 0,
        executionLayerRewardsWithdrawn: 0,
        postBufferedEther: ETH(4),
        timeElapsed: 0,
        preTotalShares: ETH(100),
        preTotalEther: ETH(100),
        postTotalShares: ETH(100),
        postTotalEther: ETH(100),
        sharesMintedAsFees: 0,
      })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: 0,
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: 0,
        anotherStrangerBalanceDiff: 0,
        curatedModuleBalanceDiff: 0,
        initialHolderBalanceDiff: 0,
      })
    })

    it('does not revert on new total balance decrease under the limit', async () => {
      // set oneOffCLBalanceDecreaseBPLimit = 1%
      await oracleReportSanityChecker.setOracleReportLimits(ORACLE_REPORT_LIMITS_BOILERPLATE, { from: voting })

      let tx = await lido.handleOracleReport(0, 0, 3, ETH(96), 0, 0, 0, 0, { from: oracle })
      await checkEvents({
        tx,
        preCLValidators: 0,
        postCLValidators: 3,
        preCLBalance: ETH(96),
        postCLBalance: ETH(96),
        withdrawalsWithdrawn: 0,
        executionLayerRewardsWithdrawn: 0,
        postBufferedEther: ETH(4),
        timeElapsed: 0,
        preTotalShares: ETH(100),
        preTotalEther: ETH(100),
        postTotalShares: ETH(100),
        postTotalEther: ETH(100),
        sharesMintedAsFees: 0,
      })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: 0,
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: 0,
        anotherStrangerBalanceDiff: 0,
        curatedModuleBalanceDiff: 0,
        initialHolderBalanceDiff: 0,
      })
      tx = await lido.handleOracleReport(0, 0, 3, ETH(95.04), 0, 0, 0, 0, { from: oracle })
      await checkEvents({
        tx,
        preCLValidators: 3,
        postCLValidators: 3,
        preCLBalance: ETH(96),
        postCLBalance: ETH(95.04),
        withdrawalsWithdrawn: 0,
        executionLayerRewardsWithdrawn: 0,
        postBufferedEther: ETH(4),
        timeElapsed: 0,
        preTotalShares: ETH(100),
        preTotalEther: ETH(100),
        postTotalShares: ETH(100),
        postTotalEther: ETH(99.04),
        sharesMintedAsFees: 0,
      })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(95.04) })

      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(-0.96),
        treasuryBalanceDiff: ETH(0),
        strangerBalanceDiff: ETH(-30 * 0.0096),
        anotherStrangerBalanceDiff: toBN(ETH(0.0096)).mul(toBN(-69)).toString(),
        curatedModuleBalanceDiff: ETH(0),
        initialHolderBalanceDiff: ETH(-1 * 0.0096),
      })
    })

    it('reverts on new total balance decrease over the limit', async () => {
      // set oneOffCLBalanceDecreaseBPLimit = 1%
      await oracleReportSanityChecker.setOracleReportLimits(ORACLE_REPORT_LIMITS_BOILERPLATE, { from: voting })

      await lido.handleOracleReport(0, 0, 3, ETH(96), 0, 0, 0, 0, { from: oracle })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: 0,
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: 0,
        anotherStrangerBalanceDiff: 0,
        curatedModuleBalanceDiff: 0,
        initialHolderBalanceDiff: 0,
      })
      await assert.reverts(
        lido.handleOracleReport(0, 0, 3, ETH(95.03), 0, 0, 0, 0, { from: oracle }),
        'IncorrectCLBalanceDecrease(101)'
      )
    })

    it('does not revert on new total balance increase under the limit', async () => {
      // set annualBalanceIncreaseBPLimit = 1%
      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          annualBalanceIncreaseBPLimit: 100,
        },
        { from: voting }
      )

      await lido.handleOracleReport(0, 0, 3, ETH(96), 0, 0, 0, 0, { from: oracle })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: 0,
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: 0,
        anotherStrangerBalanceDiff: 0,
        curatedModuleBalanceDiff: 0,
        initialHolderBalanceDiff: 0,
      })
      const tx = await lido.handleOracleReport(0, ONE_YEAR, 3, ETH(96.96), 0, 0, 0, 0, { from: oracle })
      const sharesMintedAsFees = calcSharesMintedAsFees(ETH(0.96), 10, 100, ETH(100), ETH(100.96))
      await checkEvents({
        tx,
        preCLValidators: 3,
        postCLValidators: 3,
        preCLBalance: ETH(96),
        postCLBalance: ETH(96.96),
        withdrawalsWithdrawn: 0,
        executionLayerRewardsWithdrawn: 0,
        postBufferedEther: ETH(4),
        timeElapsed: ONE_YEAR,
        preTotalShares: ETH(100),
        preTotalEther: ETH(100),
        postTotalShares: toBN(ETH(100)).add(sharesMintedAsFees).toString(),
        postTotalEther: ETH(100.96),
        sharesMintedAsFees: sharesMintedAsFees.toString(),
      })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96.96) })

      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(0.96),
        treasuryBalanceDiff: ETH(0.96 * 0.05),
        strangerBalanceDiff: ETH(30 * 0.0096 * 0.9),
        anotherStrangerBalanceDiff: ETH(69 * 0.0096 * 0.9),
        curatedModuleBalanceDiff: ETH(0.96 * 0.05),
        initialHolderBalanceDiff: ETH(0.96 * 0.01 * 0.9),
      })
    })

    it('reverts on new total balance increase over the limit', async () => {
      // set annualBalanceIncreaseBPLimit = 1%
      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          annualBalanceIncreaseBPLimit: 100,
        },
        { from: voting }
      )

      await lido.handleOracleReport(0, 0, 3, ETH(96), 0, 0, 0, 0, { from: oracle })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: 0,
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: 0,
        anotherStrangerBalanceDiff: 0,
        curatedModuleBalanceDiff: 0,
        initialHolderBalanceDiff: 0,
      })
      await assert.reverts(
        lido.handleOracleReport(0, ONE_YEAR, 3, ETH(96.97), 0, 0, 0, 0, { from: oracle }),
        'IncorrectCLBalanceIncrease(101)'
      )
    })

    it('does not revert on validators reported under limit', async () => {
      await lido.submit(ZERO_ADDRESS, { from: stranger, value: ETH(3100), gasPrice: 1 })
      await lido.deposit(100, 1, '0x', { from: depositor })
      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
          annualBalanceIncreaseBPLimit: 100,
        },
        { from: voting, gasPrice: 1 }
      )

      await lido.handleOracleReport(0, ONE_DAY, 100, ETH(3200), 0, 0, 0, 0, { from: oracle, gasPrice: 1 })
      await checkStat({ depositedValidators: 100, beaconValidators: 100, beaconBalance: ETH(3200) })
    })

    it('reverts on validators reported when over limit', async () => {
      await lido.submit(ZERO_ADDRESS, { from: stranger, value: ETH(3200), gasPrice: 1 })
      await lido.deposit(101, 1, '0x', { from: depositor })
      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
          annualBalanceIncreaseBPLimit: 100,
        },
        { from: voting, gasPrice: 1 }
      )
      await assert.reverts(
        lido.handleOracleReport(0, ONE_DAY, 101, ETH(3200), 0, 0, 0, 0, { from: oracle, gasPrice: 1 }),
        'IncorrectAppearedValidators(101)'
      )
    })
  })

  describe('smooth report', async () => {
    beforeEach(async () => {
      await await lido.deposit(3, 1, '0x', { from: depositor })
      await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: 0 })
      await checkBalanceDeltas({
        totalPooledEtherDiff: 0,
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: 0,
        anotherStrangerBalanceDiff: 0,
        curatedModuleBalanceDiff: 0,
        initialHolderBalanceDiff: 0,
      })
    })

    it('does not smooth if report in limits', async () => {
      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
        },
        { from: voting, gasPrice: 1 }
      )
      await lido.handleOracleReport(0, ONE_YEAR, 3, ETH(97), 0, 0, 0, 0, { from: oracle, gasPrice: 1 })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(97) })
    })

    it('does not smooth if cl balance report over limit', async () => {
      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
        },
        { from: voting, gasPrice: 1 }
      )
      await lido.handleOracleReport(0, ONE_YEAR, 3, ETH(100), 0, 0, 0, 0, { from: oracle, gasPrice: 1 })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(100) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(4),
        treasuryBalanceDiff: ETH(4 * 0.05),
        strangerBalanceDiff: ETH(4 * 0.3 * 0.9),
        anotherStrangerBalanceDiff: ETH(4 * 0.69 * 0.9),
        curatedModuleBalanceDiff: ETH(4 * 0.05),
        initialHolderBalanceDiff: ETH(0.036),
      })
    })

    it('does not smooth withdrawals if report in limits', async () => {
      await setBalance(withdrawalVault, ETH(1))

      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
          annualBalanceIncreaseBPLimit: 100,
        },
        { from: voting, gasPrice: 1 }
      )
      await lido.handleOracleReport(0, ONE_YEAR, 3, ETH(96), ETH(1), 0, 0, 0, { from: oracle, gasPrice: 1 })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(1),
        treasuryBalanceDiff: ETH(0.05),
        strangerBalanceDiff: ETH(0.3 * 0.9),
        anotherStrangerBalanceDiff: ETH(0.69 * 0.9),
        curatedModuleBalanceDiff: ETH(0.05),
        initialHolderBalanceDiff: ETH(0.01 * 0.9),
      })
      assert.equals(await ethers.provider.getBalance(withdrawalVault), 0)
    })

    it('smooths withdrawals if report out of limit', async () => {
      await setBalance(withdrawalVault, ETH(1.1))

      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
          maxPositiveTokenRebase: 10000000,
        },
        { from: voting, gasPrice: 1 }
      )
      await lido.handleOracleReport(0, ONE_YEAR, 3, ETH(96), ETH(1.1), 0, 0, 0, { from: oracle, gasPrice: 1 })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(1),
        treasuryBalanceDiff: ETH(0.05),
        strangerBalanceDiff: ETH(0.3 * 0.9),
        anotherStrangerBalanceDiff: ETH(0.69 * 0.9),
        curatedModuleBalanceDiff: ETH(0.05),
        initialHolderBalanceDiff: ETH(0.01 * 0.9),
      })

      assert.equals(await ethers.provider.getBalance(withdrawalVault), ETH(0.1))
    })

    it('does not smooth el rewards if report in limit without lido fee', async () => {
      await setBalance(elRewardsVault, ETH(1))

      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
          maxPositiveTokenRebase: 10000000,
        },
        { from: voting, gasPrice: 1 }
      )
      await lido.handleOracleReport(0, ONE_YEAR, 3, ETH(96), 0, ETH(1), 0, 0, { from: oracle, gasPrice: 1 })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })

      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(1),
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: ETH(0.3),
        anotherStrangerBalanceDiff: ETH(0.69),
        curatedModuleBalanceDiff: 0,
        initialHolderBalanceDiff: ETH(0.01),
      })

      assert.equals(await ethers.provider.getBalance(elRewardsVault), ETH(0))
    })

    it('does not smooth el rewards if report in limit without lido fee 2', async () => {
      await setBalance(elRewardsVault, ETH(1.5))

      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
          maxPositiveTokenRebase: 10000000,
        },
        { from: voting, gasPrice: 1 }
      )
      await lido.handleOracleReport(0, ONE_YEAR, 3, ETH(95.5), 0, ETH(1.5), 0, 0, { from: oracle, gasPrice: 1 })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(95.5) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(1),
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: ETH(0.3),
        anotherStrangerBalanceDiff: ETH(0.69),
        curatedModuleBalanceDiff: 0,
        initialHolderBalanceDiff: ETH(0.01),
      })

      assert.equals(await ethers.provider.getBalance(elRewardsVault), ETH(0))
    })

    it('smooths el rewards if report out of limit without lido fee', async () => {
      await setBalance(elRewardsVault, ETH(1.1))

      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
          maxPositiveTokenRebase: 10000000,
        },
        { from: voting, gasPrice: 1 }
      )
      await lido.handleOracleReport(0, ONE_YEAR, 3, ETH(96), 0, ETH(1.1), 0, 0, { from: oracle, gasPrice: 1 })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(1),
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: ETH(0.3),
        anotherStrangerBalanceDiff: ETH(0.69),
        curatedModuleBalanceDiff: 0,
        initialHolderBalanceDiff: ETH(0.01),
      })

      assert.equals(await ethers.provider.getBalance(elRewardsVault), ETH(0.1))
    })

    it('does not smooth el rewards if report in limit', async () => {
      await setBalance(elRewardsVault, ETH(1))

      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
        },
        { from: voting, gasPrice: 1 }
      )
      await lido.handleOracleReport(0, ONE_YEAR, 3, ETH(96.1), 0, ETH(0.9), 0, 0, { from: oracle, gasPrice: 1 })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96.1) })

      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(1),
        treasuryBalanceDiff: ETH(0.05),
        strangerBalanceDiff: ETH(0.3 * 0.9),
        anotherStrangerBalanceDiff: ETH(0.69 * 0.9),
        curatedModuleBalanceDiff: ETH(0.05),
        initialHolderBalanceDiff: ETH(0.01 * 0.9),
      })

      assert.equals(await ethers.provider.getBalance(elRewardsVault), ETH(0.1))
    })

    it('smooths el rewards if report out of limit', async () => {
      await setBalance(elRewardsVault, ETH(1.1))

      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
          maxPositiveTokenRebase: 10000000,
        },
        { from: voting, gasPrice: 1 }
      )
      await lido.handleOracleReport(0, ONE_YEAR, 3, ETH(96.1), 0, ETH(1.1), 0, 0, { from: oracle, gasPrice: 1 })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96.1) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(1),
        treasuryBalanceDiff: ETH(0.05),
        strangerBalanceDiff: ETH(0.3 * 0.9),
        anotherStrangerBalanceDiff: ETH(0.69 * 0.9),
        curatedModuleBalanceDiff: ETH(0.05),
        initialHolderBalanceDiff: ETH(0.01 * 0.9),
      })

      assert.equals(await ethers.provider.getBalance(elRewardsVault), ETH(0.2))
    })
  })
  describe('daily reports', () => {
    beforeEach(async () => {
      await await lido.deposit(3, 1, '0x', { from: depositor })
      await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: 0 })
      await checkBalanceDeltas({
        totalPooledEtherDiff: 0,
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: 0,
        anotherStrangerBalanceDiff: 0,
        curatedModuleBalanceDiff: 0,
        initialHolderBalanceDiff: 0,
      })
    })
    it('smooths el rewards if report out of limit', async () => {
      await setBalance(elRewardsVault, ETH(1.1))

      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
          maxPositiveTokenRebase: 10000000,
        },
        { from: voting, gasPrice: 1 }
      )
      await lido.handleOracleReport(0, ONE_DAY, 3, ETH(96.1), 0, ETH(1.1), 0, 0, { from: oracle, gasPrice: 1 })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96.1) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(1),
        treasuryBalanceDiff: ETH(0.05),
        strangerBalanceDiff: ETH(0.3 * 0.9),
        anotherStrangerBalanceDiff: ETH(0.69 * 0.9),
        curatedModuleBalanceDiff: ETH(0.05),
        initialHolderBalanceDiff: ETH(0.01 * 0.9),
      })

      assert.equals(await ethers.provider.getBalance(elRewardsVault), ETH(0.2))
    })
    it('does not smooth if report in limits', async () => {
      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
        },
        { from: voting, gasPrice: 1 }
      )
      await lido.handleOracleReport(0, ONE_DAY, 3, ETH(96.0027), 0, 0, 0, 0, { from: oracle, gasPrice: 1 })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96.0027) })
    })

    it('does not smooth if cl balance report over limit', async () => {
      const clIncrease = 0.0028
      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
        },
        { from: voting, gasPrice: 1 }
      )
      await lido.handleOracleReport(0, ONE_DAY, 3, ETH(96 + 0.0028), 0, 0, 0, 0, { from: oracle, gasPrice: 1 })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96 + clIncrease) })
      assert(
        0.00014 + 0.0028 * 0.9 * 0.3 + 0.0028 * 0.9 * 0.69 + 0.0028 * 0.01 * 0.9 + 0.00014 === clIncrease,
        'cl balance increase'
      )
      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(clIncrease),
        treasuryBalanceDiff: ETH(0.00014),
        strangerBalanceDiff: ETH(0.0028 * 0.9 * 0.3),
        anotherStrangerBalanceDiff: ETH(0.0028 * 0.9 * 0.69),
        curatedModuleBalanceDiff: ETH(0.00014),
        initialHolderBalanceDiff: ETH(0.0028 * 0.01 * 0.9),
      })
    })

    it('does not smooth withdrawals if report in limits', async () => {
      await setBalance(withdrawalVault, ETH(1))

      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
          annualBalanceIncreaseBPLimit: 100,
        },
        { from: voting, gasPrice: 1 }
      )
      await lido.handleOracleReport(0, ONE_DAY, 3, ETH(96), ETH(1), 0, 0, 0, { from: oracle, gasPrice: 1 })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(1),
        treasuryBalanceDiff: ETH(0.05),
        strangerBalanceDiff: ETH(0.3 * 0.9),
        anotherStrangerBalanceDiff: ETH(0.69 * 0.9),
        curatedModuleBalanceDiff: ETH(0.05),
        initialHolderBalanceDiff: ETH(0.01 * 0.9),
      })
      assert.equals(await ethers.provider.getBalance(withdrawalVault), 0)
    })

    it('smooths withdrawals if report out of limit', async () => {
      await setBalance(withdrawalVault, ETH(1.1))

      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
          maxPositiveTokenRebase: 10000000,
        },
        { from: voting, gasPrice: 1 }
      )
      await lido.handleOracleReport(0, ONE_DAY, 3, ETH(96), ETH(1.1), 0, 0, 0, { from: oracle, gasPrice: 1 })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(1),
        treasuryBalanceDiff: ETH(0.05),
        strangerBalanceDiff: ETH(0.3 * 0.9),
        anotherStrangerBalanceDiff: ETH(0.69 * 0.9),
        curatedModuleBalanceDiff: ETH(0.05),
        initialHolderBalanceDiff: ETH(0.01 * 0.9),
      })

      assert.equals(await ethers.provider.getBalance(withdrawalVault), ETH(0.1))
    })

    it('does not smooth el rewards if report in limit without lido fee', async () => {
      await setBalance(elRewardsVault, ETH(1))

      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
          maxPositiveTokenRebase: 10000000,
        },
        { from: voting, gasPrice: 1 }
      )
      await lido.handleOracleReport(0, ONE_DAY, 3, ETH(96), 0, ETH(1), 0, 0, { from: oracle, gasPrice: 1 })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })

      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(1),
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: ETH(0.3),
        anotherStrangerBalanceDiff: ETH(0.69),
        curatedModuleBalanceDiff: 0,
        initialHolderBalanceDiff: ETH(0.01),
      })

      assert.equals(await ethers.provider.getBalance(elRewardsVault), ETH(0))
    })

    it('does not smooth el rewards if report in limit without lido fee 2', async () => {
      await setBalance(elRewardsVault, ETH(1.5))

      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
          maxPositiveTokenRebase: 10000000,
        },
        { from: voting, gasPrice: 1 }
      )
      await lido.handleOracleReport(0, ONE_DAY, 3, ETH(95.5), 0, ETH(1.5), 0, 0, { from: oracle, gasPrice: 1 })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(95.5) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(1),
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: ETH(0.3),
        anotherStrangerBalanceDiff: ETH(0.69),
        curatedModuleBalanceDiff: 0,
        initialHolderBalanceDiff: ETH(0.01),
      })

      assert.equals(await ethers.provider.getBalance(elRewardsVault), ETH(0))
    })

    it('smooths el rewards if report out of limit without lido fee', async () => {
      await setBalance(elRewardsVault, ETH(1.1))

      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
          maxPositiveTokenRebase: 10000000,
        },
        { from: voting, gasPrice: 1 }
      )
      await lido.handleOracleReport(0, ONE_DAY, 3, ETH(96), 0, ETH(1.1), 0, 0, { from: oracle, gasPrice: 1 })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96) })
      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(1),
        treasuryBalanceDiff: 0,
        strangerBalanceDiff: ETH(0.3),
        anotherStrangerBalanceDiff: ETH(0.69),
        curatedModuleBalanceDiff: 0,
        initialHolderBalanceDiff: ETH(0.01),
      })

      assert.equals(await ethers.provider.getBalance(elRewardsVault), ETH(0.1))
    })

    it('does not smooth el rewards if report in limit', async () => {
      await setBalance(elRewardsVault, ETH(1))

      await oracleReportSanityChecker.setOracleReportLimits(
        {
          ...ORACLE_REPORT_LIMITS_BOILERPLATE,
          churnValidatorsPerDayLimit: 100,
        },
        { from: voting, gasPrice: 1 }
      )
      await lido.handleOracleReport(0, ONE_DAY, 3, ETH(96.1), 0, ETH(0.9), 0, 0, { from: oracle, gasPrice: 1 })
      await checkStat({ depositedValidators: 3, beaconValidators: 3, beaconBalance: ETH(96.1) })

      await checkBalanceDeltas({
        totalPooledEtherDiff: ETH(1),
        treasuryBalanceDiff: ETH(0.05),
        strangerBalanceDiff: ETH(0.3 * 0.9),
        anotherStrangerBalanceDiff: ETH(0.69 * 0.9),
        curatedModuleBalanceDiff: ETH(0.05),
        initialHolderBalanceDiff: ETH(0.01 * 0.9),
      })

      assert.equals(await ethers.provider.getBalance(elRewardsVault), ETH(0.1))
    })
  })
})
