const { BN } = require('bn.js')
const { assert } = require('chai')
const { assertBn, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { assertRevert } = require('../../helpers/assertThrow')
const { processNamedTuple } = require('../../helpers/utils')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')
const { updateLocatorImplementation, deployLocatorWithDummyAddressesImplementation } =
  require('../../helpers/locator-deploy')

const {
  SLOTS_PER_EPOCH, SECONDS_PER_SLOT, GENESIS_TIME, SECONDS_PER_EPOCH,
  EPOCHS_PER_FRAME, SLOTS_PER_FRAME, SECONDS_PER_FRAME,
  computeSlotAt, computeEpochAt, computeEpochFirstSlotAt,
  computeEpochFirstSlot, computeTimestampAtSlot, computeTimestampAtEpoch,
  ZERO_HASH, HASH_1, HASH_2, HASH_3, HASH_4, HASH_5, CONSENSUS_VERSION,
  deployHashConsensus } = require('./hash-consensus-deploy.test')

const AccountingOracle = artifacts.require('AccountingOracleTimeTravellable')
const LidoLocator = artifacts.require('LidoLocator')
const MockLido = artifacts.require('MockLidoForAccountingOracle')
const MockStakingRouter = artifacts.require('MockStakingRouterForAccountingOracle')
const MockWithdrawalQueue = artifacts.require('MockWithdrawalQueueForAccountingOracle')
const MockLegacyOracle = artifacts.require('MockLegacyOracle')

const V1_ORACLE_LAST_COMPLETED_EPOCH = 2 * EPOCHS_PER_FRAME
const V1_ORACLE_LAST_REPORT_SLOT = V1_ORACLE_LAST_COMPLETED_EPOCH * SLOTS_PER_EPOCH

const MAX_EXITED_VALS_PER_HOUR = 10
const MAX_EXITED_VALS_PER_DAY = 24 * MAX_EXITED_VALS_PER_HOUR
const MAX_EXTRA_DATA_LIST_LEN = 15

const EXTRA_DATA_FORMAT_LIST = 0

const EXTRA_DATA_TYPE_STUCK_VALIDATORS = 0
const EXTRA_DATA_TYPE_EXITED_VALIDATORS = 1


function getReportDataItems(r) {
  return [
    r.consensusVersion, +r.refSlot, r.numValidators, r.clBalanceGwei, r.stakingModuleIdsWithNewlyExitedValidators,
    r.numExitedValidatorsByStakingModule, r.withdrawalVaultBalance, r.elRewardsVaultBalance,
    r.lastWithdrawalRequestIdToFinalize, r.finalizationShareRate, r.isBunkerMode, r.extraDataFormat,
    r.extraDataHash, r.extraDataItemsCount, r.extraDataMaxNodeOpsCountByModule,
  ]
}

function calcReportDataHash(reportItems) {
  const data = web3.eth.abi.encodeParameters(
    ['(uint256,uint256,uint256,uint256,uint256[],uint256[],uint256,uint256,uint256,uint256,bool,uint256,bytes32,uint256,uint256)'],
    [reportItems]
  )
  // const toS = x => Array.isArray(x) ? `[${x.map(toS)}]` : `${x}`
  // console.log(toS(reportItems))
  // console.log(data)
  return web3.utils.keccak256(data)
}

function encodeExtraDataItem(itemIndex, itemType, moduleId, nodeOperatorId, keysCount) {
  return '0x' + new BN(keysCount)
    .add(new BN(nodeOperatorId).shln(8 * 16))
    .add(new BN(moduleId).shln(8 * (16 + 8)))
    .add(new BN(itemType).shln(8 * (16 + 8 + 3)))
    .add(new BN(itemIndex).shln(8 * (16 + 8 + 3 + 2)))
    .toString(16, 64)
}

function encodeExtraDataItems({ stuckKeys, exitedKeys }) {
  const data = []
  let itemType = EXTRA_DATA_TYPE_STUCK_VALIDATORS

  for (let i = 0; i < stuckKeys.length; ++i) {
    const item = stuckKeys[i]
    data.push(encodeExtraDataItem(data.length, itemType, item.moduleId, item.nodeOpId, item.keysCount))
  }

  itemType = EXTRA_DATA_TYPE_EXITED_VALIDATORS

  for (let i = 0; i < exitedKeys.length; ++i) {
    const item = exitedKeys[i]
    data.push(encodeExtraDataItem(data.length, itemType, item.moduleId, item.nodeOpId, item.keysCount))
  }

  return data
}

function calcExtraDataHash(extraDataItems) {
  const data = '0x' + extraDataItems.map(s => s.substr(2)).join('')
  return web3.utils.keccak256(data)
}


module.exports = {
  SLOTS_PER_EPOCH, SECONDS_PER_SLOT, GENESIS_TIME, SECONDS_PER_EPOCH,
  EPOCHS_PER_FRAME, SLOTS_PER_FRAME, SECONDS_PER_FRAME,
  ZERO_HASH, HASH_1, HASH_2, HASH_3, HASH_4, HASH_5,
  computeSlotAt, computeEpochAt, computeEpochFirstSlotAt,
  computeEpochFirstSlot, computeTimestampAtSlot, computeTimestampAtEpoch,
  ZERO_HASH, CONSENSUS_VERSION,
  V1_ORACLE_LAST_COMPLETED_EPOCH, V1_ORACLE_LAST_REPORT_SLOT,
  MAX_EXITED_VALS_PER_HOUR, MAX_EXITED_VALS_PER_DAY, MAX_EXTRA_DATA_LIST_LEN,
  EXTRA_DATA_FORMAT_LIST, EXTRA_DATA_TYPE_STUCK_VALIDATORS, EXTRA_DATA_TYPE_EXITED_VALIDATORS,
  deployAndConfigureAccountingOracle, deployAccountingOracleSetup, initAccountingOracle,
  deployMockLegacyOracle, deployMockLidoAndStakingRouter,
  getReportDataItems, calcReportDataHash, encodeExtraDataItem, encodeExtraDataItems,
  calcExtraDataHash,
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
  return {lido, stakingRouter, withdrawalQueue}
}

async function deployAccountingOracleSetup(admin, {
  initialEpoch = null,
  epochsPerFrame = EPOCHS_PER_FRAME,
  slotsPerEpoch = SLOTS_PER_EPOCH,
  secondsPerSlot = SECONDS_PER_SLOT,
  genesisTime = GENESIS_TIME,
  getLidoAndStakingRouter = deployMockLidoAndStakingRouter,
  getLegacyOracle = deployMockLegacyOracle,
} = {}) {
  const {lido, stakingRouter, withdrawalQueue} = await getLidoAndStakingRouter()

  const locatorAddr = (await deployLocatorWithDummyAddressesImplementation(admin)).address

  await updateLocatorImplementation(locatorAddr, admin, {
    lido: lido.address,
    stakingRouter: stakingRouter.address,
    withdrawalQueue: withdrawalQueue.address
  })

  const legacyOracle = await getLegacyOracle()

  if (initialEpoch == null) {
    initialEpoch = +await legacyOracle.getLastCompletedEpochId() + epochsPerFrame
  }

  const oracle = await AccountingOracle.new(locatorAddr, lido.address, legacyOracle.address,
    secondsPerSlot, genesisTime, {from: admin})

  const {consensus} = await deployHashConsensus(admin, {
    reportProcessor: oracle,
    epochsPerFrame,
    slotsPerEpoch,
    secondsPerSlot,
    genesisTime,
    initialEpoch
  })

  // pretend we're at the first slot of the initial frame's epoch
  await consensus.setTime(genesisTime + initialEpoch * slotsPerEpoch * secondsPerSlot)

  return {lido, stakingRouter, withdrawalQueue, locatorAddr, legacyOracle, oracle, consensus}
}

async function initAccountingOracle({
  admin,
  oracle,
  consensus,
  dataSubmitter = null,
  consensusVersion = CONSENSUS_VERSION,
  maxExitedValidatorsPerDay = MAX_EXITED_VALS_PER_DAY,
  maxExtraDataListItemsCount = MAX_EXTRA_DATA_LIST_LEN,
}) {
  const initTx = await oracle.initialize(
    admin,
    consensus.address,
    consensusVersion,
    maxExitedValidatorsPerDay,
    maxExtraDataListItemsCount,
    {from: admin}
  )

  await oracle.grantRole(await oracle.MANAGE_CONSENSUS_CONTRACT_ROLE(), admin, {from: admin})
  await oracle.grantRole(await oracle.MANAGE_CONSENSUS_VERSION_ROLE(), admin, {from: admin})
  await oracle.grantRole(await oracle.MANAGE_DATA_BOUNDARIES_ROLE(), admin, {from: admin})

  if (dataSubmitter != null) {
    await oracle.grantRole(await oracle.SUBMIT_DATA_ROLE(), dataSubmitter, {from: admin})
  }

  assert.equal(+await oracle.EXTRA_DATA_FORMAT_LIST(), EXTRA_DATA_FORMAT_LIST)
  assert.equal(+await oracle.EXTRA_DATA_TYPE_STUCK_VALIDATORS(), EXTRA_DATA_TYPE_STUCK_VALIDATORS)
  assert.equal(+await oracle.EXTRA_DATA_TYPE_EXITED_VALIDATORS(), EXTRA_DATA_TYPE_EXITED_VALIDATORS)

  return initTx
}

async function deployAndConfigureAccountingOracle(admin) {
  const deployed = await deployAccountingOracleSetup(admin)
  const initTx = await initAccountingOracle({admin, ...deployed})
  return {...deployed, initTx}
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
        getLegacyOracle: () => deployMockLegacyOracle({slotsPerEpoch: SLOTS_PER_EPOCH + 1})
      })
      await assertRevert(initAccountingOracle({admin, ...deployed}), 'IncorrectOracleMigration(0)')

      deployed = await deployAccountingOracleSetup(admin, {
        getLegacyOracle: () => deployMockLegacyOracle({secondsPerSlot: SECONDS_PER_SLOT + 1})
      })
      await assertRevert(initAccountingOracle({admin, ...deployed}), 'IncorrectOracleMigration(0)')

      deployed = await deployAccountingOracleSetup(admin, {
        getLegacyOracle: () => deployMockLegacyOracle({genesisTime: GENESIS_TIME + 1})
      })
      await assertRevert(initAccountingOracle({admin, ...deployed}), 'IncorrectOracleMigration(0)')
    })

    it('init fails if the frame size is different from the one of the legacy oracle', async () => {
      const deployed = await deployAccountingOracleSetup(admin, {
        getLegacyOracle: () => deployMockLegacyOracle({epochsPerFrame: EPOCHS_PER_FRAME - 1})
      })
      await assertRevert(initAccountingOracle({admin, ...deployed}), 'IncorrectOracleMigration(1)')
    })

    it(`init fails if the initial epoch of the new oracle is not the next frame's first epoch`,
      async () =>
    {
      const deployed = await deployAccountingOracleSetup(admin, {initialEpoch: 3 + 10 * EPOCHS_PER_FRAME})

      await deployed.legacyOracle.setLastCompletedEpochId(3 + 11 * EPOCHS_PER_FRAME)
      await assertRevert(initAccountingOracle({admin, ...deployed}), 'IncorrectOracleMigration(2)')

      await deployed.legacyOracle.setLastCompletedEpochId(3 + 10 * EPOCHS_PER_FRAME)
      await assertRevert(initAccountingOracle({admin, ...deployed}), 'IncorrectOracleMigration(2)')

      await deployed.legacyOracle.setLastCompletedEpochId(3 + 9 * EPOCHS_PER_FRAME + 1)
      await assertRevert(initAccountingOracle({admin, ...deployed}), 'IncorrectOracleMigration(2)')
    })

    it('deployment and init finishes successfully otherwise', async () => {
      const deployed = await deployAccountingOracleSetup(admin, {initialEpoch: 3 + 10 * EPOCHS_PER_FRAME})
      await deployed.legacyOracle.setLastCompletedEpochId(3 + 9 * EPOCHS_PER_FRAME)
      await initAccountingOracle({admin, ...deployed})
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
      const time1 = +await consensus.getTime()
      assert.equal(+await oracle.getTime(), time1)

      await consensus.advanceTimeBy(SECONDS_PER_SLOT)

      const time2 = +await consensus.getTime()
      assert.equal(time2, time1 + SECONDS_PER_SLOT)
      assert.equal(+await oracle.getTime(), time2)

      const handleOracleReportCallData = await mockLido.getLastCall_handleOracleReport()
      assert.equal(+handleOracleReportCallData.callCount, 0)

      const updateExitedKeysByModuleCallData =
        await mockStakingRouter.getLastCall_updateExitedKeysByModule()
      assert.equal(+updateExitedKeysByModuleCallData.callCount, 0)

      assert.equal(+await mockStakingRouter.getTotalCalls_reportExitedKeysByNodeOperator(), 0)
      assert.equal(+await mockStakingRouter.getTotalCalls_reportStuckKeysByNodeOperator(), 0)

      const updateBunkerModeLastCall = await mockWithdrawalQueue.lastCall__updateBunkerMode()
      assert.equal(+updateBunkerModeLastCall.callCount, 0)
    })

    it('the initial reference slot is greater than the last one of the legacy oracle', async () => {
      const legacyRefSlot = +await legacyOracle.getLastCompletedEpochId() * SLOTS_PER_EPOCH
      assert.isAbove(+(await consensus.getCurrentFrame()).refSlot, legacyRefSlot)
    })

    it('initial configuration is correct', async () => {
      assert.equal(await oracle.getConsensusContract(), consensus.address)
      assert.equal(+await oracle.getConsensusVersion(), CONSENSUS_VERSION)
      assert.equal(await oracle.LIDO(), mockLido.address)
      assert.equal(+await oracle.SECONDS_PER_SLOT(), SECONDS_PER_SLOT)

      const dataBoundaries = await oracle.getDataBoundaries()
      assert.equal(+dataBoundaries.maxExitedValidatorsPerDay, MAX_EXITED_VALS_PER_DAY)
      assert.equal(+dataBoundaries.maxExtraDataListItemsCount, MAX_EXTRA_DATA_LIST_LEN)
    })
  })
})
