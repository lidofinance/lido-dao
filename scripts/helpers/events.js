const chalk = require('chalk')
const { assert } = require('chai')

const { log } = require('../helpers/log')

async function assertLastEvent(instance, eventName, instanceName = null) {
  instanceName = instanceName || instance.constructor.contractName

  const allEvents = await instance.getPastEvents('allEvents', { fromBlock: 0 })
  assert.isAbove(allEvents.length, 0, `${instanceName} generated at least one event`)

  const lastEvent = allEvents[allEvents.length - 1]
  const checkDesc = `the last event from ${instanceName} at ${instance.address} is ${chalk.yellow(eventName)}`
  assert.equal(lastEvent.event, eventName, checkDesc)
  log.success(checkDesc)

  return lastEvent
}

async function assertNoEvents(instance, instanceName = null) {
  const allEvents = await instance.getPastEvents('allEvents', { fromBlock: 0 })
  const checkDesc = `${instanceName || instance.constructor.contractName} has generated no events`
  assert.equal(allEvents.length, 0, checkDesc)
  log.success(checkDesc)
}

module.exports = { assertLastEvent, assertNoEvents }
