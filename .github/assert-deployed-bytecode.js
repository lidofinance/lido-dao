const { AssertionError } = require('chai')
const chalk = require('chalk')
const { web3 } = require('hardhat')
const { readJSON } = require('../scripts/helpers/fs')
const { APPS_TO_NAMES, CONTRACTS_TO_NAMES } = require('./deployed-bytecode-consts')

function compareSymbolWise(first, second) {
  for (var i = 0; i < first.length; i++) {
    if (first[i] != second[i] && first[i] != '0' && second[i] != '0') {
      return false
    }
  }
  return true
}

async function assertByteCode(address, artifactName, deployTx) {
  const artifact = await artifacts.readArtifact(artifactName)
  let bytecodeFromArtifact = artifact.deployedBytecode.toLowerCase()
  const bytecodeFromRpc = (await web3.eth.getCode(address)).toLowerCase()
  if (bytecodeFromRpc === bytecodeFromArtifact) {
    console.log(chalk.green(`Compiled bytecode for ${chalk.yellow(address)}(${artifactName}) MATCHES deployed bytecode!`))
  } else if (bytecodeFromRpc.length == bytecodeFromArtifact.length && compareSymbolWise(bytecodeFromArtifact, bytecodeFromRpc)) {
    console.log(chalk.hex('#FFA500')(`Compiled bytecode for ${chalk.yellow(address)}(${artifactName}) is SIMILAR to deployed bytecode!`))
    if (deployTx) {
      await assertByteCodeByDeployTx(address, deployTx, artifact)
    } else {
      throw new AssertionError(
        `No deployTx found for ${chalk.yellow(address)}(${artifactName}).\n` +
          `Double check is impossible, but required due to differences in the deployed bytecode`
      )
    }
  } else {
    throw new AssertionError(`Compiled bytecode for ${chalk.yellow(address)}(${artifactName}) DOESN'T MATCH deployed bytecode!`)
  }
}

async function assertByteCodeByDeployTx(address, deployTx, artifact) {
  const tx = await web3.eth.getTransaction(deployTx)
  const txData = tx.input.toLowerCase()
  if (!txData.startsWith(artifact.bytecode)) {
    throw new AssertionError(
      `Bytecode from deploy TX DOESN'T MATCH compiled bytecode for ${chalk.yellow(address)}(${artifact.contractName})`
    )
  }
  console.log(chalk.green(`Bytecode from deploy TX MATCHES compiled bytecode for ${chalk.yellow(address)}(${artifact.contractName})`))
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
        const deployTx = deployInfo[key.replace('Address', 'DeployTx')]
        await assertByteCode(address, name, deployTx)
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

var myfunc = assertDeployedByteCodeMain()
myfunc.catch(function (err) {
  console.log(err)
  process.exit([1])
})
