const fs = require('fs').promises
const chalk = require('chalk')

const { log } = require('./log')

async function saveCallTxData(txDesc, instance, methodName, filename, opts = {}) {
  const txData = await getCallTxData(instance, methodName, opts)
  log(
    `Saving data for ${chalk.yellow(txDesc)} transaction to ${chalk.yellow(filename)}` +
      (txData.gas ? ` (projected gas usage is ${chalk.yellow(txData.gas)})` : '')
  )
  // const argsDesc = (opts.arguments || []).map(x => chalk.yellow(x)).join(', ')
  // log(`This transaction will call ${methodName}(${argsDesc}) on ${chalk.yellow(instance.address)}`)
  await fs.writeFile(filename, JSON.stringify(txData, null, '  '))
  return txData
}

async function getCallTxData(instance, methodName, opts = {}) {
  const { arguments: args = [], ...txOpts } = opts
  const contract = instance.contract || instance
  const txObj = contract.methods[methodName](...args)
  const txData = await getTxData(txObj, txOpts)
  txData.to = instance.address
  return txData
}

async function getTxData(txObj, opts = {}) {
  const gas = await txObj.estimateGas({
    ...opts,
    from: opts.from || (await web3.eth.getAccounts())[0]
  })
  return {
    ...opts,
    gas: gas + 10000,
    data: txObj.encodeABI()
  }
}

module.exports = { saveCallTxData, getCallTxData, getTxData }
