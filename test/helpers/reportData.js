const { web3 } = require('hardhat')

function calcValidatorsExitBusReportDataHash(reportItems) {
  const data = web3.eth.abi.encodeParameters(['(uint256,uint256,uint256,uint256,bytes)'], [reportItems])
  return web3.utils.keccak256(data)
}

function getValidatorsExitBusReportDataItems(r) {
  return [r.consensusVersion, r.refSlot, r.requestsCount, r.dataFormat, r.data]
}

function calcAccountingReportDataHash(reportItems) {
  const data = web3.eth.abi.encodeParameters(
    [
      '(uint256,uint256,uint256,uint256,uint256[],uint256[],uint256,uint256,uint256,uint256[],uint256,bool,uint256,bytes32,uint256)',
    ],
    [reportItems]
  )
  return web3.utils.keccak256(data)
}
function getAccountingReportDataItems(r) {
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
    String(r.extraDataHash),
    String(r.extraDataItemsCount),
  ]
}

module.exports = {
  calcAccountingReportDataHash,
  getAccountingReportDataItems,
  getValidatorsExitBusReportDataItems,
  calcValidatorsExitBusReportDataHash,
}
