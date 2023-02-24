const { web3 } = require('hardhat')

const { CONSENSUS_VERSION, ZERO_BYTES32 } = require('./constants')
const { assert } = require('./assert')

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
    r.requestedToBurnShares,
    r.withdrawalFinalizationBatches,
    r.simulatedShareRate,
    r.isBunkerMode,
    r.extraDataFormat,
    r.extraDataHash,
    r.extraDataItemsCount,
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

async function pushOracleReport(consensus, oracle, numValidators, clBalance, elRewards) {
  const { refSlot } = await consensus.getCurrentFrame()
  const reportFields = {
    consensusVersion: 1,
    refSlot,
    numValidators,
    clBalanceGwei: clBalance / 1e9,
    stakingModuleIdsWithNewlyExitedValidators: [],
    numExitedValidatorsByStakingModule: [],
    withdrawalVaultBalance: 0,
    elRewardsVaultBalance: elRewards || 0,
    requestedToBurnShares: 0,
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

module.exports = { getReportDataItems, calcReportDataHash, pushOracleReport }
