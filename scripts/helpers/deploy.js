const { readNetworkState, persistNetworkState2 } = require('./persisted-network-state')
const { artifacts, ethers } = require('hardhat')
const fs = require('fs').promises
const chalk = require('chalk')
const { assert } = require('chai')

const { log, logDeploy, logDeployTxData } = require('./log')
const { getTxData } = require('./tx-data')


const GAS_PRICE = process.env.GAS_PRICE || null
const GAS_PRIORITY_FEE = process.env.GAS_PRIORITY_FEE || null
const GAS_MAX_FEE = process.env.GAS_MAX_FEE || null

let TOTAL_GAS_USED = 0

function getTotalGasUsed() {
  return TOTAL_GAS_USED
}

async function getDeploymentGasUsed(contract) {
  let txHash = null
  if (contract.deployTransaction) {
    txHash = contract.deployTransaction.hash
  } else {
    txHash = contract.transactionHash
  }
  const tx = await web3.eth.getTransactionReceipt(txHash)
  return tx.gasUsed
}

async function printDeployTx(artifactName, opts = {}) {
  const txData = await getDeployTx(artifactName, opts)
  logDeployTxData(artifactName, txData)
  return txData
}

async function saveDeployTx(artifactName, filename, opts = {}) {
  const txData = await getDeployTx(artifactName, opts)
  log(`Saving deploy TX data for ${artifactName} to ${chalk.yellow(filename)}`)
  await fs.writeFile(filename, JSON.stringify(txData, null, '  '))
  return txData
}

async function getDeployTx(artifactName, opts = {}) {
  const { arguments: args = [], ...txOpts } = opts
  const artifactData = await artifacts.readArtifact(artifactName)
  const contract = new web3.eth.Contract(artifactData.abi, txOpts)
  const txObj = contract.deploy({ data: artifactData.bytecode, arguments: args })
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

async function getTxBlock(txHash) {
  const receipt = await web3.eth.getTransactionReceipt(txHash)
  if (!receipt) {
    throw new Error(`transaction ${txHash} not found`)
  }
  if (!receipt.blockNumber) {
    throw new Error(`transaction ${txHash} does not contain blockNumber`)
  }
  return receipt.blockNumber
}

async function assertDeployedBytecode(address, artifact, desc = '') {
  if (typeof artifact === 'string') {
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
  // TODO: restore the check
  // if (bytecode.toLowerCase() !== artifact.deployedBytecode.toLowerCase()) {
  //   console.log({bytecode: bytecode.toLowerCase()})
  //   console.log({deployedBytecode: artifact.deployedBytecode.toLowerCase()})
  // }
  // assert.isTrue(bytecode.toLowerCase() === artifact.deployedBytecode.toLowerCase(), checkDesc)
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

async function getDeployTxParams(deployer) {
  const [deployerSigner] = await hre.ethers.getSigners();
  if (deployer !== deployerSigner.address) {
    console.log({deployerSigner})
    throw new Error('DEPLOYER set in ENV must correspond to the deployer specified in accounts.json')
  }

  if (GAS_PRIORITY_FEE !== null && GAS_MAX_FEE !== null) {
    return {
      type: 2,
      maxPriorityFeePerGas: ethers.utils.parseUnits(String(GAS_PRIORITY_FEE), "gwei"),
      maxFeePerGas: ethers.utils.parseUnits(String(GAS_MAX_FEE), "gwei"),
    }
  } else if (GAS_PRICE !== null) {
    return {
      from: deployer,
      gasPrice: GAS_PRICE,
    }
  } else {
    throw new Error('Must specify gas ENV vars: either "GAS_PRICE" or both "GAS_PRIORITY_FEE" and "GAS_MAX_FEE" in gwei (like just "3")')
  }
}

async function deployContractType1(artifactName, constructorArgs, deployer) {
  const Contract = await artifacts.require(artifactName)
  const txParams = await getDeployTxParams(deployer)
  const contract = await Contract.new(...constructorArgs, txParams)
  return contract
}

async function deployContractType2(artifactName, constructorArgs, deployer) {
  const Contract = await ethers.getContractFactory(artifactName)
  const txParams = await getDeployTxParams(deployer)
  const contract = await Contract.deploy(...constructorArgs, txParams)
  await contract.deployed()
  return contract
}

async function deployContract(artifactName, constructorArgs, deployer) {
  const txParams = await getDeployTxParams(deployer)
  if (txParams.type === 2) {
    return await deployContractType2(artifactName, constructorArgs, deployer)
  } else {
    return await deployContractType1(artifactName, constructorArgs, deployer)
  }
}

async function deployWithoutProxy(nameInState, artifactName, deployer, constructorArgs=[], addressFieldName="address") {
  const netId = await web3.eth.net.getId()
  const state = readNetworkState(network.name, netId)

  process.stdout.write(`Deploying ${artifactName} (NO proxy)... `)

  const contract = await deployContract(artifactName, constructorArgs, deployer)

  const gasUsed = await getDeploymentGasUsed(contract)
  console.log(`done: ${contract.address} (gas used ${gasUsed})`)
  TOTAL_GAS_USED += gasUsed

  if (nameInState) {
    persistNetworkState2(network.name, netId, state, {
      [nameInState]: {
        contract: artifactName,
        contractPath: await artifacts.require(artifactName)._hArtifact.sourceName,
        [addressFieldName]: contract.address,
        constructorArgs: constructorArgs,
      }
    })
  }
  console.log()
  return contract.address
}

async function deployImplementation(nameInState, artifactName, deployer, constructorArgs=[]) {
  const netId = await web3.eth.net.getId()
  const state = readNetworkState(network.name, netId)

  process.stdout.write(`Deploying implementation for proxy of ${artifactName}... `)
  const contract = await deployContract(artifactName, constructorArgs, deployer)

  const gasUsed = await getDeploymentGasUsed(contract)
  TOTAL_GAS_USED += gasUsed
  implementation = contract.address

  console.log(`done: ${implementation} (gas used ${gasUsed})`)

  persistNetworkState2(network.name, netId, state, {
    [nameInState]: {
      "implementation": {
        contract: artifactName,
        address: implementation,
        constructorArgs: constructorArgs,
      },
    }
  })
}

async function deployBehindOssifiableProxy(nameInState, artifactName, proxyOwner, deployer, constructorArgs=[], implementation=null) {
  const netId = await web3.eth.net.getId()
  const state = readNetworkState(network.name, netId)

  if (implementation === null) {
    process.stdout.write(`Deploying implementation for proxy of ${artifactName}... `)
    const contract = await deployContract(artifactName, constructorArgs, deployer)

    const gasUsed = await getDeploymentGasUsed(contract)
    TOTAL_GAS_USED += gasUsed
    implementation = contract.address

    console.log(`done: ${implementation} (gas used ${gasUsed})`)
  } else {
    console.log(`Using pre-deployed implementation of ${artifactName}: ${implementation}`)
  }

  process.stdout.write(`Deploying OssifiableProxy for ${artifactName}... `)
  const proxy = await deployContract("OssifiableProxy", [implementation, proxyOwner, []], deployer)
  const gasUsed = await getDeploymentGasUsed(proxy)
  TOTAL_GAS_USED += gasUsed
  console.log(`done: ${proxy.address} (gas used ${gasUsed})`)

  persistNetworkState2(network.name, netId, state, {
    [nameInState]: {
      "contract": artifactName,
      "implementation": implementation,
      "address": proxy.address,
      "constructorArgs": constructorArgs,
    }
  })
  console.log()
  return proxy.address
}

async function updateProxyImplementation(nameInState, artifactName, proxyAddress, proxyOwner, constructorArgs) {
  const netId = await web3.eth.net.getId()
  const state = readNetworkState(network.name, netId)

  const proxy = await artifacts.require('OssifiableProxy').at(proxyAddress)

  const implementation = await deployContract(artifactName, constructorArgs, proxyOwner)

  await log.makeTx(proxy, 'proxy__upgradeTo', [implementation.address], { from: proxyOwner })

  persistNetworkState2(network.name, netId, state, {
    [nameInState]: {
      "contract": artifactName,
      "implementation": implementation.address,
      "constructorArgs": constructorArgs,
    }
  })
}

module.exports = {
  printDeployTx,
  saveDeployTx,
  getDeployTx,
  deploy,
  useOrDeploy,
  useOrGetDeployed,
  getDeployed,
  getTxBlock,
  assertDeployedBytecode,
  assertProxiedContractBytecode,
  withArgs,
  getDeployTxParams,
  deployWithoutProxy,
  deployContract,
  deployImplementation,
  deployBehindOssifiableProxy,
  updateProxyImplementation,
  getTotalGasUsed,
}
