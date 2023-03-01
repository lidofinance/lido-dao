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
      '(uint256,uint256,uint256,uint256,uint256[],uint256[],uint256,uint256,uint256,uint256,bool,uint256,bytes32,uint256)',
    ],
    [reportItems]
  )
  return web3.utils.keccak256(data)
}
function getAccountingReportDataItems(r) {
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
    r.extraDataItemsCount,
  ]
}

module.exports = {
  calcAccountingReportDataHash,
  getAccountingReportDataItems,
  getValidatorsExitBusReportDataItems,
  calcValidatorsExitBusReportDataHash,
}
