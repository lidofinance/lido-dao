import { logger } from './logger'

const fileSystem = require('fs')
const web3 = require('web3')
const appRoot = require('app-root-path')

function getRootDir() {
  return appRoot.path
}

function getLogger() {
  return logger
}

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getDataFromFile(path) {
  getLogger().debug('Parse data from ' + path)
  try {
    return fileSystem.readFileSync(path, 'utf8')
  } catch (e) {
    getLogger().error(e.stack)
  }
}

function getGeneratedWithdrawalAddress() {
  const pubKey = getDataFromFile(getRootDir() + '/data/dc4bc_participant_0.pubkey')
  return web3.utils.sha3(pubKey)
}

function getTestWithdrawalAddress() {
  const validatorsJson = require(getRootDir() + '/test-e2e/test-data/validators.json')
  return '0x' + validatorsJson[9].withdrawal_credentials
}

function getSigningKeys(signingKeysCount, offset = 0) {
  let validatorsJson = require(getRootDir() + '/test-e2e/test-data/validators.json')
  validatorsJson = validatorsJson.slice(offset, signingKeysCount)
  let pubKeys = ''
  let signatures = ''
  for (let i = 0; i < validatorsJson.length; i++) {
    pubKeys += validatorsJson[i].pubkey
    signatures += validatorsJson[i].signature
  }
  return {
    pubKey: '0x' + pubKeys,
    signature: '0x' + signatures
  }
}

const ETH = (value) => web3.utils.toWei(value + '', 'ether')

export { sleep, ETH, getRootDir, getDataFromFile, getGeneratedWithdrawalAddress, getSigningKeys, getLogger, getTestWithdrawalAddress }
