const { newDao, newApp } = require('../0.4.24/helpers/dao')
const { assertBn, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const { assertRevert } = require('../helpers/assertThrow')
const { e9 } = require('../helpers/utils')

const {
  deployAccountingOracleSetup,
  initAccountingOracle,
  deployMockLegacyOracle,
  CONSENSUS_VERSION,
  HASH_1, ZERO_HASH,
  getReportDataItems,
  calcReportDataHash
} = require('../0.8.9/oracle/accounting-oracle-deploy.test')

const SLOTS_PER_EPOCH = 32
const SECONDS_PER_SLOT = 12
const GENESIS_TIME = 1606824000
const EPOCHS_PER_FRAME = 225

const SLOTS_PER_FRAME = EPOCHS_PER_FRAME * SLOTS_PER_EPOCH
const SECONDS_PER_FRAME = SLOTS_PER_FRAME * SECONDS_PER_SLOT

// const EPOCH_LENGTH = 32 * 12

contract('AccountingOracle', ([appManager, voting, malicious1, malicious2, member1, member2, member3]) => {
  let lido, consensus, oracle

  const GOOD_DATA = {
    consensusVersion: CONSENSUS_VERSION,
    numValidators: 10,
    clBalanceGwei: 32,
    stakingModuleIdsWithNewlyExitedValidators: [],
    numExitedValidatorsByStakingModule: [],
    withdrawalVaultBalance: 0,
    elRewardsVaultBalance: 0,
    lastWithdrawalRequestIdToFinalize: 0,
    finalizationShareRate: 0,
    isBunkerMode: false,
    extraDataFormat: 0,
    extraDataHash: ZERO_HASH,
    extraDataItemsCount: 0
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
      getLegacyOracle: () => deployMockLegacyOracle({...timeConfig, lastCompletedEpochId: 0})
    })

    lido = deployed.lido
    consensus = deployed.consensus
    oracle = deployed.oracle

    await initAccountingOracle({...deployed, admin: voting})

    assert.equal(+await oracle.getTime(), GENESIS_TIME + SECONDS_PER_FRAME)

    await consensus.addMember(member1, 4, { from: voting })
    await consensus.addMember(member2, 4, { from: voting })
  })

  it('reverts with zero ref. slot', async () => {
    assertBn((await consensus.getCurrentFrame()).refSlot, 1 * SLOTS_PER_FRAME - 1)
    await assertRevert(
      consensus.submitReport(0, HASH_1, CONSENSUS_VERSION, { from: member1 }),
      'InvalidSlot()'
    )
  })

  it('oracle conract handles changing the oracles during epoch', async () => {
    await consensus.addMember(malicious1, 4, { from: voting })
    await consensus.addMember(malicious2, 4, { from: voting })

    const goodDataItems = getReportDataItems({...GOOD_DATA, refSlot: SLOTS_PER_FRAME - 1})
    const badDataItems = getReportDataItems({...BAD_DATA, refSlot: SLOTS_PER_FRAME - 1})
    const goodDataHash = calcReportDataHash(goodDataItems)
    const badDataHash = calcReportDataHash(badDataItems)

    await consensus.submitReport(SLOTS_PER_FRAME - 1, badDataHash, CONSENSUS_VERSION, { from: malicious1 })
    await consensus.submitReport(SLOTS_PER_FRAME - 1, badDataHash, CONSENSUS_VERSION, { from: malicious2 })
    await consensus.submitReport(SLOTS_PER_FRAME - 1, goodDataHash, CONSENSUS_VERSION, { from: member1 })
    await consensus.submitReport(SLOTS_PER_FRAME - 1, goodDataHash, CONSENSUS_VERSION, { from: member2 })

    await consensus.removeMember(malicious1, 3, { from: voting })
    await consensus.removeMember(malicious2, 3, { from: voting })
    await consensus.addMember(member3, 3, { from: voting })

    let tx = await consensus.submitReport(
      SLOTS_PER_FRAME - 1,
      goodDataHash,
      CONSENSUS_VERSION,
      { from: member3 }
    )

    assertEvent(tx, 'ConsensusReached', { expectedArgs: { refSlot: SLOTS_PER_FRAME - 1, report: goodDataHash, support: 3 } })

    tx = await oracle.submitReportData(goodDataItems, await oracle.getContractVersion(), { from: member3 })

    assertEvent(tx, 'ProcessingStarted', { expectedArgs: { refSlot: SLOTS_PER_FRAME - 1 } })

    const lastHandleOracleReportCall = await lido.getLastCall_handleOracleReport()
    assertBn(lastHandleOracleReportCall.clBalance, e9(GOOD_DATA.clBalanceGwei))
    assertBn(lastHandleOracleReportCall.numValidators, GOOD_DATA.numValidators)
  })
})
