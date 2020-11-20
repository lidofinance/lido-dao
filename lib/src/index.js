const lido = require('./lido')
const nodeOperators = require('./node-operators-registry')
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
    setStakingLimit: nodeOperators.setStakingLimit
  },
  dao: {
    createVote: dao.createVote
  }
}
