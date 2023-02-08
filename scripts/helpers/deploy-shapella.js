const { readNetworkState, persistNetworkState2 } = require('./persisted-network-state')
const { artifacts } = require('hardhat')

const GAS_LIMIT = 4194304
// TODO: GAS_LIMIT - remove or move to env or somewhere

async function deployWithoutProxy(nameInState, artifactName, deployer, constructorArgs=[], addressFieldName="address") {
  const netId = await web3.eth.net.getId()
  const state = readNetworkState(network.name, netId)

  if (constructorArgs) {
    console.log(`${artifactName} constructor args: ${constructorArgs}`)
  }

  const Contract = await artifacts.require(artifactName)
  const contract = await Contract.new(...constructorArgs, { from: deployer })

  console.log(`${artifactName} (NO proxy): ${contract.address}`)

  if (nameInState) {
    persistNetworkState2(network.name, netId, state, {
      [nameInState]: {
        "contract": artifactName,
        [addressFieldName]: contract.address,
        "constructorArgs": constructorArgs,
      }
    })
  }

  return contract.address
}


async function deployBehindOssifiableProxy(nameInState, artifactName, proxyOwner, deployer, constructorArgs=[]) {
  const netId = await web3.eth.net.getId()
  const state = readNetworkState(network.name, netId)

  const Contract = await artifacts.require(artifactName)
  const implementation = await Contract.new(...constructorArgs, { from: deployer })
  console.log(`${artifactName} implementation: ${implementation.address}`)

  const OssifiableProxy = await artifacts.require("OssifiableProxy")
  const proxy = await OssifiableProxy.new(
    implementation.address,
    proxyOwner,
    [],
    { gasLimit: GAS_LIMIT, from: deployer },
  )
  console.log(`${artifactName} proxy: ${proxy.address} (owner is ${proxyOwner})`)

  console.log({nameInState})

  persistNetworkState2(network.name, netId, state, {
    [nameInState]: {
      "contract": artifactName,
      "implementation": implementation.address,
      "address": proxy.address,
      "constructorArgs": constructorArgs,
    }
  })

  return proxy.address
}


async function updateProxyImplementation(proxyAddress, artifactName, proxyOwner, constructorArgs) {
  const OssifiableProxy = await artifacts.require('OssifiableProxy')
  const proxy = await OssifiableProxy.at(proxyAddress)

  const Contract = await artifacts.require(artifactName)
  const implementation = await Contract.new(...constructorArgs, { from: proxyOwner })

  await proxy.proxy__upgradeTo(implementation.address, { from: proxyOwner })
}

module.exports = {
  deployWithoutProxy,
  deployBehindOssifiableProxy,
  updateProxyImplementation,
}
