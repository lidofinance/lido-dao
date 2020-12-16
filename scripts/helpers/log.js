const chalk = require('chalk')

const log = (...args) => console.error(...args)
log.stdout = (...args) => console.log(...args)

const OK = chalk.green('✓')

log.success = (...args) => {
  console.error(OK, ...args)
}

function logSplitter(...args) {
  console.error('====================')
  if (args.length) {
    console.error(...args)
  }
}

log.splitter = logSplitter

function logWideSplitter(...args) {
  console.error('========================================')
  if (args.length) {
    console.error(...args)
  }
}

log.wideSplitter = logWideSplitter

function logHeader(msg) {
  logWideSplitter(msg)
  logWideSplitter()
}

log.header = logHeader

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

log.deploy = logDeploy

async function logTx(desc, promise) {
  console.error(`${desc}...`)
  const result = await promise
  console.error(`TX hash: ${result.tx}`)
  console.error(`Gas used: ${result.receipt.gasUsed}`)
  return result
}

log.tx = logTx

async function logDeployTxData(contractName, txData) {
  console.error('====================')
  console.error(`To deploy ${chalk.yellow(contractName)}, send the following transaction:`)
  console.log(`{`)
  if (txData.from) {
    console.log(`  "from": "${chalk.yellow(txData.from)}",`)
  }
  if (txData.gas) {
    console.log(`  "gas": "${chalk.yellow(txData.gas)}",`)
  }
  console.log(`  "data": "${chalk.yellow(txData.data)}"`)
  console.log(`}`)
}

log.deployTxData = logDeployTxData

const yl = (s) => chalk.yellow(s)
const gr = (s) => chalk.green(s)

module.exports = { log, logSplitter, logWideSplitter, logHeader, logDeploy, logDeployTxData, logTx, yl, gr }
