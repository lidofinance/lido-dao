const { join } = require('path')
const { hash } = require('eth-ens-namehash')
const { ONE_DAY, ZERO_ADDRESS, MAX_UINT64, bn, getEventArgument, injectWeb3, injectArtifacts } = require('@aragon/contract-helpers-test')

const oldPath = artifacts._artifactsPath;
// FIXME OMFG
artifacts._artifactsPath = join(config.paths.root, 'node_modules/@aragon/os/build/contracts');

const Kernel = artifacts.require('Kernel')
const ACL = artifacts.require('ACL')
const EVMScriptRegistryFactory = artifacts.require('EVMScriptRegistryFactory')
const DAOFactory = artifacts.require('DAOFactory')

artifacts._artifactsPath = oldPath;


const newDao = async (rootAccount) => {
  // Deploy a DAOFactory.
  const kernelBase = await Kernel.new(true)
  const aclBase = await ACL.new()
  const registryFactory = await EVMScriptRegistryFactory.new()
  const daoFactory = await DAOFactory.new(
    kernelBase.address,
    aclBase.address,
    registryFactory.address
  )

  // Create a DAO instance.
  const daoReceipt = await daoFactory.newDAO(rootAccount)
  const dao = await Kernel.at(getEventArgument(daoReceipt, 'DeployDAO', 'dao'))

  // Grant the rootAccount address permission to install apps in the DAO.
  const acl = await ACL.at(await dao.acl())
  const APP_MANAGER_ROLE = await kernelBase.APP_MANAGER_ROLE()
  await acl.createPermission(
    rootAccount,
    dao.address,
    APP_MANAGER_ROLE,
    rootAccount,
    { from: rootAccount }
  )

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
  newDao,
  newApp,
}
