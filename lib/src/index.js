const lido = require('./lido')
const nodeOperators = require('./node-operators-registry')
const oracle = require('./oracle')
const dao = require('./dao')

module.exports = {
  // truffle contract constructors
  NodeOperatorsRegistry: nodeOperators.NodeOperatorsRegistry,
  Lido: lido.Lido,
  StETH: lido.StETH,
  Voting: dao.Voting,
  TokenManager: dao.TokenManager,
  // helpers for obtaining Truffle instances
  getNodeOperatorsRegistry: nodeOperators.getRegistry,
  getLido: lido.getLido,
  getStETH: lido.getStETH,
  getVoting: dao.getVoting,
  getTokenManager: dao.getTokenManager,
  // tx helpers
  submitEther: lido.submitEther,
  setWithdrawalCredentials: lido.setWithdrawalCredentials,
  setFeeDistribution: lido.setFeeDistribution,
  nodeOperators: {
    list: nodeOperators.listOperators,
    addSigningKeys: nodeOperators.addSigningKeys,
    removeSigningKeys: nodeOperators.removeSigningKeys,
    setStakingLimit: nodeOperators.setStakingLimit
  },
  oracle: {
    LidoOracle: oracle.LidoOracle,
    getOracle: oracle.getOracle,
    getBeaconSpec: oracle.getBeaconSpec,
    proposeBeaconSpecChange: oracle.proposeBeaconSpecChange
  },
  dao: {
    proposeChangingVotingQuorum: dao.proposeChangingVotingQuorum,
    proposeChangingVotingSupport: dao.proposeChangingVotingSupport,
    createVote: dao.createVote
  }
}
