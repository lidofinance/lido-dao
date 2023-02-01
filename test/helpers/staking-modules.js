

const { newApp } = require('./dao')
const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

async function setupNodeOperatorsRegistry({ dao, acl, token, stakingRouter, voting, appManager }) {
  const nodeOperatorsRegistryBase = await NodeOperatorsRegistry.new({gasPrice: 10})
  const name = 'node-operators-registry-' + Math.random().toString(36).slice(2, 6)
  const nodeOperatorsRegistryProxyAddress = await newApp(
    dao,
    name,
    nodeOperatorsRegistryBase.address,
    appManager.address
  )

  const nodeOperatorsRegistry = await NodeOperatorsRegistry.at(nodeOperatorsRegistryProxyAddress)

  await nodeOperatorsRegistry.initialize(token.address, '0x01')

  const [
    NODE_OPERATOR_REGISTRY_MANAGE_SIGNING_KEYS,
    NODE_OPERATOR_REGISTRY_ADD_NODE_OPERATOR_ROLE,
    NODE_OPERATOR_REGISTRY_ACTIVATE_NODE_OPERATOR_ROLE,
    NODE_OPERATOR_REGISTRY_DEACTIVATE_NODE_OPERATOR_ROLE,
    NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_NAME_ROLE,
    NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_ADDRESS_ROLE,
    NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_LIMIT_ROLE,
    NODE_OPERATOR_REGISTRY_STAKING_ROUTER_ROLE,
    NODE_OPERATOR_REGISTRY_REQUEST_VALIDATORS_KEYS_FOR_DEPOSITS_ROLE,
    NODE_OPERATOR_REGISTRY_INVALIDATE_READY_TO_DEPOSIT_KEYS_ROLE
  ] = await Promise.all([
    nodeOperatorsRegistry.MANAGE_SIGNING_KEYS(),
    nodeOperatorsRegistry.ADD_NODE_OPERATOR_ROLE(),
    nodeOperatorsRegistry.ACTIVATE_NODE_OPERATOR_ROLE(),
    nodeOperatorsRegistry.DEACTIVATE_NODE_OPERATOR_ROLE(),
    nodeOperatorsRegistry.SET_NODE_OPERATOR_NAME_ROLE(),
    nodeOperatorsRegistry.SET_NODE_OPERATOR_ADDRESS_ROLE(),
    nodeOperatorsRegistry.SET_NODE_OPERATOR_LIMIT_ROLE(),
    nodeOperatorsRegistry.STAKING_ROUTER_ROLE(),
    nodeOperatorsRegistry.REQUEST_VALIDATORS_KEYS_FOR_DEPOSITS_ROLE(),
    nodeOperatorsRegistry.INVALIDATE_READY_TO_DEPOSIT_KEYS_ROLE()
  ])

  await Promise.all([
    // Allow voting to manage node operators registry
    acl.createPermission(
      voting.address,
      nodeOperatorsRegistry.address,
      NODE_OPERATOR_REGISTRY_MANAGE_SIGNING_KEYS,
      appManager.address,
      {
        from: appManager.address
      }
    ),
    acl.createPermission(
      voting.address,
      nodeOperatorsRegistry.address,
      NODE_OPERATOR_REGISTRY_ADD_NODE_OPERATOR_ROLE,
      appManager.address,
      {
        from: appManager.address
      }
    ),
    acl.createPermission(
      voting.address,
      nodeOperatorsRegistry.address,
      NODE_OPERATOR_REGISTRY_ACTIVATE_NODE_OPERATOR_ROLE,
      appManager.address,
      {
        from: appManager.address
      }
    ),
    acl.createPermission(
      voting.address,
      nodeOperatorsRegistry.address,
      NODE_OPERATOR_REGISTRY_DEACTIVATE_NODE_OPERATOR_ROLE,
      appManager.address,
      {
        from: appManager.address
      }
    ),
    acl.createPermission(
      voting.address,
      nodeOperatorsRegistry.address,
      NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_NAME_ROLE,
      appManager.address,
      {
        from: appManager.address
      }
    ),
    acl.createPermission(
      voting.address,
      nodeOperatorsRegistry.address,
      NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_ADDRESS_ROLE,
      appManager.address,
      {
        from: appManager.address
      }
    ),
    acl.createPermission(
      voting.address,
      nodeOperatorsRegistry.address,
      NODE_OPERATOR_REGISTRY_SET_NODE_OPERATOR_LIMIT_ROLE,
      appManager.address,
      {
        from: appManager.address
      }
    ),
    acl.createPermission(
      voting.address,
      nodeOperatorsRegistry.address,
      NODE_OPERATOR_REGISTRY_STAKING_ROUTER_ROLE,
      appManager.address,
      { from: appManager.address }
    ),
    acl.createPermission(
      stakingRouter.address,
      nodeOperatorsRegistry.address,
      NODE_OPERATOR_REGISTRY_REQUEST_VALIDATORS_KEYS_FOR_DEPOSITS_ROLE,
      appManager.address,
      {
        from: appManager.address
      }
    ),
    acl.createPermission(
      stakingRouter.address,
      nodeOperatorsRegistry.address,
      NODE_OPERATOR_REGISTRY_INVALIDATE_READY_TO_DEPOSIT_KEYS_ROLE,
      appManager.address,
      {
        from: appManager.address
      }
    )
  ])

  await acl.grantPermission(
    stakingRouter.address,
    nodeOperatorsRegistry.address,
    NODE_OPERATOR_REGISTRY_STAKING_ROUTER_ROLE,
    { from: appManager.address }
  )

  return nodeOperatorsRegistry
}

module.exports = {
  setupNodeOperatorsRegistry
}
