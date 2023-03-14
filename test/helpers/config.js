const factories = require('./factories')

const { SECONDS_PER_EPOCH } = require('./constants')

const DEFAULT_DEPLOY_PARAMS = {
  maxDepositsPerBlock: 100,
  minDepositBlockDistance: 20,
  pauseIntentValidityPeriodBlocks: 10,
  guardians: {
    '0x5fc0e75bf6502009943590492b02a1d08eac9c43': '0x3578665169e03e05a26bd5c565ffd12c81a1e0df7d0679f8aee4153110a83c8c',
    '0x8516cbb5abe73d775bfc0d21af226e229f7181a3': '0x88868f0fb667cfe50261bb385be8987e0ce62faee934af33c3026cf65f25f09e',
    '0xdaead0e0194abd565d28c1013399801d79627c14': '0x75e6f508b637327debc90962cd38943ddb9cfc1fc4a8572fc5e3d0984e1261de',
  },
  depositRoot: '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137',
  genesisTime: ~~(+new Date() / 1000) - SECONDS_PER_EPOCH * 675,
  lastCompletedEpoch: 1,
  v1OracleLastCompletedEpoch: 1,
  hashConsensus: {
    fastLaneLengthSlots: 0,
  },
  oracleReportSanityChecker: {
    limitsList: {
      churnValidatorsPerDayLimit: 255,
      oneOffCLBalanceDecreaseBPLimit: 10000,
      annualBalanceIncreaseBPLimit: 10000,
      simulatedShareRateDeviationBPLimit: 10000,
      maxValidatorExitRequestsPerReport: 10000,
      maxAccountingExtraDataListItemsCount: 100,
      maxNodeOperatorsPerExtraDataItemCount: 100,
      requestTimestampMargin: 0,
      maxPositiveTokenRebase: 1000000000,
    },
    managersRoster: {
      allLimitsManagers: [],
      churnValidatorsPerDayLimitManagers: [],
      oneOffCLBalanceDecreaseLimitManagers: [],
      annualBalanceIncreaseLimitManagers: [],
      shareRateDeviationLimitManagers: [],
      maxValidatorExitRequestsPerReportManagers: [],
      maxAccountingExtraDataListItemsCountManagers: [],
      maxNodeOperatorsPerExtraDataItemCountManagers: [],
      requestTimestampMarginManagers: [],
      maxPositiveTokenRebaseManagers: [],
    },
  },
}

const DEFAULT_FACTORIES = {
  appManagerFactory: factories.appManagerFactory,
  treasuryFactory: factories.treasuryFactory,
  votingFactory: factories.votingEOAFactory,
  lidoFactory: factories.lidoMockFactory,
  wstethFactory: factories.wstethFactory,
  legacyOracleFactory: factories.legacyOracleMockFactory,
  accountingOracleFactory: factories.accountingOracleFactory,
  hashConsensusFactory: factories.hashConsensusFactory,
  reportProcessorFactory: factories.reportProcessorFactory,
  depositContractFactory: factories.depositContractMockFactory,
  stakingRouterFactory: factories.stakingRouterFactory,
  depositSecurityModuleFactory: factories.depositSecurityModuleFactory,
  elRewardsVaultFactory: factories.elRewardsVaultFactory,
  withdrawalQueueFactory: factories.withdrawalQueueFactory,
  withdrawalVaultFactory: factories.withdrawalVaultFactory,
  eip712StETHFactory: factories.eip712StETHFactory,
  withdrawalCredentialsFactory: factories.withdrawalCredentialsFactory,
  stakingModulesFactory: factories.stakingModulesFactory,
  guardiansFactory: factories.guardiansFactory,
  burnerFactory: factories.burnerFactory,
  postSetup: factories.postSetup,
  lidoLocatorFactory: factories.lidoLocatorFactory,
  validatorExitBusFactory: factories.validatorExitBusFactory,
  oracleReportSanityCheckerFactory: factories.oracleReportSanityCheckerFactory,
}

module.exports = {
  DEFAULT_FACTORIES,
  DEFAULT_DEPLOY_PARAMS,
}
