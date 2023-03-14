const { artifacts } = require('hardhat')
const { hash } = require('eth-ens-namehash')
const { getEventArgument } = require('@aragon/contract-helpers-test')

const Kernel = artifacts.require('@aragon/os/build/contracts/kernel/Kernel')
const ACL = artifacts.require('@aragon/os/build/contracts/acl/ACL')
const EVMScriptRegistryFactory = artifacts.require('@aragon/os/build/contracts/factory/EVMScriptRegistryFactory')
const DAOFactory = artifacts.require('@aragon/os/build/contracts/factory/DAOFactory')

class AragonDAO {
  static async create(appManager) {
    const kernelBase = await Kernel.new(true)
    const aclBase = await ACL.new()
    const registryFactory = await EVMScriptRegistryFactory.new()
    const daoFactory = await DAOFactory.new(kernelBase.address, aclBase.address, registryFactory.address)

    // Create a DAO instance.
    const daoReceipt = await daoFactory.newDAO(appManager)
    const kernel = await Kernel.at(getEventArgument(daoReceipt, 'DeployDAO', 'dao'))

    // Grant the rootAccount address permission to install apps in the DAO.
    const acl = await ACL.at(await kernel.acl())
    const APP_MANAGER_ROLE = await kernelBase.APP_MANAGER_ROLE()
    await acl.createPermission(appManager, kernel.address, APP_MANAGER_ROLE, appManager, { from: appManager })

    return new AragonDAO(kernel, acl, appManager)
  }

  constructor(kernel, acl, appManager) {
    this.acl = acl
    this.kernel = kernel
    this.appManager = appManager
  }

  /**
   * Adds new App to the DAO
   * @param {object} config Config of the newly added app
   * @param {string} config.name Name of the app
   * @param {string} config.base Address of the base implementation of the app
   * @param {object} config.permissions Permissions to create for the new app in form of Map. Where key is a permission name
   *    and the value is the list of the address or unique address to grant this role
   * @param {string} config.initPayload Hex encoded data of the initialize method
   * @returns {object} address of the proxy of the added aragon app instance
   */
  async newAppInstance(config) {
    const name = config.name || ''
    if (!name) {
      throw new Error('Application name is empty')
    }

    const base = config.base || null
    if (!base) {
      throw new Error('Application base implementation address is empty')
    }

    const permissions = {}
    for (const [permissionName, entities] of Object.entries(config.permissions || {})) {
      permissions[permissionName] = Array.isArray(entities) ? entities : [entities]
      if (permissions[permissionName].length === 0) {
        throw new Error('No entity to grant permission')
      }
    }

    const initPayload = config.initPayload || '0x'

    const receipt = await this.kernel.newAppInstance(hash(`${name}.aragonpm.test`), base.address, initPayload, false, {
      from: this.appManager,
    })
    const logs = receipt.logs
    const log = logs.find((l) => l.event === 'NewAppProxy')
    const app = await base.constructor.at(log.args.proxy)

    for (const [permissionName, entities] of Object.entries(permissions)) {
      const permission = await app[permissionName]()
      await this.acl.createPermission(entities[0], app.address, permission, this.appManager, { from: this.appManager })

      for (const entity of entities.slice(1)) {
        await this.acl.grantPermission(entity, app.address, permission, { from: this.appManager })
      }
    }
    return app
  }

  async createPermission(entityAddress, app, permissionName) {
    const permission = await app[permissionName]()
    return await this.acl.createPermission(entityAddress, app.address, permission, this.appManager, {
      from: this.appManager,
    })
  }

  async grantPermission(entityAddress, app, permissionName) {
    const permission = await app[permissionName]()
    return await this.acl.grantPermission(entityAddress, app.address, permission, { from: this.appManager })
  }

  async hasPermission(entity, app, permissionName) {
    const permission = await app[permissionName]()
    return await this.acl.hasPermission(entity, app.address, permission)
  }
}

const newDao = async (rootAccount) => {
  // Deploy a DAOFactory.
  const kernelBase = await Kernel.new(true)
  const aclBase = await ACL.new()
  const registryFactory = await EVMScriptRegistryFactory.new()
  const daoFactory = await DAOFactory.new(kernelBase.address, aclBase.address, registryFactory.address)

  // Create a DAO instance.
  const daoReceipt = await daoFactory.newDAO(rootAccount)
  const dao = await Kernel.at(getEventArgument(daoReceipt, 'DeployDAO', 'dao'))

  // Grant the rootAccount address permission to install apps in the DAO.
  const acl = await ACL.at(await dao.acl())
  const APP_MANAGER_ROLE = await kernelBase.APP_MANAGER_ROLE()
  await acl.createPermission(rootAccount, dao.address, APP_MANAGER_ROLE, rootAccount, { from: rootAccount })

  return { dao, acl }
}

const newApp = async (dao, appName, baseAppAddress, rootAccount) => {
  const receipt = await dao.newAppInstance(
    hash(`${appName}.aragonpm.test`), // appId - Unique identifier for each app installed in the DAO; can be any bytes32 string in the tests.
    baseAppAddress, // appBase - Location of the app's base implementation.
    '0x', // initializePayload - Used to instantiate and initialize the proxy in the same call (if given a non-empty bytes string).
    false, // setDefault - Whether the app proxy is the default proxy.
    { from: rootAccount }
  )

  // Find the deployed proxy address in the tx logs.
  const logs = receipt.logs
  const log = logs.find((l) => l.event === 'NewAppProxy')
  const proxyAddress = log.args.proxy

  return proxyAddress
}

module.exports = {
  AragonDAO,
  newDao,
  newApp,
}
