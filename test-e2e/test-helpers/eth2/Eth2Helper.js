import { DefaultJsonPattern } from './defaultJsonPattern'
import request from 'sync-request'

export function getActiveValidatorsPubKeys() {
  const response = request('GET', 'http://localhost:5052/beacon/validators/active', {
    headers: {
      accept: 'application/json'
    }
  })
  const jsonPattern = new DefaultJsonPattern(response.getBody('utf-8'))
  return jsonPattern.getValidatorsPubKeys()
}
export function isValidatorStarted(pubKey) {
  return getActiveValidatorsPubKeys().includes(pubKey)
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
