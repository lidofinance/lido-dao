const chalk = require('chalk')

const rd = (s) => chalk.red(s)
const yl = (s) => chalk.yellow(s)
const gr = (s) => chalk.green(s)
const bl = (s) => chalk.blue(s)
const cy = (s) => chalk.cyan(s)
const mg = (s) => chalk.magenta(s)

const log = (...args) => console.error(...args)
log.stdout = (...args) => console.log(...args)

const OK = gr('[✓]')
const NOT_OK = rd('[×]')

log.success = (...args) => {
  console.error(OK, ...args)
}

log.error = (...args) => {
  console.error(NOT_OK, ...args)
}

const _line = (length = 0, minLength = 20) => ''.padStart(Math.max(length, minLength), '=')

const _header = (minLength = 20, ...args) => {
  if (minLength < 4) minLength = 4
  const msg = args.length && typeof args[0] === 'string' ? args.shift().padEnd(minLength - 4, ' ') : ''
  const line = _line(msg.length + 4, minLength)
  console.error(`\n${cy(line)}\n${cy('=')} ${mg(msg)} ${cy('=')}\n${cy(line)}\n`)
  if (args.length) {
    console.error(...args)
  }
}

const _splitter = (minLength = 20, ...args) => {
  if (minLength < 4) minLength = 4
  console.error(cy(_line(0, minLength)))
  if (args.length) {
    console.error(...args)
  }
}

function logSplitter(...args) {
  _splitter(20, ...args)
}

log.splitter = logSplitter

function logWideSplitter(...args) {
  _splitter(40, ...args)
}

log.wideSplitter = logWideSplitter

function logHeader(...args) {
  _header(40, ...args)
}

log.header = logHeader

function logTable(...args) {
  console.table(...args)
}

log.table = logTable

async function logDeploy(name, promise) {
  logSplitter(`Deploying ${name}...`)
  const instance = await promise
  const receipt = await web3.eth.getTransactionReceipt(instance.transactionHash)
  const { contractName, sourcePath, updatedAt: compiledAt } = instance.constructor._json

  // const compilerVersion = config.solc.version
  // const optimizer = config.solc.optimizer || null
  // const optimizerStatus = optimizer && optimizer.enabled ? `${optimizer.runs} runs` : 'disabled'

  console.error(`${name} address: ${yl(instance.address)}`)
  console.error(`TX hash: ${instance.transactionHash}`)
  // console.log(`Compiler: solc@${compilerVersion} (optimizer: ${optimizerStatus})`)
  console.error(`Gas used: ${receipt.gasUsed}`)

  return instance
}

log.deploy = logDeploy

async function logTx(desc, promise) {
  console.error(`${desc}...`)
  const result = await promise
  console.error(`TX hash: ${yl(result.tx)}`)
  console.error(`Gas used: ${yl(result.receipt.gasUsed)}`)
  return result
}

log.tx = logTx

async function logDeployTxData(contractName, txData) {
  logSplitter(`To deploy ${yl(contractName)}, send the following transaction:`)
  console.log(`{`)
  if (txData.from) {
    console.log(`  "from": "${yl(txData.from)}",`)
  }
  if (txData.gas) {
    console.log(`  "gas": "${yl(txData.gas)}",`)
  }
  console.log(`  "data": "${yl(txData.data)}"`)
  console.log(`}`)
}

log.deployTxData = logDeployTxData

module.exports = {
  log,
  logSplitter,
  logWideSplitter,
  logHeader,
  logTable,
  logDeploy,
  logDeployTxData,
  logTx,
  rd,
  yl,
  gr,
  bl,
  cy,
  mg,
  OK,
  NOT_OK
}
