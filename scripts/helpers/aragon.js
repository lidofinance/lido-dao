const path = require('path')
const chalk = require('chalk')
const { assert } = require('chai')
const { toChecksumAddress } = require('web3-utils')

const { log } = require('./log')
const { readJSON } = require('./fs')

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
  appName = appName || app.constructor

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

module.exports = { readAppName, assertRole }
