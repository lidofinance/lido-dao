const { contract } = require('hardhat')

const { assert } = require('../helpers/assert')
const { e9 } = require('../helpers/utils')

const {
  deployAccountingOracleSetup,
  configureAccountingOracleSetup,
  getInitialFrameStartTime,
  deployMockLegacyOracle,
  CONSENSUS_VERSION,
  ZERO_HASH,
  getAccountingReportDataItems,
  calcAccountingReportDataHash,
} = require('../0.8.9/oracle/accounting-oracle-deploy.test')

const SLOTS_PER_EPOCH = 32
const SECONDS_PER_SLOT = 12
const GENESIS_TIME = 1606824000
const EPOCHS_PER_FRAME = 225

contract('AccountingOracle', ([voting, malicious1, malicious2, member1, member2, member3]) => {
  let lido, consensus, oracle

  const GOOD_DATA = {
    consensusVersion: CONSENSUS_VERSION,
    numValidators: 10,
    clBalanceGwei: 32,
    stakingModuleIdsWithNewlyExitedValidators: [],
    numExitedValidatorsByStakingModule: [],
    withdrawalVaultBalance: 0,
    elRewardsVaultBalance: 0,
    sharesRequestedToBurn: 0,
    withdrawalFinalizationBatches: [],
    simulatedShareRate: 0,
    isBunkerMode: false,
    extraDataFormat: 0,
    extraDataHash: ZERO_HASH,
    extraDataItemsCount: 0,
  }

  const BAD_DATA = {
    ...GOOD_DATA,
    clBalanceGwei: 42,
    numValidators: 42,
  }

  beforeEach('deploy dao and app', async () => {
    const timeConfig = {
      epochsPerFrame: EPOCHS_PER_FRAME,
      slotsPerEpoch: SLOTS_PER_EPOCH,
      secondsPerSlot: SECONDS_PER_SLOT,
      genesisTime: GENESIS_TIME,
    }

    const deployed = await deployAccountingOracleSetup(voting, {
      ...timeConfig,
      getLegacyOracle: () => deployMockLegacyOracle({ ...timeConfig, lastCompletedEpochId: 0 }),
    })

    lido = deployed.lido
    consensus = deployed.consensus
    oracle = deployed.oracle

    await configureAccountingOracleSetup({ ...deployed, admin: voting })
    await consensus.setTime(await getInitialFrameStartTime(consensus))

    await consensus.addMember(member1, 4, { from: voting })
    await consensus.addMember(member2, 4, { from: voting })
  })

  it('oracle contract handles changing the oracles during epoch', async () => {
    const { refSlot } = await consensus.getCurrentFrame()

    await consensus.addMember(malicious1, 4, { from: voting })
    await consensus.addMember(malicious2, 4, { from: voting })

    const goodDataItems = getAccountingReportDataItems({ ...GOOD_DATA, refSlot })
    const badDataItems = getAccountingReportDataItems({ ...BAD_DATA, refSlot })
    const goodDataHash = calcAccountingReportDataHash(goodDataItems)
    const badDataHash = calcAccountingReportDataHash(badDataItems)

    await consensus.submitReport(refSlot, badDataHash, CONSENSUS_VERSION, { from: malicious1 })
    await consensus.submitReport(refSlot, badDataHash, CONSENSUS_VERSION, { from: malicious2 })
    await consensus.submitReport(refSlot, goodDataHash, CONSENSUS_VERSION, { from: member1 })
    await consensus.submitReport(refSlot, goodDataHash, CONSENSUS_VERSION, { from: member2 })

    await consensus.removeMember(malicious1, 3, { from: voting })
    await consensus.removeMember(malicious2, 3, { from: voting })
    await consensus.addMember(member3, 3, { from: voting })

    let tx = await consensus.submitReport(refSlot, goodDataHash, CONSENSUS_VERSION, { from: member3 })

    assert.emits(tx, 'ConsensusReached', {
      refSlot: +refSlot,
      report: goodDataHash,
      support: 3,
    })

    tx = await oracle.submitReportData(goodDataItems, await oracle.getContractVersion(), { from: member3 })

    assert.emits(tx, 'ProcessingStarted', { refSlot: +refSlot })

    const lastHandleOracleReportCall = await lido.getLastCall_handleOracleReport()
    assert.equals(lastHandleOracleReportCall.clBalance, e9(GOOD_DATA.clBalanceGwei))
    assert.equals(lastHandleOracleReportCall.numValidators, GOOD_DATA.numValidators)
  })
})
