const chalk = require('chalk')
const { assert } = require('chai')

const { log, yl } = require('../helpers/log')

async function assertLastEvent(instance, eventName, instanceName = null, fromBlock = 4532202) {
  instanceName = instanceName || instance.constructor.contractName

  const allEvents = await instance.getPastEvents('allEvents', { fromBlock })
  assert.isAbove(allEvents.length, 0, `${instanceName} generated at least one event`)

  const lastEvent = allEvents[allEvents.length - 1]
  const checkDesc = `the last event from ${instanceName} at ${instance.address} is ${yl(eventName)}`
  assert.equal(lastEvent.event, eventName, checkDesc)
  log.success(checkDesc)

  return lastEvent
}

async function assertSingleEvent(instance, eventName, instanceName = null, fromBlock = 4532202) {
  instanceName = instanceName || instance.constructor.contractName

  const checkDesc = `${instanceName} at ${instance.address} generated exactly one ${yl(eventName)} event`
  const allEvents = await instance.getPastEvents(eventName, { fromBlock })
  assert.lengthOf(allEvents, 1, checkDesc)
  log.success(checkDesc)

  return allEvents[0]
}

async function assertNoEvents(instance, instanceName = null, fromBlock = 4532202) {
  const allEvents = await instance.getPastEvents('allEvents', { fromBlock })
  const checkDesc = `${instanceName || instance.constructor.contractName} has generated no events`
  assert.equal(allEvents.length, 0, checkDesc)
  log.success(checkDesc)
}

module.exports = { assertLastEvent, assertSingleEvent, assertNoEvents }
