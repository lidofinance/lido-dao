const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('./persisted-network-state')
const { artifacts } = require('hardhat')

const GAS_LIMIT = 4194304


async function deployWithoutProxy(nameInState, artifactName, constructorArgs) {
  const netId = await web3.eth.net.getId()
  const state = readNetworkState(network.name, netId)
  const Contract = await hre.ethers.getContractFactory(artifactName)
  const contractAddress = (await Contract.deploy(...constructorArgs, { gasLimit: GAS_LIMIT})).address

  console.log(`${artifactName} (NO proxy): ${contractAddress}`)

  persistNetworkState(network.name, netId, state, {
    [nameInState]: {
      "address": contractAddress,
    }
  })

  return contractAddress
}

async function deployBehindOssifiableProxyOld(nameInState, artifactName, proxyOwner, constructorArgs) {
  const netId = await web3.eth.net.getId()
  const state = readNetworkState(network.name, netId)

  const Contract = await hre.ethers.getContractFactory(artifactName)
  const implementation = (await Contract.deploy(...constructorArgs, { gasLimit: GAS_LIMIT})).address
  console.log(`${artifactName} implementation: ${implementation}`)

  const OssifiableProxy = await hre.ethers.getContractFactory("OssifiableProxy")
  const proxy = (await OssifiableProxy.deploy(
    implementation,
    proxyOwner,
    [],
    { gasLimit: GAS_LIMIT},
  )).address
  console.log(`${artifactName} proxy: ${proxy} (owner is ${proxyOwner})`)

  persistNetworkState(network.name, netId, state, {
    [nameInState]: {
      "implementation": implementation,
      "proxy": proxy,
    }
  })

  return proxy
}


async function deployBehindOssifiableProxy(nameInState, artifactName, proxyOwner, deployer, constructorArgs) {
  const netId = await web3.eth.net.getId()
  const state = readNetworkState(network.name, netId)

  const Contract = await artifacts.require(artifactName)
  const implementation = (await Contract.new(...constructorArgs, { from: deployer })).address
  console.log(`${artifactName} implementation: ${implementation}`)

  const OssifiableProxy = await artifacts.require("OssifiableProxy")
  const proxy = (await OssifiableProxy.new(
    implementation,
    proxyOwner,
    [],
    { gasLimit: GAS_LIMIT, from: deployer },
  )).address
  console.log(`${artifactName} proxy: ${proxy} (owner is ${proxyOwner})`)

  persistNetworkState(network.name, netId, state, {
    [nameInState]: {
      "implementation": implementation,
      "proxy": proxy,
    }
  })

  return proxy
}

module.exports = {
  deployWithoutProxy,
  deployBehindOssifiableProxy,
}
