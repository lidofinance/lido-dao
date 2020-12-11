const fs = require('fs').promises
const chalk = require('chalk')
const { assert } = require('chai')

const { log, logDeploy, logDeployTxData } = require('./log')
const { getTxData } = require('./tx-data')

async function printDeployTx(artifactName, arguments, opts = {}) {
  const txData = await getDeployTx(artifactName, arguments, opts)
  logDeployTxData(artifactName, txData)
  return txData
}

async function saveDeployTx(artifactName, filename, arguments, opts = {}) {
  const txData = await getDeployTx(artifactName, arguments, opts)
  log(`Saving deploy TX data for ${chalk.yellow(artifactName)} to ${chalk.yellow(filename)}`)
  await fs.writeFile(filename, JSON.stringify(txData, null, '  '))
  return txData
}

async function getDeployTx(artifactName, arguments = [], opts = {}) {
  const artifactData = await artifacts.readArtifact(artifactName)
  const contract = new web3.eth.Contract(artifactData.abi)
  const txObj = contract.deploy({ data: artifactData.bytecode, arguments })
  return await getTxData(txObj)
}

async function deploy(artifactName, artifacts, deploy) {
  const Artifact = artifacts.require(artifactName)
  return await logDeploy(artifactName, deploy ? deploy(Artifact) : Artifact.new())
}

async function useOrDeploy(artifactName, artifacts, address, deploy) {
  const Artifact = artifacts.require(artifactName)
  if (address) {
    log(`Using ${artifactName}: ${chalk.yellow(address)}`)
    return await Artifact.at(address)
  } else {
    return await logDeploy(artifactName, deploy ? deploy(Artifact) : Artifact.new())
  }
}

async function useOrGetDeployed(artifactName, address, deployTxHash) {
  const Artifact = artifacts.require(artifactName)
  if (address) {
    log(`Using ${artifactName}: ${chalk.yellow(address)}`)
    return await Artifact.at(address)
  } else {
    return await getDeployed(artifactName, deployTxHash)
  }
}

async function getDeployed(artifactName, deployTxHash) {
  const Artifact = artifacts.require(artifactName)
  log(`Using transaction: ${chalk.yellow(deployTxHash)}`)
  const receipt = await web3.eth.getTransactionReceipt(deployTxHash)
  if (!receipt) {
    throw new Error(`transaction ${deployTxHash} not found`)
  }
  if (!receipt.contractAddress) {
    throw new Error(`transaction ${deployTxHash} is not a contract creation transaction`)
  }
  log(`Using ${artifactName}: ${chalk.yellow(receipt.contractAddress)}`)
  return await Artifact.at(receipt.contractAddress)
}

async function assertDeployedBytecode(address, artifact, desc = '') {
  if ('string' === typeof artifact) {
    const artifactName = artifact
    artifact = await artifacts.readArtifact(artifactName)
    if (!artifact.contractName) {
      artifact.contractName = artifactName
    }
  }
  if (!artifact.deployedBytecode) {
    assert.isTrue(false, `the provided artifact doesn't contain deployedBytecode`)
  }
  const bytecode = await web3.eth.getCode(address)
  const nameDesc = artifact.contractName ? chalk.yellow(artifact.contractName) : 'the expected one'
  const checkDesc = `${desc ? desc + ': ' : ''}the bytecode at ${chalk.yellow(address)} matches ${nameDesc}`
  assert.isTrue(bytecode.toLowerCase() === artifact.deployedBytecode.toLowerCase(), checkDesc)
  log.success(checkDesc)
}

async function assertProxiedContractBytecode(proxyAddress, proxyArtifact, proxiedArtifact, desc) {
  desc = desc ? `${desc} ` : ''
  await assertDeployedBytecode(proxyAddress, proxyArtifact, `${desc}proxy`)
  const proxy = await artifacts.require('ERCProxy').at(proxyAddress)
  const implAddress = await proxy.implementation()
  await assertDeployedBytecode(implAddress, proxiedArtifact, `${desc}impl`)
  return implAddress
}

function withArgs(...args) {
  return async (Artifact) => {
    const instance = await Artifact.new(...args)
    const lastArg = args[args.length - 1]
    // remove {from: ..., gas: ...}
    instance.constructorArgs = lastArg && typeof lastArg === 'object' && lastArg.constructor === Object ? args.slice(0, -1) : args
    return instance
  }
}

module.exports = {
  printDeployTx,
  saveDeployTx,
  getDeployTx,
  deploy,
  useOrDeploy,
  useOrGetDeployed,
  getDeployed,
  assertDeployedBytecode,
  assertProxiedContractBytecode,
  withArgs
}
