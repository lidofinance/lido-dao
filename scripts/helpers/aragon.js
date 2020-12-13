const path = require('path')
const chalk = require('chalk')
const { assert } = require('chai')
const { toChecksumAddress } = require('web3-utils')

const { log } = require('./log')
const { readJSON } = require('./fs')
const { ZERO_ADDR } = require('./index')

async function readAppName(appRoot, netName) {
  const { environments } = await readJSON(path.join(appRoot, 'arapp.json'))
  if (!environments) {
    return null
  }
  if (environments[netName]) {
    // NOTE: assuming that Aragon environment is named after the network
    return environments[netName].appName
  }
  return (environments.default || {}).appName || null
}

async function assertRole({ roleName, acl, app, appName, managerAddress, granteeAddress }) {
  appName = appName || app.constructor.contractName

  assert.isTrue(
    managerAddress !== undefined || granteeAddress !== undefined,
    'empty assert: specify either managerAddress or granteeAddress'
  )

  const permission = await app[roleName]()
  const actualManagerAddress = await acl.getPermissionManager(app.address, permission)

  if (managerAddress !== undefined) {
    const desc = `${appName}.${chalk.yellow(roleName)} perm manager`
    assert.equal(toChecksumAddress(actualManagerAddress), toChecksumAddress(managerAddress), desc)
    log.success(`${desc}: ${chalk.yellow(actualManagerAddress)}`)
  }

  if (granteeAddress !== undefined) {
    const desc = `${appName}.${chalk.yellow(roleName)} perm is accessible by ${chalk.yellow(granteeAddress)}`
    assert.isTrue(await acl.hasPermission(granteeAddress, app.address, permission), desc)
    log.success(desc)
  }
}

async function assertMissingRole({ roleName, acl, app, appName }) {
  appName = appName || app.constructor.contractName

  const permission = await app[roleName]()
  const managerAddress = await acl.getPermissionManager(app.address, permission)
  const desc = `${appName}.${chalk.yellow(roleName)} has no perm manager`

  assert.equal(managerAddress, ZERO_ADDR, desc)
  log.success(desc)
}

module.exports = { readAppName, assertRole, assertMissingRole }
