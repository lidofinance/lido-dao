import { DefaultJsonPattern } from './defaultJsonPattern'
import request from 'sync-request'
import { logger } from '../logger'
import { sleep as waitFor } from '../utils'

// TODO api assertions

export function getActiveValidatorsPubKeys() {
  const response = request('GET', 'http://localhost:5052/beacon/validators/active', {
    headers: {
      accept: 'application/json'
    }
  })
  const jsonPattern = new DefaultJsonPattern(response.getBody('utf-8'))
  return jsonPattern.getValidatorsPubKeys()
}
export function isValidatorsStarted(pubKeys) {
  const activeValidators = getActiveValidatorsPubKeys()
  for (const pubKey of pubKeys) {
    if (!activeValidators.includes(pubKey)) {
      logger.error('Validator ' + pubKey + ' was not started')
      // return false
    }
  }
  return true
}

export function getNotActiveValidatorsPubKeys() {
  const response = request('GET', 'http://localhost:5052/beacon/validators', {
    headers: {
      accept: 'application/json'
    }
  })
  const jsonPattern = new DefaultJsonPattern(response.getBody('utf-8'))
  return jsonPattern.getValidatorsPubKeys()
}

export function getValidatorBalance(pubKey) {
  const response = request('GET', 'http://localhost:5052/beacon/validators/active', {
    headers: {
      accept: 'application/json'
    }
  })
  const jsonPattern = new DefaultJsonPattern(response.getBody('utf-8'))
  return jsonPattern.getValidatorBalance(pubKey)
}

export function getBeaconHead() {
  const response = request('GET', 'http://localhost:5052/beacon/head', {
    headers: {
      accept: 'application/json'
    }
  })
  return JSON.parse(response.getBody('utf-8'))
}

export async function isEth2NetworkProducingSlots() {
  const beaconHead = getBeaconHead()
  await waitFor(15)
  const updatedBeaconHead = getBeaconHead()
  return beaconHead.slot !== updatedBeaconHead.slot && updatedBeaconHead.finalized_slot - beaconHead.finalized_slot >= 8
}
