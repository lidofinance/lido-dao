const APPS_TO_NAMES = new Map([
  ['lido', 'Lido'],
  ['node-operators-registry', 'NodeOperatorsRegistry'],
  ['oracle', 'LidoOracle']
])

const CONTRACTS_TO_NAMES = new Map([
  //['wstethContract', 'WstETH'], // excluded due to https://github.com/lidofinance/lido-dao/commit/98c4821638ceab0ce84dbd3b7fdc7c1f83f07622
  ['executionLayerRewardsVault', 'LidoExecutionLayerRewardsVault'],
  ['compositePostRebaseBeaconReceiver', 'CompositePostRebaseBeaconReceiver'],
  ['selfOwnedStETHBurner', 'SelfOwnedStETHBurner'],
  ['depositor', 'DepositSecurityModule'],
])

module.exports = {
  APPS_TO_NAMES,
  CONTRACTS_TO_NAMES
}
