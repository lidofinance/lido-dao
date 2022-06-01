const { assert } = require('chai')
const chalk = require('chalk')
const { readJSON } = require('../scripts/helpers/fs')
const { APPS_TO_NAMES, CONTRACTS_TO_NAMES } = require('./deployed-bytecode-consts')

// function deployArgToBytes(arg) {
//   let coded = ''
//   if (typeof arg == 'number') {
//     const hex = arg.toString(16)
//     coded = '0'.repeat(64 - hex.length) + hex
//   }
//   if (typeof arg == 'string') {
//     const hex = arg.slice(2)
//     coded = '0'.repeat(64 - hex.length) + hex
//   }
//   return coded
// }

async function assertByteCode(address, artifactName) {
  const artifact = await artifacts.readArtifact(artifactName)
  let bytecodeFromArtifact = artifact.deployedBytecode.toLowerCase()
  const bytecodeFromRpc = (await web3.eth.getCode(address)).toLowerCase()
  // console.log(`From RPC:\n${bytecodeFromRpc}`)
  // console.log(`From Artifact:\n${bytecodeFromArtifact}`)
  assert.isTrue(
    bytecodeFromRpc === bytecodeFromArtifact,
    `Compiled bytecode for ${chalk.yellow(address)}(${artifactName}) doesn't match deployed bytecode!`
  )
  console.log(chalk.green(`Compiled bytecode for ${chalk.yellow(address)}(${artifactName}) matches deployed bytecode!`))
}

async function assertDeployedByteCodeMain() {
  const deployInfo = await readJSON(`deployed-mainnet.json`)
  // handle APPs
  const resultsApps = await Promise.allSettled(
    Object.entries(deployInfo).map(async ([key, value]) => {
      if (key.startsWith('app:') && !key.startsWith('app:aragon')) {
        const name = APPS_TO_NAMES.get(key.split(':')[1])
        if (!name) {
          throw `Unknown APP ${key}`
        }
        const address = value.baseAddress
        if (!address) {
          throw `APP ${key} has no baseAddress`
        }
        await assertByteCode(address, name)
      }
    })
  )
  // handle standalone contracts
  const resultsContracts = await Promise.allSettled(
    Object.entries(deployInfo).map(async ([key, value]) => {
      if (!key.startsWith('app:') && key.endsWith('Address')) {
        const name = CONTRACTS_TO_NAMES.get(key.replace('Address', ''))
        if (!name) {
          return
        }
        const address = value
        await assertByteCode(address, name)
      }
    })
  )
  let errors = []
  resultsApps.concat(resultsContracts).forEach((result) => {
    if (result.status == 'rejected') {
      errors.push(result.reason)
    }
  })
  if (errors.length > 0) {
    throw new Error(`Following errors occurred during execution:\n${chalk.red(errors.join('\n'))}`)
  }
}

assertDeployedByteCodeMain()
