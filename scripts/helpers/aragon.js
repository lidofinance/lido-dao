const path = require('path')
const chalk = require('chalk')
const { toChecksumAddress } = require('web3-utils')

const { log } = require('./log')
const { readJSON } = require('./fs')
const { ZERO_ADDR } = require('./index')
const { assert } = require('./assert')

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

async function assertRole(
  { roleName, acl, app, appName, managerAddress, granteeAddress, onlyGrantee = false, allAclEvents = null },
  fromBlock = 4532202
) {
  appName = appName || app.constructor.contractName

  assert.isTrue(
    managerAddress !== undefined || granteeAddress !== undefined,
    'empty assert: specify either managerAddress or granteeAddress'
  )

  const permission = normalizeBytes(await app[roleName]())
  const actualManagerAddress = await acl.getPermissionManager(app.address, permission)

  if (managerAddress !== undefined) {
    const desc = `${appName}.${chalk.yellow(roleName)} perm manager`
    assert.equal(toChecksumAddress(actualManagerAddress), toChecksumAddress(managerAddress), desc)
    log.success(`${desc}: ${chalk.yellow(actualManagerAddress)}`)
  }

  if (granteeAddress !== undefined) {
    if (!Array.isArray(granteeAddress)) {
      granteeAddress = [granteeAddress]
    }

    for (const grantee of granteeAddress) {
      const desc = `${appName}.${chalk.yellow(roleName)} perm is accessible by ${chalk.yellow(grantee)}`
      assert.isTrue(await acl.hasPermission(grantee, app.address, permission), desc)
      log.success(desc)
    }

    if (onlyGrantee) {
      const checkDesc = `${appName}.${chalk.yellow(roleName)} perm is not accessible by any other entities`
      const grantees = getAllGrantees(app, permission, allAclEvents || (await getAllAclEvents(acl, fromBlock)))
      const expectedGrantees = granteeAddress.map(normalizeBytes)
      assert.sameMembers(grantees, expectedGrantees, checkDesc)
      log.success(checkDesc)
    }
  }
}

async function getAllAclEvents(acl, fromBlock = 4532202) {
  return await acl.getPastEvents('allEvents', { fromBlock })
}

async function assertMissingRole({ roleName, acl, app, appName, allAclEvents = null }, fromBlock = 4532202) {
  appName = appName || app.constructor.contractName
  const permission = normalizeBytes(await app[roleName]())

  const managerCheckDesc = `${appName}.${chalk.yellow(roleName)} has no perm manager`
  const managerAddress = await acl.getPermissionManager(app.address, permission)
  assert.equal(managerAddress, ZERO_ADDR, managerCheckDesc)
  log.success(managerCheckDesc)

  const granteesCheckDesc = `${appName}.${chalk.yellow(roleName)} has no grantees`
  const grantees = getAllGrantees(app, permission, allAclEvents || (await getAllAclEvents(acl, fromBlock)))
  assert.isEmpty(grantees, granteesCheckDesc)
  log.success(granteesCheckDesc)
}

function getAllGrantees(app, permission, allAclEvents) {
  const appAddress = normalizeBytes(app.address)

  const setPermissionEvts = allAclEvents.filter(
    (evt) => evt.event === 'SetPermission' && normalizeBytes(evt.args.app) === appAddress && normalizeBytes(evt.args.role) === permission
  )

  const finalPermissionsByEntity = {}

  setPermissionEvts.forEach((evt) => {
    const entity = normalizeBytes(evt.args.entity)
    finalPermissionsByEntity[entity] = evt.args.allowed
  })

  return Object.keys(finalPermissionsByEntity).filter((entity) => finalPermissionsByEntity[entity])
}

function normalizeBytes(s) {
  return String(s).toLowerCase()
}

module.exports = { readAppName, assertRole, assertMissingRole }
