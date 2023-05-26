const { ethers, artifacts, contract, web3 } = require('hardhat')
const { ZERO_ADDRESS } = require('../../helpers/constants')
const { assert } = require('../../helpers/assert')
const { hex, toBN } = require('../../helpers/utils')
const { EvmSnapshot } = require('../../helpers/blockchain')
const {
  updateLocatorImplementation,
  deployLocatorWithDummyAddressesImplementation,
} = require('../../helpers/locator-deploy')
const { calcAccountingReportDataHash, getAccountingReportDataItems } = require('../../helpers/reportData')

const {
  SLOTS_PER_EPOCH,
  SECONDS_PER_SLOT,
  GENESIS_TIME,
  SECONDS_PER_EPOCH,
  EPOCHS_PER_FRAME,
  SLOTS_PER_FRAME,
  SECONDS_PER_FRAME,
  computeSlotAt,
  computeEpochAt,
  computeEpochFirstSlotAt,
  computeEpochFirstSlot,
  computeTimestampAtSlot,
  computeTimestampAtEpoch,
  ZERO_HASH,
  HASH_1,
  HASH_2,
  HASH_3,
  HASH_4,
  HASH_5,
  CONSENSUS_VERSION,
  deployHashConsensus,
} = require('./hash-consensus-deploy.test')

const AccountingOracle = artifacts.require('AccountingOracleTimeTravellable')
const MockLido = artifacts.require('MockLidoForAccountingOracle')
const MockStakingRouter = artifacts.require('MockStakingRouterForAccountingOracle')
const MockWithdrawalQueue = artifacts.require('MockWithdrawalQueueForAccountingOracle')
const MockLegacyOracle = artifacts.require('MockLegacyOracle')

const V1_ORACLE_LAST_COMPLETED_EPOCH = 2 * EPOCHS_PER_FRAME
const V1_ORACLE_LAST_REPORT_SLOT = V1_ORACLE_LAST_COMPLETED_EPOCH * SLOTS_PER_EPOCH

const EXTRA_DATA_FORMAT_EMPTY = 0
const EXTRA_DATA_FORMAT_LIST = 1

const EXTRA_DATA_TYPE_STUCK_VALIDATORS = 1
const EXTRA_DATA_TYPE_EXITED_VALIDATORS = 2

function encodeExtraDataItem(itemIndex, itemType, moduleId, nodeOperatorIds, keysCounts) {
  const itemHeader = hex(itemIndex, 3) + hex(itemType, 2)
  const payloadHeader = hex(moduleId, 3) + hex(nodeOperatorIds.length, 8)
  const operatorIdsPayload = nodeOperatorIds.map((id) => hex(id, 8)).join('')
  const keysCountsPayload = keysCounts.map((count) => hex(count, 16)).join('')
  return '0x' + itemHeader + payloadHeader + operatorIdsPayload + keysCountsPayload
}

function encodeExtraDataItems({ stuckKeys, exitedKeys }) {
  const items = []
  const encodeItem = (item, type) =>
    encodeExtraDataItem(items.length, type, item.moduleId, item.nodeOpIds, item.keysCounts)
  stuckKeys.forEach((item) => items.push(encodeItem(item, EXTRA_DATA_TYPE_STUCK_VALIDATORS)))
  exitedKeys.forEach((item) => items.push(encodeItem(item, EXTRA_DATA_TYPE_EXITED_VALIDATORS)))
  return items
}

function packExtraDataList(extraDataItems) {
  return '0x' + extraDataItems.map((s) => s.substr(2)).join('')
}

function calcExtraDataListHash(packedExtraDataList) {
  return web3.utils.keccak256(packedExtraDataList)
}

async function deployMockLegacyOracle({
  epochsPerFrame = EPOCHS_PER_FRAME,
  slotsPerEpoch = SLOTS_PER_EPOCH,
  secondsPerSlot = SECONDS_PER_SLOT,
  genesisTime = GENESIS_TIME,
  lastCompletedEpochId = V1_ORACLE_LAST_COMPLETED_EPOCH,
} = {}) {
  const legacyOracle = await MockLegacyOracle.new()
  await legacyOracle.setParams(epochsPerFrame, slotsPerEpoch, secondsPerSlot, genesisTime, lastCompletedEpochId)
  return legacyOracle
}

async function deployMockLidoAndStakingRouter() {
  const stakingRouter = await MockStakingRouter.new()
  const withdrawalQueue = await MockWithdrawalQueue.new()
  const lido = await MockLido.new()
  return { lido, stakingRouter, withdrawalQueue }
}

async function deployAccountingOracleSetup(
  admin,
  {
    initialEpoch = null,
    epochsPerFrame = EPOCHS_PER_FRAME,
    slotsPerEpoch = SLOTS_PER_EPOCH,
    secondsPerSlot = SECONDS_PER_SLOT,
    genesisTime = GENESIS_TIME,
    getLidoAndStakingRouter = deployMockLidoAndStakingRouter,
    getLegacyOracle = deployMockLegacyOracle,
    lidoLocatorAddr: lidoLocatorAddrArg,
    legacyOracleAddr: legacyOracleAddrArg,
    lidoAddr: lidoAddrArg,
  } = {}
) {
  const locatorAddr = (await deployLocatorWithDummyAddressesImplementation(admin)).address
  const { lido, stakingRouter, withdrawalQueue } = await getLidoAndStakingRouter()
  const oracleReportSanityChecker = await deployOracleReportSanityCheckerForAccounting(locatorAddr, admin)

  const legacyOracle = await getLegacyOracle()

  if (initialEpoch == null) {
    initialEpoch = +(await legacyOracle.getLastCompletedEpochId()) + epochsPerFrame
  }

  const oracle = await AccountingOracle.new(
    lidoLocatorAddrArg || locatorAddr,
    lidoAddrArg || lido.address,
    legacyOracleAddrArg || legacyOracle.address,
    secondsPerSlot,
    genesisTime,
    { from: admin }
  )

  const { consensus } = await deployHashConsensus(admin, {
    reportProcessor: oracle,
    epochsPerFrame,
    slotsPerEpoch,
    secondsPerSlot,
    genesisTime,
    initialEpoch,
  })
  await updateLocatorImplementation(locatorAddr, admin, {
    lido: lidoAddrArg || lido.address,
    stakingRouter: stakingRouter.address,
    withdrawalQueue: withdrawalQueue.address,
    oracleReportSanityChecker: oracleReportSanityChecker.address,
    accountingOracle: oracle.address,
  })

  // pretend we're at the first slot of the initial frame's epoch
  await consensus.setTime(genesisTime + initialEpoch * slotsPerEpoch * secondsPerSlot)

  return {
    lido,
    stakingRouter,
    withdrawalQueue,
    locatorAddr,
    legacyOracle,
    oracle,
    consensus,
    oracleReportSanityChecker,
  }
}

async function initAccountingOracle({
  admin,
  oracle,
  consensus,
  dataSubmitter = null,
  consensusVersion = CONSENSUS_VERSION,
  shouldMigrateLegacyOracle = true,
  lastProcessingRefSlot,
}) {
  let initTx
  if (shouldMigrateLegacyOracle)
    initTx = await oracle.initialize(admin, consensus.address, consensusVersion, { from: admin })
  else
    initTx = await oracle.initializeWithoutMigration(
      admin,
      consensus.address,
      consensusVersion,
      lastProcessingRefSlot,
      { from: admin }
    )

  await oracle.grantRole(await oracle.MANAGE_CONSENSUS_CONTRACT_ROLE(), admin, { from: admin })
  await oracle.grantRole(await oracle.MANAGE_CONSENSUS_VERSION_ROLE(), admin, { from: admin })

  if (dataSubmitter != null) {
    await oracle.grantRole(await oracle.SUBMIT_DATA_ROLE(), dataSubmitter, { from: admin })
  }

  assert.equals(await oracle.EXTRA_DATA_FORMAT_EMPTY(), EXTRA_DATA_FORMAT_EMPTY)
  assert.equals(await oracle.EXTRA_DATA_FORMAT_LIST(), EXTRA_DATA_FORMAT_LIST)
  assert.equals(await oracle.EXTRA_DATA_TYPE_STUCK_VALIDATORS(), EXTRA_DATA_TYPE_STUCK_VALIDATORS)
  assert.equals(await oracle.EXTRA_DATA_TYPE_EXITED_VALIDATORS(), EXTRA_DATA_TYPE_EXITED_VALIDATORS)

  return initTx
}

async function deployOracleReportSanityCheckerForAccounting(lidoLocator, admin) {
  const churnValidatorsPerDayLimit = 100
  const limitsList = [churnValidatorsPerDayLimit, 0, 0, 0, 32 * 12, 15, 16, 0, 0]
  const managersRoster = [[admin], [admin], [admin], [admin], [admin], [admin], [admin], [admin], [admin], [admin]]

  const OracleReportSanityChecker = artifacts.require('OracleReportSanityChecker')

  const oracleReportSanityChecker = await OracleReportSanityChecker.new(
    lidoLocator,
    admin,
    limitsList,
    managersRoster,
    {
      from: admin,
    }
  )
  return oracleReportSanityChecker
}

async function configureAccountingOracleSetup({
  admin,
  consensus,
  oracle,
  legacyOracle,
  dataSubmitter = null,
  consensusVersion = CONSENSUS_VERSION,
} = {}) {
  // this is done as a part of the protocol upgrade voting execution

  const frameConfig = await consensus.getFrameConfig()
  // TODO: Double check it
  await consensus.setTimeInEpochs(await legacyOracle.getLastCompletedEpochId())

  const initialEpoch = +(await legacyOracle.getLastCompletedEpochId()) + +frameConfig.epochsPerFrame

  const updateInitialEpochIx = await consensus.updateInitialEpoch(initialEpoch, { from: admin })
  const initTx = await initAccountingOracle({ admin, oracle, consensus, dataSubmitter, consensusVersion })

  return { updateInitialEpochIx, initTx }
}

async function deployAndConfigureAccountingOracle(admin) {
  /// this is done (far) before the protocol upgrade voting initiation:
  ///   1. deploy HashConsensus
  ///   2. deploy AccountingOracle impl
  const deployed = await deployAccountingOracleSetup(admin)

  // pretend we're after the legacy oracle's last proc epoch but before the new oracle's initial epoch
  assert.isAbove(EPOCHS_PER_FRAME, 1)
  const voteExecTime = GENESIS_TIME + (V1_ORACLE_LAST_COMPLETED_EPOCH + 1) * SLOTS_PER_EPOCH * SECONDS_PER_SLOT
  await deployed.consensus.setTime(voteExecTime)

  /// this is done as a part of the protocol upgrade voting execution:
  ///   1. calculate HashConsensus initial epoch as the last finalized legacy epoch + frame size
  ///   2. set HashConsensus initial epoch
  ///   3. deploy AccountingOracle proxy (skipped in these tests as they're not testing the proxy setup)
  ///   4. initialize AccountingOracle
  const finalizeResult = await configureAccountingOracleSetup({ admin, ...deployed })

  // pretend we're at the first slot of the new oracle's initial epoch
  const initialEpoch = V1_ORACLE_LAST_COMPLETED_EPOCH + EPOCHS_PER_FRAME
  await deployed.consensus.setTime(GENESIS_TIME + initialEpoch * SLOTS_PER_EPOCH * SECONDS_PER_SLOT)

  return { ...deployed, ...finalizeResult }
}

async function getInitialFrameStartTime(consensus) {
  const chainConfig = await consensus.getChainConfig()
  const frameConfig = await consensus.getFrameConfig()
  return toBN(frameConfig.initialEpoch)
    .muln(+chainConfig.slotsPerEpoch)
    .muln(+chainConfig.secondsPerSlot)
    .add(toBN(chainConfig.genesisTime))
}

module.exports = {
  SLOTS_PER_EPOCH,
  SECONDS_PER_SLOT,
  GENESIS_TIME,
  SECONDS_PER_EPOCH,
  EPOCHS_PER_FRAME,
  SLOTS_PER_FRAME,
  SECONDS_PER_FRAME,
  ZERO_HASH,
  HASH_1,
  HASH_2,
  HASH_3,
  HASH_4,
  HASH_5,
  computeSlotAt,
  computeEpochAt,
  computeEpochFirstSlotAt,
  computeEpochFirstSlot,
  computeTimestampAtSlot,
  computeTimestampAtEpoch,
  CONSENSUS_VERSION,
  V1_ORACLE_LAST_COMPLETED_EPOCH,
  V1_ORACLE_LAST_REPORT_SLOT,
  EXTRA_DATA_FORMAT_EMPTY,
  EXTRA_DATA_FORMAT_LIST,
  EXTRA_DATA_TYPE_STUCK_VALIDATORS,
  EXTRA_DATA_TYPE_EXITED_VALIDATORS,
  deployAndConfigureAccountingOracle,
  deployAccountingOracleSetup,
  initAccountingOracle,
  configureAccountingOracleSetup,
  deployMockLegacyOracle,
  deployMockLidoAndStakingRouter,
  getAccountingReportDataItems,
  calcAccountingReportDataHash,
  encodeExtraDataItem,
  encodeExtraDataItems,
  packExtraDataList,
  calcExtraDataListHash,
  getInitialFrameStartTime,
}

contract('AccountingOracle', ([admin, member1]) => {
  let consensus
  let oracle
  let mockLido
  let mockStakingRouter
  let mockWithdrawalQueue
  let legacyOracle

  context('Deployment and initial configuration', () => {
    const updateInitialEpoch = async (consensus) => {
      // pretend we're after the legacy oracle's last proc epoch but before the new oracle's initial epoch
      const voteExecTime = GENESIS_TIME + (V1_ORACLE_LAST_COMPLETED_EPOCH + 1) * SLOTS_PER_EPOCH * SECONDS_PER_SLOT
      await consensus.setTime(voteExecTime)
      await consensus.updateInitialEpoch(V1_ORACLE_LAST_COMPLETED_EPOCH + EPOCHS_PER_FRAME)
    }

    it('init fails if the chain config is different from the one of the legacy oracle', async () => {
      let deployed = await deployAccountingOracleSetup(admin, {
        getLegacyOracle: () => deployMockLegacyOracle({ slotsPerEpoch: SLOTS_PER_EPOCH + 1 }),
      })
      await updateInitialEpoch(deployed.consensus)
      await assert.reverts(initAccountingOracle({ admin, ...deployed }), 'IncorrectOracleMigration(0)')

      deployed = await deployAccountingOracleSetup(admin, {
        getLegacyOracle: () => deployMockLegacyOracle({ secondsPerSlot: SECONDS_PER_SLOT + 1 }),
      })
      await updateInitialEpoch(deployed.consensus)
      await assert.reverts(initAccountingOracle({ admin, ...deployed }), 'IncorrectOracleMigration(0)')

      deployed = await deployAccountingOracleSetup(admin, {
        getLegacyOracle: () => deployMockLegacyOracle({ genesisTime: GENESIS_TIME + 1 }),
      })
      await updateInitialEpoch(deployed.consensus)
      await assert.reverts(initAccountingOracle({ admin, ...deployed }), 'IncorrectOracleMigration(0)')
    })

    it('init fails if the frame size is different from the one of the legacy oracle', async () => {
      const deployed = await deployAccountingOracleSetup(admin, {
        getLegacyOracle: () => deployMockLegacyOracle({ epochsPerFrame: EPOCHS_PER_FRAME - 1 }),
      })
      await updateInitialEpoch(deployed.consensus)
      await assert.reverts(initAccountingOracle({ admin, ...deployed }), 'IncorrectOracleMigration(1)')
    })

    it(`init fails if the initial epoch of the new oracle is not the next frame's first epoch`, async () => {
      const deployed = await deployAccountingOracleSetup(admin)

      const voteExecTime = GENESIS_TIME + (V1_ORACLE_LAST_COMPLETED_EPOCH + 1) * SLOTS_PER_EPOCH * SECONDS_PER_SLOT
      await deployed.consensus.setTime(voteExecTime)

      const snapshot = new EvmSnapshot(ethers.provider)
      await snapshot.make()

      await deployed.consensus.updateInitialEpoch(V1_ORACLE_LAST_COMPLETED_EPOCH + EPOCHS_PER_FRAME - 1)
      await assert.reverts(initAccountingOracle({ admin, ...deployed }), 'IncorrectOracleMigration(2)')
      await snapshot.rollback()

      await deployed.consensus.updateInitialEpoch(V1_ORACLE_LAST_COMPLETED_EPOCH + EPOCHS_PER_FRAME + 1)
      await assert.reverts(initAccountingOracle({ admin, ...deployed }), 'IncorrectOracleMigration(2)')
      await snapshot.rollback()

      await deployed.consensus.updateInitialEpoch(V1_ORACLE_LAST_COMPLETED_EPOCH + 2 * EPOCHS_PER_FRAME)
      await assert.reverts(initAccountingOracle({ admin, ...deployed }), 'IncorrectOracleMigration(2)')
      await snapshot.rollback()
    })

    it('reverts when slotsPerSecond is zero', async () => {
      await assert.reverts(deployAccountingOracleSetup(admin, { secondsPerSlot: 0 }), 'SecondsPerSlotCannotBeZero()')
    })

    it('deployment and init finishes successfully otherwise', async () => {
      const deployed = await deployAccountingOracleSetup(admin)

      const voteExecTime = GENESIS_TIME + (V1_ORACLE_LAST_COMPLETED_EPOCH + 1) * SLOTS_PER_EPOCH * SECONDS_PER_SLOT
      await deployed.consensus.setTime(voteExecTime)
      await deployed.consensus.updateInitialEpoch(V1_ORACLE_LAST_COMPLETED_EPOCH + EPOCHS_PER_FRAME)

      await initAccountingOracle({ admin, ...deployed })

      const refSlot = await deployed.oracle.getLastProcessingRefSlot()
      const epoch = await deployed.legacyOracle.getLastCompletedEpochId()
      assert.equals(refSlot, epoch.muln(SLOTS_PER_EPOCH))
    })

    it('deployment and init finishes successfully (default setup)', async () => {
      const deployed = await deployAndConfigureAccountingOracle(admin)
      consensus = deployed.consensus
      oracle = deployed.oracle
      mockLido = deployed.lido
      mockStakingRouter = deployed.stakingRouter
      mockWithdrawalQueue = deployed.withdrawalQueue
      legacyOracle = deployed.legacyOracle
    })

    it('mock setup is correct', async () => {
      // check the mock time-travellable setup
      const time1 = +(await consensus.getTime())
      assert.equals(await oracle.getTime(), time1)

      await consensus.advanceTimeBy(SECONDS_PER_SLOT)

      const time2 = +(await consensus.getTime())
      assert.equal(time2, time1 + SECONDS_PER_SLOT)
      assert.equals(await oracle.getTime(), time2)

      const handleOracleReportCallData = await mockLido.getLastCall_handleOracleReport()
      assert.equals(handleOracleReportCallData.callCount, 0)

      const updateExitedKeysByModuleCallData = await mockStakingRouter.lastCall_updateExitedKeysByModule()
      assert.equals(updateExitedKeysByModuleCallData.callCount, 0)

      assert.equals(await mockStakingRouter.totalCalls_reportExitedKeysByNodeOperator(), 0)
      assert.equals(await mockStakingRouter.totalCalls_reportStuckKeysByNodeOperator(), 0)

      const onOracleReportLastCall = await mockWithdrawalQueue.lastCall__onOracleReport()
      assert.equals(onOracleReportLastCall.callCount, 0)
    })

    it('the initial reference slot is greater than the last one of the legacy oracle', async () => {
      const legacyRefSlot = +(await legacyOracle.getLastCompletedEpochId()) * SLOTS_PER_EPOCH
      assert.isAbove(+(await consensus.getCurrentFrame()).refSlot, legacyRefSlot)
    })

    it('initial configuration is correct', async () => {
      assert.equal(await oracle.getConsensusContract(), consensus.address)
      assert.equals(await oracle.getConsensusVersion(), CONSENSUS_VERSION)
      assert.equal(await oracle.LIDO(), mockLido.address)
      assert.equals(await oracle.SECONDS_PER_SLOT(), SECONDS_PER_SLOT)
    })

    it('constructor reverts if lido locator address is zero', async () => {
      await assert.reverts(
        deployAccountingOracleSetup(admin, { lidoLocatorAddr: ZERO_ADDRESS }),
        'LidoLocatorCannotBeZero()'
      )
    })

    it('constructor reverts if legacy oracle address is zero', async () => {
      await assert.reverts(
        deployAccountingOracleSetup(admin, { legacyOracleAddr: ZERO_ADDRESS }),
        'LegacyOracleCannotBeZero()'
      )
    })

    it('constructor reverts if lido address is zero', async () => {
      await assert.reverts(deployAccountingOracleSetup(admin, { lidoAddr: ZERO_ADDRESS }), 'LidoCannotBeZero()')
    })

    it('initialize reverts if admin address is zero', async () => {
      const deployed = await deployAccountingOracleSetup(admin)
      await updateInitialEpoch(deployed.consensus)
      await assert.reverts(
        deployed.oracle.initialize(ZERO_ADDRESS, deployed.consensus.address, CONSENSUS_VERSION, { from: admin }),
        'AdminCannotBeZero()'
      )
    })

    it('initializeWithoutMigration reverts if admin address is zero', async () => {
      const deployed = await deployAccountingOracleSetup(admin)
      await updateInitialEpoch(deployed.consensus)

      await assert.reverts(
        deployed.oracle.initializeWithoutMigration(ZERO_ADDRESS, deployed.consensus.address, CONSENSUS_VERSION, 0, {
          from: admin,
        }),
        'AdminCannotBeZero()'
      )
    })

    it('initializeWithoutMigration succeeds otherwise', async () => {
      const deployed = await deployAccountingOracleSetup(admin)
      await updateInitialEpoch(deployed.consensus)
      await deployed.oracle.initializeWithoutMigration(admin, deployed.consensus.address, CONSENSUS_VERSION, 0, {
        from: admin,
      })
    })
  })
})
