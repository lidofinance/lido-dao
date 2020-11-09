const chalk = require('chalk')

function log(...args) {
  console.log(...args)
}

function logSplitter(...args) {
  console.log('====================')
  if (args.length) {
    console.log(...args)
  }
}

function logWideSplitter(...args) {
  console.log('========================================')
  if (args.length) {
    console.log(...args)
  }
}

function logHeader(msg) {
  logWideSplitter(msg)
  logWideSplitter()
}

async function logDeploy(name, promise) {
  console.log('====================')
  console.log(`Deploying ${name}...`)
  const instance = await promise
  const receipt = await web3.eth.getTransactionReceipt(instance.transactionHash)
  const { contractName, sourcePath, updatedAt: compiledAt } = instance.constructor._json

  const compilerVersion = config.solc.version
  const optimizer = config.solc.optimizer || null
  const optimizerStatus = optimizer && optimizer.enabled ? `${optimizer.runs} runs` : 'disabled'

  console.log(`${name} address: ${chalk.yellow(instance.address)}`)
  console.log(`TX hash: ${instance.transactionHash}`)
  console.log(`Compiler: solc@${compilerVersion} (optimizer: ${optimizerStatus})`)
  console.log(`Gas used: ${receipt.gasUsed}`)

  return instance
}

async function logTx(desc, promise) {
  console.log(`${desc}...`)
  const result = await promise
  console.log(`TX hash: ${result.tx}`)
  console.log(`Gas used: ${result.receipt.gasUsed}`)
  return result
}

module.exports = {log, logSplitter, logWideSplitter, logHeader, logDeploy, logTx}
