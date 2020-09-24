const ANY_ADDRESS = '0xffffffffffffffffffffffffffffffffffffffff'

const setOpenPermission = async (acl, appAddress, role, rootAddress) => {
  // Note: Setting a permission to 0xffffffffffffffffffffffffffffffffffffffff
  // is interpreted by aragonOS as allowing the role for any address.
  await acl.createPermission(
    ANY_ADDRESS, // entity (who?) - The entity or address that will have the permission.
    appAddress, // app (where?) - The app that holds the role involved in this permission.
    role, // role (what?) - The particular role that the entity is being assigned to in this permission.
    rootAddress, // manager - Can grant/revoke further permissions for this role.
    { from: rootAddress}
  )
}

module.exports = {
  setOpenPermission
}
