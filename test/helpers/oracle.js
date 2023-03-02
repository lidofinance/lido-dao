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

async function triggerConsensusOnHash(hash, consensus) {
  const members = await consensus.getMembers()
  const { refSlot } = await consensus.getCurrentFrame()
  await consensus.submitReport(refSlot, hash, CONSENSUS_VERSION, { from: members.addresses[0] })
  await consensus.submitReport(refSlot, hash, CONSENSUS_VERSION, { from: members.addresses[1] })
  assert.equal((await consensus.getConsensusState()).consensusReport, hash)
}

async function reportOracle(consensus, oracle, {
  numValidators,
  clBalance,
  elRewards = 0
}) {
  const { refSlot } = await consensus.getCurrentFrame()
  const reportFields = {
    consensusVersion: 1,
    refSlot,
    numValidators,
    clBalanceGwei: toBN(clBalance).div(toBN(10).pow(toBN(9))),
    stakingModuleIdsWithNewlyExitedValidators: [],
    numExitedValidatorsByStakingModule: [],
    withdrawalVaultBalance: 0,
    elRewardsVaultBalance: elRewards,
    sharesRequestedToBurn: 0,
    withdrawalFinalizationBatches: [],
    simulatedShareRate: 0,
    isBunkerMode: false,
    extraDataFormat: 0,
    extraDataHash: ZERO_BYTES32,
    extraDataItemsCount: 0,
  }

  const reportItems = getReportDataItems(reportFields)
  const reportHash = calcReportDataHash(reportItems)

  const members = await consensus.getMembers()

  await triggerConsensusOnHash(reportHash, consensus)

  const oracleVersion = await oracle.getContractVersion()

  const submitDataTx = await oracle.submitReportData(reportItems, oracleVersion, { from: members.addresses[0] })
  const submitExtraDataTx = await oracle.submitReportExtraDataEmpty({ from: members.addresses[0] })

  return { submitDataTx, submitExtraDataTx }
}

function pushOracleReport(consensus, oracle, numValidators, clBalance, elRewards) {
  return reportOracle(consensus, oracle, { numValidators, clBalance, elRewards })
}

// const computeSlotAt = (time, c) => Math.floor((time - (+c.genesisTime)) / (+c.secondsPerSlot))
// const computeEpochAt = (time, c) => Math.floor(computeSlotAt(time, c) / (+c.slotsPerEpoch))
// const computeEpochFirstSlot = (epoch, c) => epoch * (+c.slotsPerEpoch)
// const computeEpochFirstSlotAt = (time, c) => computeEpochFirstSlot(computeEpochAt(time, c), c)
// const computeTimestampAtEpoch = (epoch, c) => +c.genesisTime + epoch * ((+c.secondsPerSlot) * (+c.slotsPerEpoch))
// const computeTimestampAtSlot = (slot, c) => +c.genesisTime + slot * +c.secondsPerSlot

async function getSecondsPerFrame(consensus) {
  const [chainConfig, frameConfig] = await Promise.all([
    consensus.getChainConfig(),
    consensus.getFrameConfig()
  ])
  return (+chainConfig.secondsPerSlot) * (+chainConfig.slotsPerEpoch) * (+frameConfig.epochsPerFrame)
}

module.exports = { getReportDataItems, calcReportDataHash, reportOracle, pushOracleReport, getSecondsPerFrame }
