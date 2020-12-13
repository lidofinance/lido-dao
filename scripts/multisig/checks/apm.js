const { assertRole, assertMissingRole } = require('../../helpers/aragon')

async function assertAPMRegistryPermissions({ registry, registrar, registryACL, registryKernel, rootAddress }) {
  const allAclEvents = await registryACL.getPastEvents('allEvents', { fromBlock: 0 })

  await assertRole({
    acl: registryACL,
    app: registry,
    appName: 'registry',
    roleName: 'CREATE_REPO_ROLE',
    managerAddress: rootAddress,
    granteeAddress: rootAddress,
    onlyGrantee: true,
    allAclEvents
  })

  await assertRole({
    acl: registryACL,
    app: registryKernel,
    appName: 'registry.kernel',
    roleName: 'APP_MANAGER_ROLE',
    managerAddress: rootAddress
  })

  await assertRole({
    acl: registryACL,
    app: registryACL,
    appName: 'registry.kernel.acl',
    roleName: 'CREATE_PERMISSIONS_ROLE',
    managerAddress: rootAddress,
    granteeAddress: [rootAddress, registry.address],
    onlyGrantee: true,
    allAclEvents
  })

  await assertRole({
    acl: registryACL,
    app: registrar,
    appName: 'registry.registrar',
    roleName: 'CREATE_NAME_ROLE',
    managerAddress: rootAddress,
    granteeAddress: registry.address,
    onlyGrantee: true,
    allAclEvents
  })

  await assertRole({
    acl: registryACL,
    app: registrar,
    appName: 'registry.registrar',
    roleName: 'POINT_ROOTNODE_ROLE',
    managerAddress: rootAddress,
    granteeAddress: registry.address,
    onlyGrantee: true,
    allAclEvents
  })

  await assertMissingRole({
    acl: registryACL,
    app: registrar,
    appName: 'registry.registrar',
    roleName: 'DELETE_NAME_ROLE',
    allAclEvents
  })
}

module.exports = { assertAPMRegistryPermissions }
