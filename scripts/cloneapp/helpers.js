async function getDeployer(web3, defaultDeployer) {
  if (!defaultDeployer) {
    const [firstAccount] = await web3.eth.getAccounts()
    return firstAccount
  }
  return defaultDeployer
}

function readStateAppAddress(state, app = '') {
  const appState = state[app]
  // goerli/mainnet deployed.json formats compatibility
  return appState.proxyAddress || (appState.proxy && appState.proxy.address) || appState.address
}

module.exports = {
  readStateAppAddress,
  getDeployer,
}
