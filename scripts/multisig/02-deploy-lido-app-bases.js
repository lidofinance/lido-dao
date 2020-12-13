const chalk = require('chalk')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter } = require('../helpers/log')
const { saveDeployTx } = require('../helpers/deploy')

async function deployLidoBases({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  logSplitter()
  await saveDeployTx('Lido', 'tx-01-2-deploy-lido-base.json')

  logSplitter()
  await saveDeployTx('LidoOracle', 'tx-01-3-deploy-oracle-base.json')

  logSplitter()
  await saveDeployTx('NodeOperatorsRegistry', 'tx-01-4-deploy-nops-base.json')
}

module.exports = runOrWrapScript(deployLidoBases, module)
