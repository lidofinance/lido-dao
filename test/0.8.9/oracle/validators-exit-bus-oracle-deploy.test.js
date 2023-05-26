const { contract, artifacts } = require('hardhat')
const { assert } = require('../../helpers/assert')
const { hex, strip0x } = require('../../helpers/utils')
const { ZERO_ADDRESS } = require('../../helpers/constants')
const {
  updateLocatorImplementation,
  deployLocatorWithDummyAddressesImplementation,
} = require('../../helpers/locator-deploy')

const {
  SLOTS_PER_EPOCH,
  SECONDS_PER_SLOT,
  GENESIS_TIME,
  SECONDS_PER_EPOCH,
  computeSlotAt,
  computeEpochAt,
  computeEpochFirstSlotAt,
  computeEpochFirstSlot,
  computeTimestampAtSlot,
  computeTimestampAtEpoch,
  ZERO_HASH,
  CONSENSUS_VERSION,
  deployHashConsensus,
} = require('./hash-consensus-deploy.test')

const { calcValidatorsExitBusReportDataHash, getValidatorsExitBusReportDataItems } = require('../../helpers/reportData')

const ValidatorsExitBusOracle = artifacts.require('ValidatorsExitBusTimeTravellable')

const DATA_FORMAT_LIST = 1

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
module.exports = {
  SLOTS_PER_EPOCH,
  SECONDS_PER_SLOT,
  GENESIS_TIME,
  SECONDS_PER_EPOCH,
  EPOCHS_PER_FRAME,
  SLOTS_PER_FRAME,
  SECONDS_PER_FRAME,
  MAX_REQUESTS_PER_REPORT,
  MAX_REQUESTS_LIST_LENGTH,
  MAX_REQUESTS_PER_DAY,
  computeSlotAt,
  computeEpochAt,
  computeEpochFirstSlotAt,
  computeEpochFirstSlot,
  computeTimestampAtSlot,
  computeTimestampAtEpoch,
  ZERO_HASH,
  CONSENSUS_VERSION,
  DATA_FORMAT_LIST,
  getValidatorsExitBusReportDataItems,
  calcValidatorsExitBusReportDataHash,
  encodeExitRequestHex,
  encodeExitRequestsDataList,
  deployExitBusOracle,
  deployOracleReportSanityCheckerForExitBus,
}
async function deployOracleReportSanityCheckerForExitBus(lidoLocator, admin) {
  const maxValidatorExitRequestsPerReport = 2000
  const limitsList = [0, 0, 0, 0, maxValidatorExitRequestsPerReport, 0, 0, 0, 0]
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

async function deployExitBusOracle(
  admin,
  { dataSubmitter = null, lastProcessingRefSlot = 0, resumeAfterDeploy = false, secondsPerSlot = SECONDS_PER_SLOT } = {}
) {
  const locator = (await deployLocatorWithDummyAddressesImplementation(admin)).address

  const oracle = await ValidatorsExitBusOracle.new(secondsPerSlot, GENESIS_TIME, locator, { from: admin })

  const { consensus } = await deployHashConsensus(admin, {
    epochsPerFrame: EPOCHS_PER_FRAME,
    reportProcessor: oracle,
  })

  const oracleReportSanityChecker = await deployOracleReportSanityCheckerForExitBus(locator, admin)
  await updateLocatorImplementation(locator, admin, {
    validatorsExitBusOracle: oracle.address,
    oracleReportSanityChecker: oracleReportSanityChecker.address,
  })

  const initTx = await oracle.initialize(admin, consensus.address, CONSENSUS_VERSION, lastProcessingRefSlot, {
    from: admin,
  })

  assert.emits(initTx, 'ContractVersionSet', { version: 1 })

  assert.emits(initTx, 'RoleGranted', {
    role: await consensus.DEFAULT_ADMIN_ROLE(),
    account: admin,
    sender: admin,
  })

  assert.emits(initTx, 'ConsensusHashContractSet', {
    addr: consensus.address,
    prevAddr: ZERO_ADDRESS,
  })

  assert.emits(initTx, 'ConsensusVersionSet', { version: CONSENSUS_VERSION, prevVersion: 0 })

  await oracle.grantRole(await oracle.MANAGE_CONSENSUS_CONTRACT_ROLE(), admin, { from: admin })
  await oracle.grantRole(await oracle.MANAGE_CONSENSUS_VERSION_ROLE(), admin, { from: admin })
  await oracle.grantRole(await oracle.PAUSE_ROLE(), admin, { from: admin })
  await oracle.grantRole(await oracle.RESUME_ROLE(), admin, { from: admin })

  if (dataSubmitter != null) {
    await oracle.grantRole(await oracle.SUBMIT_DATA_ROLE(), dataSubmitter, { from: admin })
  }

  assert.equals(await oracle.DATA_FORMAT_LIST(), DATA_FORMAT_LIST)

  if (resumeAfterDeploy) {
    await oracle.resume({ from: admin })
  }

  return { consensus, oracle, oracleReportSanityChecker, locator, initTx }
}

contract('ValidatorsExitBusOracle', ([admin, member1]) => {
  let consensus
  let oracle

  context('Deployment and initial configuration', () => {
    it('deployment finishes successfully', async () => {
      const deployed = await deployExitBusOracle(admin, { resumeAfterDeploy: false })
      consensus = deployed.consensus
      oracle = deployed.oracle
    })

    it('reverts when slotsPerSecond is zero', async () => {
      await assert.reverts(deployExitBusOracle(admin, { secondsPerSlot: 0 }), 'SecondsPerSlotCannotBeZero()')
    })

    it('mock time-travellable setup is correct', async () => {
      const time1 = +(await consensus.getTime())
      assert.equals(await oracle.getTime(), time1)

      await consensus.advanceTimeBy(SECONDS_PER_SLOT)
      const time2 = +(await consensus.getTime())
      assert.equal(time2, time1 + SECONDS_PER_SLOT)
      assert.equals(await oracle.getTime(), time2)
    })

    it('initial configuration is correct', async () => {
      assert.equal(await oracle.getConsensusContract(), consensus.address)
      assert.equals(await oracle.getConsensusVersion(), CONSENSUS_VERSION)
      assert.equals(await oracle.SECONDS_PER_SLOT(), SECONDS_PER_SLOT)
      assert.equal(await oracle.isPaused(), true)
    })

    it('pause/resume operations work', async () => {
      assert.equal(await oracle.isPaused(), true)
      await oracle.resume()
      assert.equal(await oracle.isPaused(), false)
      await oracle.pauseFor(123)
      assert.equal(await oracle.isPaused(), true)
    })
  })
})
