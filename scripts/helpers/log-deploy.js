module.exports = async (name, instance) => {
  const {
    contractName,
    sourcePath,
    updatedAt: compiledAt,
  } = instance.constructor._json

  const compilerVersion = config.solc.version
  const optimizer = config.solc.optimizer || null
  const optimizerStatus = optimizer && optimizer.enabled ? `${optimizer.runs} runs`: 'disabled'

  console.log('=========')
  console.log(`# ${contractName}:`)
  console.log(`Address: ${instance.address}`)
  console.log(`Transaction hash: ${instance.transactionHash}`)
  console.log(`Compiler: solc@${compilerVersion} (optimizer: ${optimizerStatus})`)
  console.log('=========')
}
