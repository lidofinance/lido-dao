const { web3 } = require('hardhat')

const { CONSENSUS_VERSION, ZERO_BYTES32 } = require('./constants')
const { assert } = require('./assert')
const { toBN } = require('./utils')

function getReportDataItems(r) {
  return [
    String(r.consensusVersion),
    String(r.refSlot),
    String(r.numValidators),
    String(r.clBalanceGwei),
    r.stakingModuleIdsWithNewlyExitedValidators.map(String),
    r.numExitedValidatorsByStakingModule.map(String),
    String(r.withdrawalVaultBalance),
    String(r.elRewardsVaultBalance),
    String(r.sharesRequestedToBurn),
    r.withdrawalFinalizationBatches.map(String),
    String(r.simulatedShareRate),
    r.isBunkerMode,
    String(r.extraDataFormat),
    r.extraDataHash,
    String(r.extraDataItemsCount),
  ]
}

function calcReportDataHash(reportItems) {
  const data = web3.eth.abi.encodeParameters(
    [
      '(uint256,uint256,uint256,uint256,uint256[],uint256[],uint256,uint256,uint256,uint256[],uint256,bool,uint256,bytes32,uint256)',
    ],
    [reportItems]
  )
  return web3.utils.keccak256(data)
}

const DEFAULT_REPORT_FIELDS = {
  consensusVersion: 1,
  refSlot: 0,
  numValidators: 0,
  clBalanceGwei: 0,
  stakingModuleIdsWithNewlyExitedValidators: [],
  numExitedValidatorsByStakingModule: [],
  withdrawalVaultBalance: 0,
  elRewardsVaultBalance: 0,
  sharesRequestedToBurn: 0,
  withdrawalFinalizationBatches: [],
  simulatedShareRate: 0,
  isBunkerMode: false,
  extraDataFormat: 0,
  extraDataHash: ZERO_BYTES32,
  extraDataItemsCount: 0,
}

const E9 = toBN(10).pow(toBN(9))

async function prepareOracleReport({ clBalance, ...restFields }) {
  const fields = {
    ...DEFAULT_REPORT_FIELDS,
    ...restFields,
    clBalanceGwei: toBN(clBalance).div(E9),
  }

  const items = getReportDataItems(fields)
  const hash = calcReportDataHash(items)

  return { fields, items, hash }
}

async function triggerConsensusOnHash(hash, consensus) {
  const members = await consensus.getMembers()
  const { refSlot } = await consensus.getCurrentFrame()
  await consensus.submitReport(refSlot, hash, CONSENSUS_VERSION, { from: members.addresses[0] })
  await consensus.submitReport(refSlot, hash, CONSENSUS_VERSION, { from: members.addresses[1] })
  assert.equal((await consensus.getConsensusState()).consensusReport, hash)
}

async function reportOracle(consensus, oracle, reportFields) {
  const { refSlot } = await consensus.getCurrentFrame()
  const report = await prepareOracleReport({ ...reportFields, refSlot })

  // non-empty extra data is not supported here yet
  assert.equals(report.fields.extraDataFormat, 0)
  assert.equals(report.fields.extraDataHash, ZERO_BYTES32)
  assert.equals(report.fields.extraDataItemsCount, 0)

  const members = await consensus.getMembers()
  await triggerConsensusOnHash(report.hash, consensus)

  const oracleVersion = await oracle.getContractVersion()
  const submitDataTx = await oracle.submitReportData(report.items, oracleVersion, { from: members.addresses[0] })
  const submitExtraDataTx = await oracle.submitReportExtraDataEmpty({ from: members.addresses[0] })

  return { report, submitDataTx, submitExtraDataTx }
}

// FIXME: kept for compat, remove after refactoring tests
function pushOracleReport(consensus, oracle, numValidators, clBalance, elRewardsVaultBalance) {
  return reportOracle(consensus, oracle, { numValidators, clBalance, elRewardsVaultBalance })
}

async function getSecondsPerFrame(consensus) {
  const [chainConfig, frameConfig] = await Promise.all([consensus.getChainConfig(), consensus.getFrameConfig()])
  return +chainConfig.secondsPerSlot * +chainConfig.slotsPerEpoch * +frameConfig.epochsPerFrame
}

async function getSlotTimestamp(slot, consensus) {
  const chainConfig = await consensus.getChainConfig()
  return +chainConfig.genesisTime + +chainConfig.secondsPerSlot * slot
}

module.exports = {
  DEFAULT_REPORT_FIELDS,
  getReportDataItems,
  calcReportDataHash,
  prepareOracleReport,
  triggerConsensusOnHash,
  reportOracle,
  pushOracleReport,
  getSecondsPerFrame,
  getSlotTimestamp,
}
