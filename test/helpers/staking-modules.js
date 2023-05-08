const { artifacts } = require('hardhat')
const { newApp } = require('./dao')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')
const NodeOperatorsRegistryMock = artifacts.require('NodeOperatorsRegistryMock')

const PENALTY_DELAY = 2 * 24 * 60 * 60 // 2 days

async function setupNodeOperatorsRegistry({ dao, acl, lidoLocator, stakingRouter, voting, appManager }, mock = false) {
  const nodeOperatorsRegistryBase = mock ? await NodeOperatorsRegistryMock.new() : await NodeOperatorsRegistry.new()
  const name = 'node-operators-registry-' + Math.random().toString(36).slice(2, 6)
  const nodeOperatorsRegistryProxyAddress = await newApp(
    dao,
    name,
    nodeOperatorsRegistryBase.address,
    appManager.address
  )

  const nodeOperatorsRegistry = mock
    ? await NodeOperatorsRegistryMock.at(nodeOperatorsRegistryProxyAddress)
    : await NodeOperatorsRegistry.at(nodeOperatorsRegistryProxyAddress)

  await nodeOperatorsRegistry.initialize(lidoLocator.address, '0x01', PENALTY_DELAY)

  const [
    NODE_OPERATOR_REGISTRY_MANAGE_SIGNING_KEYS,
    NODE_OPERATOR_REGISTRY_MANAGE_NODE_OPERATOR_ROLE,
    NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_LIMIT_ROLE,
    NODE_OPERATOR_REGISTRY_STAKING_ROUTER_ROLE,
  ] = await Promise.all([
    nodeOperatorsRegistry.MANAGE_SIGNING_KEYS(),
    nodeOperatorsRegistry.MANAGE_NODE_OPERATOR_ROLE(),
    nodeOperatorsRegistry.SET_NODE_OPERATOR_LIMIT_ROLE(),
    nodeOperatorsRegistry.STAKING_ROUTER_ROLE(),
  ])

  await Promise.all([
    // Allow voting to manage node operators registry
    acl.createPermission(
      voting.address,
      nodeOperatorsRegistry.address,
      NODE_OPERATOR_REGISTRY_MANAGE_SIGNING_KEYS,
      appManager.address,
      {
        from: appManager.address,
      }
    ),
    acl.createPermission(
      voting.address,
      nodeOperatorsRegistry.address,
      NODE_OPERATOR_REGISTRY_MANAGE_NODE_OPERATOR_ROLE,
      appManager.address,
      {
        from: appManager.address,
      }
    ),

    acl.createPermission(
      voting.address,
      nodeOperatorsRegistry.address,
      NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_LIMIT_ROLE,
      appManager.address,
      {
        from: appManager.address,
      }
    ),
    acl.createPermission(
      voting.address,
      nodeOperatorsRegistry.address,
      NODE_OPERATOR_REGISTRY_STAKING_ROUTER_ROLE,
      appManager.address,
      { from: appManager.address }
    ),
  ])

  await acl.grantPermission(
    stakingRouter.address,
    nodeOperatorsRegistry.address,
    NODE_OPERATOR_REGISTRY_STAKING_ROUTER_ROLE,
    { from: appManager.address }
  )

  await acl.grantPermission(
    stakingRouter.address,
    nodeOperatorsRegistry.address,
    NODE_OPERATOR_REGISTRY_MANAGE_NODE_OPERATOR_ROLE,
    { from: appManager.address }
  )

  await acl.grantPermission(
    stakingRouter.address,
    nodeOperatorsRegistry.address,
    NODE_OPERATOR_REGISTRY_MANAGE_NODE_OPERATOR_ROLE,
    { from: appManager.address }
  )

  return nodeOperatorsRegistry
}

module.exports = {
  NodeOperatorsRegistry,
  NodeOperatorsRegistryMock,
  setupNodeOperatorsRegistry,
}
