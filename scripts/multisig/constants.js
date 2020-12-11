// See contracts/template/LidoTenplate.sol
const APP_NAMES = {
  // Lido apps
  LIDO: 'lido',
  ORACLE: 'oracle',
  NODE_OPERATORS_REGISTRY: 'node-operators-registry',
  // Aragon apps
  ARAGON_AGENT: 'aragon-agent',
  ARAGON_FINANCE: 'aragon-finance',
  ARAGON_TOKEN_MANAGER: 'aragon-token-manager',
  ARAGON_VOTING: 'aragon-voting'
}

const APP_ARTIFACTS = {
  [APP_NAMES.LIDO]: 'Lido',
  [APP_NAMES.ORACLE]: 'LidoOracle',
  [APP_NAMES.NODE_OPERATORS_REGISTRY]: 'NodeOperatorsRegistry',
  [APP_NAMES.ARAGON_AGENT]: 'external:Agent',
  [APP_NAMES.ARAGON_FINANCE]: 'external:Finance',
  [APP_NAMES.ARAGON_TOKEN_MANAGER]: 'external:TokenManager',
  [APP_NAMES.ARAGON_VOTING]: 'external:Voting'
}

module.exports = { APP_NAMES, APP_ARTIFACTS }
