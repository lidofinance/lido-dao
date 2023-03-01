const { web3 } = require('hardhat')

function calcReportDataHash(reportItems) {
  const data = web3.eth.abi.encodeParameters(
    [
      '(uint256,uint256,uint256,uint256,uint256[],uint256[],uint256,uint256,uint256,uint256,bool,uint256,bytes32,uint256)',
    ],
    [reportItems]
  )
  return web3.utils.keccak256(data)
}
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
    r.extraDataItemsCount,
  ]
}

module.exports = {
  calcReportDataHash,
  getReportDataItems,
}
