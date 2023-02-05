const { BN } = require('bn.js')
const { assert } = require('chai')
const { assertBn, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { assertRevert } = require('../../helpers/assertThrow')
const { assertBnClose, e18, hex, strip0x } = require('../../helpers/utils')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const {
  SLOTS_PER_EPOCH, SECONDS_PER_SLOT, GENESIS_TIME, SECONDS_PER_EPOCH,
  computeSlotAt, computeEpochAt, computeEpochFirstSlotAt,
  computeEpochFirstSlot, computeTimestampAtSlot, computeTimestampAtEpoch,
  ZERO_HASH, HASH_1, HASH_2, HASH_3, HASH_4, HASH_5, CONSENSUS_VERSION,
  deployHashConsensus } = require('./hash-consensus-deploy.test')

const ValidatorsExitBusOracle = artifacts.require('ValidatorsExitBusTimeTravellable')

const DATA_FORMAT_LIST = 0


function getReportDataItems(r) {
  return [r.consensusVersion, r.refSlot, r.requestsCount, r.dataFormat, r.data]
}

function calcReportDataHash(reportItems) {
  const data = web3.eth.abi.encodeParameters(
    ['(uint256,uint256,uint256,uint256,bytes)'],
    [reportItems]
  )
  // const toS = x => Array.isArray(x) ? `[${x.map(toS)}]` : `${x}`
  // console.log(toS(reportItems))
  // console.log(data)
  return web3.utils.keccak256(data)
}

function encodeExitRequestHex({ moduleId, nodeOpId, valIndex, valPubkey }) {
  const pubkeyHex = strip0x(valPubkey)
  assert.equal(pubkeyHex.length, 48 * 2)
  return hex(moduleId, 3) + hex(nodeOpId, 5) + hex(valIndex, 8) + pubkeyHex
}

function encodeExitRequestsDataList(requests) {
  return '0x' + requests.map(encodeExitRequestHex).join('')
}

const EPOCHS_PER_FRAME = 37
const SLOTS_PER_FRAME = EPOCHS_PER_FRAME * SLOTS_PER_EPOCH
const SECONDS_PER_FRAME = EPOCHS_PER_FRAME * SECONDS_PER_EPOCH

const MAX_REQUESTS_PER_REPORT = 6
const MAX_REQUESTS_LIST_LENGTH = 5
const MAX_REQUESTS_PER_DAY = 5
const RATE_LIMIT_WINDOW_SLOTS = Math.floor(60 * 60 * 24 / SECONDS_PER_SLOT)
const RATE_LIMIT_THROUGHPUT = 20


module.exports = {
  SLOTS_PER_EPOCH, SECONDS_PER_SLOT, GENESIS_TIME, SECONDS_PER_EPOCH,
  EPOCHS_PER_FRAME, SLOTS_PER_FRAME, SECONDS_PER_FRAME,
  MAX_REQUESTS_PER_REPORT, MAX_REQUESTS_LIST_LENGTH,
  MAX_REQUESTS_PER_DAY, RATE_LIMIT_WINDOW_SLOTS, RATE_LIMIT_THROUGHPUT,
  computeSlotAt, computeEpochAt, computeEpochFirstSlotAt,
  computeEpochFirstSlot, computeTimestampAtSlot, computeTimestampAtEpoch,
  ZERO_HASH, CONSENSUS_VERSION, DATA_FORMAT_LIST,
  getReportDataItems, calcReportDataHash, encodeExitRequestHex,
  encodeExitRequestsDataList, deployExitBusOracle,
}


async function deployExitBusOracle(admin, {dataSubmitter = null} = {}) {
  const oracle = await ValidatorsExitBusOracle.new(SECONDS_PER_SLOT, GENESIS_TIME, {from: admin})

  const {consensus} = await deployHashConsensus(admin, {
    epochsPerFrame: EPOCHS_PER_FRAME,
    reportProcessor: oracle,
  })

  const lastProcessedRefSlot = 0

  const tx = await oracle.initialize(
    admin,
    consensus.address,
    CONSENSUS_VERSION,
    lastProcessedRefSlot,
    MAX_REQUESTS_PER_REPORT,
    MAX_REQUESTS_LIST_LENGTH,
    RATE_LIMIT_WINDOW_SLOTS,
    e18(RATE_LIMIT_THROUGHPUT),
    {from: admin}
  )

  assertEvent(tx, 'ContractVersionSet', {expectedArgs: {version: 1}})

  assertEvent(tx, 'RoleGranted', {expectedArgs: {
    role: await consensus.DEFAULT_ADMIN_ROLE(),
    account: admin,
    sender: admin
  }})

  assertEvent(tx, 'ConsensusContractSet', {expectedArgs: {
    addr: consensus.address,
    prevAddr: ZERO_ADDRESS
  }})

  assertEvent(tx, 'ConsensusVersionSet', {expectedArgs: {version: CONSENSUS_VERSION, prevVersion: 0}})

  assertEvent(tx, 'DataBoundariesSet', {expectedArgs: {
    refSlot: +(await consensus.getCurrentFrame()).refSlot,
    maxExitRequestsPerReport: MAX_REQUESTS_PER_REPORT,
    maxExitRequestsListLength: MAX_REQUESTS_LIST_LENGTH,
    exitRequestsRateLimitWindowSizeSlots: RATE_LIMIT_WINDOW_SLOTS,
    exitRequestsRateLimitMaxThroughputE18: e18(RATE_LIMIT_THROUGHPUT),
  }})

  await oracle.grantRole(await oracle.MANAGE_CONSENSUS_CONTRACT_ROLE(), admin, {from: admin})
  await oracle.grantRole(await oracle.MANAGE_CONSENSUS_VERSION_ROLE(), admin, {from: admin})
  await oracle.grantRole(await oracle.MANAGE_DATA_BOUNDARIES_ROLE(), admin, {from: admin})

  if (dataSubmitter != null) {
    await oracle.grantRole(await oracle.SUBMIT_DATA_ROLE(), dataSubmitter, {from: admin})
  }

  assert.equal(+await oracle.DATA_FORMAT_LIST(), DATA_FORMAT_LIST)

  return {consensus, oracle}
}


contract('ValidatorsExitBusOracle', ([admin, member1]) => {
  let consensus
  let oracle

  context('Deployment and initial configuration', () => {

    it('deployment finishes successfully', async () => {
      const deployed = await deployExitBusOracle(admin)
      consensus = deployed.consensus
      oracle = deployed.oracle
    })

    it('mock time-travellable setup is correct', async () => {
      const time1 = +await consensus.getTime()
      assert.equal(+await oracle.getTime(), time1)

      await consensus.advanceTimeBy(SECONDS_PER_SLOT)

      const time2 = +await consensus.getTime()
      assert.equal(time2, time1 + SECONDS_PER_SLOT)
      assert.equal(+await oracle.getTime(), time2)
    })

    it('initial configuration is correct', async () => {
      assert.equal(await oracle.getConsensusContract(), consensus.address)
      assert.equal(+await oracle.getConsensusVersion(), CONSENSUS_VERSION)
      assert.equal(+await oracle.SECONDS_PER_SLOT(), SECONDS_PER_SLOT)

      const dataBoundaries = await oracle.getDataBoundaries()
      assertBn(dataBoundaries.maxExitRequestsPerReport, MAX_REQUESTS_PER_REPORT)
      assertBn(dataBoundaries.maxExitRequestsListLength, MAX_REQUESTS_LIST_LENGTH)
      assertBn(dataBoundaries.exitRequestsRateLimitWindowSizeSlots, RATE_LIMIT_WINDOW_SLOTS)
      assertBnClose(dataBoundaries.exitRequestsRateLimitMaxThroughputE18, e18(RATE_LIMIT_THROUGHPUT), 100000)
    })
  })
})
