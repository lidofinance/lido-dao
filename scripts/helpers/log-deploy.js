const chalk = require('chalk')

module.exports = async (name, instance) => {
  const { contractName } = instance.constructor._json

  const compilerVersion = config.solc.version
  const optimizer = config.solc.optimizer || null
  const optimizerStatus = optimizer && optimizer.enabled ? `${optimizer.runs} runs` : 'disabled'

  console.log('=========')
  console.log(`# ${contractName}:`)
  console.log(`Address: ${chalk.yellow(instance.address)}`)
  console.log(`Transaction hash: ${chalk.yellow(instance.transactionHash)}`)
  console.log(`Compiler: solc@${compilerVersion} (optimizer: ${optimizerStatus})`)
  console.log('=========')
}
