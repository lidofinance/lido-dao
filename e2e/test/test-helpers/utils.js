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
  return new Promise((resolve) => setTimeout(resolve, ms * 1000))
}

function getDataFromFile(path) {
  getLogger().debug('Parse data from ' + path)
  try {
    return fileSystem.readFileSync(path, 'utf8')
  } catch (e) {
    getLogger().error(e.stack)
  }
}
function loadGeneratedValidatorsData(index = 0) {
  // const dir = getRootDir() + '/data/validator_keys'
  const dir = getRootDir() + '/data/validator_keys'
  const depositDataFiles = fileSystem.readdirSync(dir).filter((file) => {
    return file.indexOf('.') !== 0 && file.match(/deposit_data.+\.json$/i)
  })
  if (!depositDataFiles.length) {
    throw new Error('No deposit_data files found')
  }
  return require(`${dir}/${depositDataFiles[index]}`)
}

function getGeneratedWithdrawalAddress() {
  // const validatorsJson = loadGeneratedValidatorsData()
  const validatorsJson = require(getRootDir() + '/test-e2e/test-data/validators.json')
  return '0x' + validatorsJson[0].withdrawal_credentials
}

function getDataToPerformDepositContract() {
  const validatorsJson = require(getRootDir() + '/test-e2e/test-data/validators.json')
  return {
    pubkey: '0x' + validatorsJson[validatorsJson.length - 1].pubkey,
    withdrawal_credentials: '0x' + validatorsJson[validatorsJson.length - 1].withdrawal_credentials,
    signature: '0x' + validatorsJson[validatorsJson.length - 1].signature,
    deposit_data_root: '0x' + validatorsJson[validatorsJson.length - 1].deposit_data_root
  }
}
function getSigningKeys(signingKeysCount, offset = 0) {
  // let validatorsJson = loadGeneratedValidatorsData()
  let validatorsJson = require(getRootDir() + '/test-e2e/test-data/validators.json')
  validatorsJson = validatorsJson.slice(offset, signingKeysCount + offset)
  const pubKeys = []
  const signatures = []
  for (let i = 0; i < validatorsJson.length; i++) {
    pubKeys.push(validatorsJson[i].pubkey)
    signatures.push(validatorsJson[i].signature)
  }
  return {
    pubKeys,
    signatures
  }
}

function concatKeys(keys) {
  return '0x' + keys.toString().split(',').join('')
}

function concat0x(array) {
  let { pubKeys, signatures } = array
  pubKeys = pubKeys.map((key) => `0x${key}`)
  signatures = signatures.map((signature) => `0x${signature}`)
  return {
    pubKeys,
    signatures
  }
}
const ETH = (value) => web3.utils.toWei(value + '', 'ether')

export {
  sleep,
  ETH,
  getRootDir,
  getDataFromFile,
  getGeneratedWithdrawalAddress,
  getSigningKeys,
  getLogger,
  getDataToPerformDepositContract,
  concatKeys,
  concat0x
}
