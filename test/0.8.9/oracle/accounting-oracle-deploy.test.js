const { BN } = require('bn.js')
const { assert } = require('chai')
const { assertBn, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { assertRevert } = require('../../helpers/assertThrow')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const {
  SLOTS_PER_EPOCH, SECONDS_PER_SLOT, GENESIS_TIME, SECONDS_PER_EPOCH,
  EPOCHS_PER_FRAME, SECONDS_PER_FRAME,
  computeSlotAt, computeEpochAt, computeEpochFirstSlotAt,
  computeEpochFirstSlot, computeTimestampAtSlot, computeTimestampAtEpoch,
  ZERO_HASH, HASH_1, HASH_2, HASH_3, HASH_4, HASH_5, CONSENSUS_VERSION,
  deployHashConsensus } = require('./hash-consensus-deploy.test')

const AccountingOracle = artifacts.require('AccountingOracleTimeTravellable')
const MockLido = artifacts.require('MockLidoForAccountingOracle')
const MockStakingRouter = artifacts.require('MockStakingRouterForAccountingOracle')

const V1_ORACLE_LAST_REPORT_SLOT = 1000

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
    r.extraDataHash, r.extraDataItemsCount,
  ]
}

function calcReportDataHash(reportItems) {
  const data = web3.eth.abi.encodeParameters(
    ['(uint256,uint256,uint256,uint256,uint256[],uint256[],uint256,uint256,uint256,uint256,bool,uint256,bytes32,uint256)'],
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
  V1_ORACLE_LAST_REPORT_SLOT,
  MAX_EXITED_VALS_PER_HOUR, MAX_EXITED_VALS_PER_DAY, MAX_EXTRA_DATA_LIST_LEN,
  EXTRA_DATA_FORMAT_LIST, EXTRA_DATA_TYPE_STUCK_VALIDATORS, EXTRA_DATA_TYPE_EXITED_VALIDATORS,
  deployAccountingOracle, getReportDataItems, calcReportDataHash,
  encodeExtraDataItem, encodeExtraDataItems, calcExtraDataHash,
}


async function deployAccountingOracle(admin, { dataSubmitter = null } = {}) {
  const mockStakingRouter = await MockStakingRouter.new({from: admin})
  const mockLido = await MockLido.new(mockStakingRouter.address, {from: admin})
  const oracle = await AccountingOracle.new(mockLido.address, SECONDS_PER_SLOT, {from: admin})
  const {consensus} = await deployHashConsensus(admin, {reportProcessor: oracle}, {from: admin})

  await consensus.setTime(GENESIS_TIME + 2 * SECONDS_PER_FRAME + SECONDS_PER_EPOCH + SECONDS_PER_SLOT)
  assert.isBelow(V1_ORACLE_LAST_REPORT_SLOT, +(await consensus.getCurrentFrame()).refSlot)

  await oracle.initialize(
    admin,
    consensus.address,
    CONSENSUS_VERSION,
    V1_ORACLE_LAST_REPORT_SLOT,
    MAX_EXITED_VALS_PER_DAY,
    MAX_EXTRA_DATA_LIST_LEN,
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

  return {consensus, oracle, mockLido, mockStakingRouter}
}


contract('AccountingOracle', ([admin, member1]) => {
  let consensus
  let oracle
  let mockLido
  let mockStakingRouter

  context('Deployment and initial configuration', () => {

    it('deployment finishes successfully', async () => {
      const deployed = await deployAccountingOracle(admin)
      consensus = deployed.consensus
      oracle = deployed.oracle
      mockLido = deployed.mockLido
      mockStakingRouter = deployed.mockStakingRouter
    })

    it('mock setup is correct', async () => {
      // check the mock time-travellable setup
      assert.equal(+await oracle.getTime(), +await consensus.getTime())
      await consensus.advanceTimeBy(SECONDS_PER_SLOT)
      assert.equal(+await oracle.getTime(), +await consensus.getTime())

      const handleOracleReportCallData = await mockLido.getLastCall_handleOracleReport()
      assert.equal(+handleOracleReportCallData.callCount, 0)

      const updateExitedKeysByModuleCallData =
        await mockStakingRouter.getLastCall_updateExitedKeysByModule()
      assert.equal(+updateExitedKeysByModuleCallData.callCount, 0)

      const reportExitedKeysByNodeOperatorTotalCalls =
        +await mockStakingRouter.getTotalCalls_reportExitedKeysByNodeOperator()
      assert.equal(reportExitedKeysByNodeOperatorTotalCalls, 0)
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
