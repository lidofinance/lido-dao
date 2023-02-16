const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const { assert } = require('../../helpers/assert')
const { hex } = require('../../helpers/utils')
const {
  updateLocatorImplementation,
  deployLocatorWithDummyAddressesImplementation
} = require('../../helpers/locator-deploy')

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
  deployHashConsensus
} = require('./hash-consensus-deploy.test')

const AccountingOracle = artifacts.require('AccountingOracleTimeTravellable')
const LidoLocator = artifacts.require('LidoLocator')
const MockLido = artifacts.require('MockLidoForAccountingOracle')
const MockStakingRouter = artifacts.require('MockStakingRouterForAccountingOracle')
const MockWithdrawalQueue = artifacts.require('MockWithdrawalQueueForAccountingOracle')
const MockLegacyOracle = artifacts.require('MockLegacyOracle')

const V1_ORACLE_LAST_COMPLETED_EPOCH = 2 * EPOCHS_PER_FRAME
const V1_ORACLE_LAST_REPORT_SLOT = V1_ORACLE_LAST_COMPLETED_EPOCH * SLOTS_PER_EPOCH

const EXTRA_DATA_FORMAT_LIST = 1
const EXTRA_DATA_FORMAT_EMPTY = 0

const EXTRA_DATA_TYPE_STUCK_VALIDATORS = 1
const EXTRA_DATA_TYPE_EXITED_VALIDATORS = 2
function getReportDataItems(r) {
  return [
    r.consensusVersion,
    +r.refSlot,
    r.numValidators,
    r.clBalanceGwei,
    r.stakingModuleIdsWithNewlyExitedValidators,
    r.numExitedValidatorsByStakingModule,
    r.withdrawalVaultBalance,
    r.elRewardsVaultBalance,
    r.lastWithdrawalRequestIdToFinalize,
    r.finalizationShareRate,
    r.isBunkerMode,
    r.extraDataFormat,
    r.extraDataHash,
    r.extraDataItemsCount
  ]
}

function calcReportDataHash(reportItems) {
  const data = web3.eth.abi.encodeParameters(
    [
      '(uint256,uint256,uint256,uint256,uint256[],uint256[],uint256,uint256,uint256,uint256,bool,uint256,bytes32,uint256)'
    ],
    [reportItems]
  )
  return web3.utils.keccak256(data)
}

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
async function deployOracleReportSanityCheckerForAccounting(lidoLocator, admin) {
  const churnValidatorsPerDayLimit = 100
  const limitsList = [churnValidatorsPerDayLimit, 0, 0, 0, 0, 0, 32 * 12, 15]
  const managersRoster = [[admin], [admin], [admin], [admin], [admin], [admin], [admin], [admin], [admin]]

  const OracleReportSanityChecker = artifacts.require('OracleReportSanityChecker')

  const oracleReportSanityChecker = await OracleReportSanityChecker.new(
    lidoLocator,
    admin,
    limitsList,
    managersRoster,
    {
      from: admin
    }
  )
  return oracleReportSanityChecker
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
  deployMockLegacyOracle,
  deployMockLidoAndStakingRouter,
  getReportDataItems,
  calcReportDataHash,
  encodeExtraDataItem,
  encodeExtraDataItems,
  packExtraDataList,
  calcExtraDataListHash
}
async function deployMockLegacyOracle({
  epochsPerFrame = EPOCHS_PER_FRAME,
  slotsPerEpoch = SLOTS_PER_EPOCH,
  secondsPerSlot = SECONDS_PER_SLOT,
  genesisTime = GENESIS_TIME,
  lastCompletedEpochId = V1_ORACLE_LAST_COMPLETED_EPOCH
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
    legacyOracleAddr: legacyOracleAddrArg
  } = {}
) {
  const locatorAddr = (await deployLocatorWithDummyAddressesImplementation(admin)).address
  const { lido, stakingRouter, withdrawalQueue } = await getLidoAndStakingRouter()
  const oracleReportSanityChecker = await deployOracleReportSanityCheckerForAccounting(locatorAddr, admin)

  await updateLocatorImplementation(locatorAddr, admin, {
    lido: lido.address,
    stakingRouter: stakingRouter.address,
    withdrawalQueue: withdrawalQueue.address,
    oracleReportSanityChecker: oracleReportSanityChecker.address
  })

  const legacyOracle = await getLegacyOracle()

  if (initialEpoch == null) {
    initialEpoch = +(await legacyOracle.getLastCompletedEpochId()) + epochsPerFrame
  }

  const oracle = await AccountingOracle.new(
    lidoLocatorAddrArg || locatorAddr,
    lido.address,
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
    initialEpoch
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
    oracleReportSanityChecker
  }
}

async function initAccountingOracle({
  admin,
  oracle,
  consensus,
  dataSubmitter = null,
  consensusVersion = CONSENSUS_VERSION
}) {
  const initTx = await oracle.initialize(admin, consensus.address, consensusVersion, { from: admin })

  await oracle.grantRole(await oracle.MANAGE_CONSENSUS_CONTRACT_ROLE(), admin, { from: admin })
  await oracle.grantRole(await oracle.MANAGE_CONSENSUS_VERSION_ROLE(), admin, { from: admin })

  if (dataSubmitter != null) {
    await oracle.grantRole(await oracle.SUBMIT_DATA_ROLE(), dataSubmitter, { from: admin })
  }

  assert.equal(+(await oracle.EXTRA_DATA_FORMAT_EMPTY()), EXTRA_DATA_FORMAT_EMPTY)
  assert.equal(+(await oracle.EXTRA_DATA_FORMAT_LIST()), EXTRA_DATA_FORMAT_LIST)
  assert.equal(+(await oracle.EXTRA_DATA_TYPE_STUCK_VALIDATORS()), EXTRA_DATA_TYPE_STUCK_VALIDATORS)
  assert.equal(+(await oracle.EXTRA_DATA_TYPE_EXITED_VALIDATORS()), EXTRA_DATA_TYPE_EXITED_VALIDATORS)

  return initTx
}

async function deployAndConfigureAccountingOracle(admin) {
  const deployed = await deployAccountingOracleSetup(admin)
  const initTx = await initAccountingOracle({ admin, ...deployed })
  return { ...deployed, initTx }
}
contract('AccountingOracle', ([admin, member1]) => {
  let consensus
  let oracle
  let mockLido
  let mockStakingRouter
  let mockWithdrawalQueue
  let legacyOracle

  context('Deployment and initial configuration', () => {
    it('init fails if the chain config is different from the one of the legacy oracle', async () => {
      let deployed = await deployAccountingOracleSetup(admin, {
        getLegacyOracle: () => deployMockLegacyOracle({ slotsPerEpoch: SLOTS_PER_EPOCH + 1 })
      })
      await assert.reverts(initAccountingOracle({ admin, ...deployed }), 'IncorrectOracleMigration(0)')

      deployed = await deployAccountingOracleSetup(admin, {
        getLegacyOracle: () => deployMockLegacyOracle({ secondsPerSlot: SECONDS_PER_SLOT + 1 })
      })
      await assert.reverts(initAccountingOracle({ admin, ...deployed }), 'IncorrectOracleMigration(0)')

      deployed = await deployAccountingOracleSetup(admin, {
        getLegacyOracle: () => deployMockLegacyOracle({ genesisTime: GENESIS_TIME + 1 })
      })
      await assert.reverts(initAccountingOracle({ admin, ...deployed }), 'IncorrectOracleMigration(0)')
    })

    it('init fails if the frame size is different from the one of the legacy oracle', async () => {
      const deployed = await deployAccountingOracleSetup(admin, {
        getLegacyOracle: () => deployMockLegacyOracle({ epochsPerFrame: EPOCHS_PER_FRAME - 1 })
      })
      await assert.reverts(initAccountingOracle({ admin, ...deployed }), 'IncorrectOracleMigration(1)')
    })

    it(`init fails if the initial epoch of the new oracle is not the next frame's first epoch`, async () => {
      const deployed = await deployAccountingOracleSetup(admin, { initialEpoch: 3 + 10 * EPOCHS_PER_FRAME })

      await deployed.legacyOracle.setLastCompletedEpochId(3 + 11 * EPOCHS_PER_FRAME)
      await assert.reverts(initAccountingOracle({ admin, ...deployed }), 'IncorrectOracleMigration(2)')

      await deployed.legacyOracle.setLastCompletedEpochId(3 + 10 * EPOCHS_PER_FRAME)
      await assert.reverts(initAccountingOracle({ admin, ...deployed }), 'IncorrectOracleMigration(2)')

      await deployed.legacyOracle.setLastCompletedEpochId(3 + 9 * EPOCHS_PER_FRAME + 1)
      await assert.reverts(initAccountingOracle({ admin, ...deployed }), 'IncorrectOracleMigration(2)')
    })

    it('deployment and init finishes successfully otherwise', async () => {
      const deployed = await deployAccountingOracleSetup(admin, { initialEpoch: 3 + 10 * EPOCHS_PER_FRAME })
      await deployed.legacyOracle.setLastCompletedEpochId(3 + 9 * EPOCHS_PER_FRAME)
      await initAccountingOracle({ admin, ...deployed })
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
      assert.equal(+(await oracle.getTime()), time1)

      await consensus.advanceTimeBy(SECONDS_PER_SLOT)

      const time2 = +(await consensus.getTime())
      assert.equal(time2, time1 + SECONDS_PER_SLOT)
      assert.equal(+(await oracle.getTime()), time2)

      const handleOracleReportCallData = await mockLido.getLastCall_handleOracleReport()
      assert.equal(+handleOracleReportCallData.callCount, 0)

      const updateExitedKeysByModuleCallData = await mockStakingRouter.lastCall_updateExitedKeysByModule()
      assert.equal(+updateExitedKeysByModuleCallData.callCount, 0)

      assert.equal(+(await mockStakingRouter.totalCalls_reportExitedKeysByNodeOperator()), 0)
      assert.equal(+(await mockStakingRouter.totalCalls_reportStuckKeysByNodeOperator()), 0)

      const updateBunkerModeLastCall = await mockWithdrawalQueue.lastCall__updateBunkerMode()
      assert.equal(+updateBunkerModeLastCall.callCount, 0)
    })

    it('the initial reference slot is greater than the last one of the legacy oracle', async () => {
      const legacyRefSlot = +(await legacyOracle.getLastCompletedEpochId()) * SLOTS_PER_EPOCH
      assert.isAbove(+(await consensus.getCurrentFrame()).refSlot, legacyRefSlot)
    })

    it('initial configuration is correct', async () => {
      assert.equal(await oracle.getConsensusContract(), consensus.address)
      assert.equal(+(await oracle.getConsensusVersion()), CONSENSUS_VERSION)
      assert.equal(await oracle.LIDO(), mockLido.address)
      assert.equal(+(await oracle.SECONDS_PER_SLOT()), SECONDS_PER_SLOT)
    })

    it('reverts if lido locator address is zero', async () => {
      await assert.reverts(
        deployAccountingOracleSetup(admin, { lidoLocatorAddr: ZERO_ADDRESS }),
        'LidoLocatorCannotBeZero()'
      )
    })

    it('reverts if legacy oracle address is zero', async () => {
      await assert.reverts(
        deployAccountingOracleSetup(admin, { legacyOracleAddr: ZERO_ADDRESS }),
        'LegacyOracleCannotBeZero()'
      )
    })

    it('initialize reverts if admin address is zero', async () => {
      const { consensus } = await deployAccountingOracleSetup(admin)
      await assert.reverts(
        oracle.initialize(ZERO_ADDRESS, consensus.address, CONSENSUS_VERSION, { from: admin }),
        'AdminCannotBeZero()'
      )
    })

    it('initializeWithoutMigration reverts if admin address is zero', async () => {
      const { consensus } = await deployAccountingOracleSetup(admin)
      const { refSlot } = await consensus.getCurrentFrame()
      await assert.reverts(
        oracle.initializeWithoutMigration(ZERO_ADDRESS, consensus.address, CONSENSUS_VERSION, refSlot, { from: admin }),
        'AdminCannotBeZero()'
      )
    })
  })
})
