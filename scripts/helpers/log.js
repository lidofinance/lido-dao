const chalk = require('chalk')

const log = (...args) => console.error(...args)
log.stdout = (...args) => console.log(...args)

function logSplitter(...args) {
  console.error('====================')
  if (args.length) {
    console.error(...args)
  }
}

function logWideSplitter(...args) {
  console.error('========================================')
  if (args.length) {
    console.error(...args)
  }
}

function logHeader(msg) {
  logWideSplitter(msg)
  logWideSplitter()
}

async function logDeploy(name, promise) {
  console.error('====================')
  console.error(`Deploying ${name}...`)
  const instance = await promise
  const receipt = await web3.eth.getTransactionReceipt(instance.transactionHash)
  const { contractName, sourcePath, updatedAt: compiledAt } = instance.constructor._json

  // const compilerVersion = config.solc.version
  // const optimizer = config.solc.optimizer || null
  // const optimizerStatus = optimizer && optimizer.enabled ? `${optimizer.runs} runs` : 'disabled'

  console.error(`${name} address: ${chalk.yellow(instance.address)}`)
  console.error(`TX hash: ${instance.transactionHash}`)
  // console.log(`Compiler: solc@${compilerVersion} (optimizer: ${optimizerStatus})`)
  console.error(`Gas used: ${receipt.gasUsed}`)

  return instance
}

async function logTx(desc, promise) {
  console.error(`${desc}...`)
  const result = await promise
  console.error(`TX hash: ${result.tx}`)
  console.error(`Gas used: ${result.receipt.gasUsed}`)
  return result
}

module.exports = { log, logSplitter, logWideSplitter, logHeader, logDeploy, logTx }
