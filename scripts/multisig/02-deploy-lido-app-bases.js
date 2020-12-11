const chalk = require('chalk')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter } = require('../helpers/log')
const { saveDeployTx } = require('../helpers/deploy')

async function deployLidoBases({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  logSplitter()
  await saveDeployTx('Lido', 'tx-02-deploy-lido-base.json')

  logSplitter()
  await saveDeployTx('LidoOracle', 'tx-03-deploy-oracle-base.json')

  logSplitter()
  await saveDeployTx('NodeOperatorsRegistry', 'tx-04-deploy-nops-base.json')
}

module.exports = runOrWrapScript(deployLidoBases, module)
