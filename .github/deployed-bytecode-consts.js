const APPS_TO_NAMES = new Map([
  ['lido', 'Lido'],
  ['node-operators-registry', 'NodeOperatorsRegistry'],
])

const CONTRACTS_TO_NAMES = new Map([
  ['wstethContract', 'WstETH'],
  ['executionLayerRewardsVault', 'LidoExecutionLayerRewardsVault'],
  ['compositePostRebaseBeaconReceiver', 'CompositePostRebaseBeaconReceiver'],
  ['burner', 'Burner'],
  ['depositor', 'DepositSecurityModule']
])

const IGNORE_METADATA_CONTRACTS = ['WstETH']

module.exports = {
  APPS_TO_NAMES,
  CONTRACTS_TO_NAMES,
  IGNORE_METADATA_CONTRACTS
}
