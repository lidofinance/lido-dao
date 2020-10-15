const logger = require('./logger')
const fs = require('fs')
const path = require('path')
const { toWei, isHex, toBN } = require('web3-utils')

const validatorKeysPath = path.resolve(__dirname, '../../data/validator_keys')

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms * 1000))
}

function getDataFromFile(path) {
  logger.debug('Parse data from ' + path)
  try {
    return fs.readFileSync(path, 'utf8')
  } catch (e) {
    logger.error(e.stack)
  }
}

function loadGeneratedValidatorsData(dir = validatorKeysPath, index = 0) {
  const depositDataFiles = fs.readdirSync(dir).filter((file) => {
    return file.indexOf('.') !== 0 && file.match(/deposit_data.+\.json$/i)
  })
  if (!depositDataFiles.length) {
    throw new Error('No deposit_data files found')
  }
  return require(`${dir}/${depositDataFiles[index]}`)
}

function getGeneratedWithdrawalAddress() {
  const validatorsJson = loadGeneratedValidatorsData()
  return '0x' + validatorsJson[0].withdrawal_credentials
}

function getDataToPerformDepositContract() {
  const validatorsJson = loadGeneratedValidatorsData()
  const validator = validatorsJson[validatorsJson.length - 1]
  return {
    pubkey: '0x' + validator.pubkey,
    withdrawal_credentials: '0x' + validator.withdrawal_credentials,
    signature: '0x' + validator.signature,
    deposit_data_root: '0x' + validator.deposit_data_root
  }
}

function getSigningKeys(signingKeysCount, offset = 0) {
  const validatorsJson = loadGeneratedValidatorsData().slice(offset, signingKeysCount + offset)
  return {
    pubKeys: validatorsJson.map((v) => v.pubkey),
    signatures: validatorsJson.map((v) => v.signature)
  }
}

function concatKeys(keys) {
  return '0x' + keys.toString().split(',').join('')
}

function concat0x(array) {
  const { pubKeys, signatures } = array
  return {
    pubKeys: pubKeys.map((key) => `0x${key}`),
    signatures: signatures.map((signature) => `0x${signature}`)
  }
}

function objHexlify(obj) {
  Object.keys(obj).forEach((k) => {
    if (isHex(obj[k])) {
      obj[k] = `0x${obj[k]}`
    }
  })
  return obj
}

const ETH = (value) => toWei(value + '', 'ether')
const BN = (value) => toBN(value)

module.exports = {
  sleep,
  ETH,
  BN,
  loadGeneratedValidatorsData,
  getDataFromFile,
  getGeneratedWithdrawalAddress,
  getSigningKeys,
  logger,
  getDataToPerformDepositContract,
  concatKeys,
  concat0x,
  objHexlify
}
