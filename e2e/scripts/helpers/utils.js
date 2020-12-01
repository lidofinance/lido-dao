import logger from './logger'
import fs from 'fs'
import path from 'path'
import { toWei, isHex, toBN, fromWei } from 'web3-utils'

export const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms * 1000))
}

export function getDataFromFile(path) {
  logger.debug('Parse data from ' + path)
  try {
    return fs.readFileSync(path, 'utf8')
  } catch (e) {
    logger.error(e.stack)
  }
}

export function loadGeneratedValidatorsData(validator, index = 0) {
  const validatorKeysPath = path.resolve(__dirname, '../../data/validators/' + validator + '/validator_keys')
  const depositDataFiles = fs.readdirSync(validatorKeysPath).filter((file) => {
    return file.indexOf('.') !== 0 && file.match(/deposit_data.+\.json$/i)
  })
  if (!depositDataFiles.length) {
    throw new Error('No deposit_data files found')
  }
  return require(`${validatorKeysPath}/${depositDataFiles[index]}`)
}

export function getGeneratedWithdrawalAddress(validators) {
  const validatorsJson = loadGeneratedValidatorsData(validators)
  return '0x' + validatorsJson[0].withdrawal_credentials
}

export function getDataToPerformDepositContract(validators) {
  const validatorsJson = loadGeneratedValidatorsData(validators)
  const validator = validatorsJson[validatorsJson.length - 1]
  return {
    pubkey: '0x' + validator.pubkey,
    withdrawal_credentials: '0x' + validator.withdrawal_credentials,
    signature: '0x' + validator.signature,
    deposit_data_root: '0x' + validator.deposit_data_root
  }
}

export function getSigningKeys(validator, signingKeysCount, offset = 0) {
  const validatorsJson = loadGeneratedValidatorsData(validator).slice(offset, signingKeysCount + offset)
  return {
    pubKeys: validatorsJson.map((v) => v.pubkey),
    signatures: validatorsJson.map((v) => v.signature)
  }
}

export function concatKeys(keys) {
  return '0x' + keys.toString().split(',').join('')
}

export function concat0x(array) {
  const { pubKeys, signatures } = array
  return {
    pubKeys: pubKeys.map((key) => `0x${key}`),
    signatures: signatures.map((signature) => `0x${signature}`)
  }
}

export function objHexlify(obj) {
  Object.keys(obj).forEach((k) => {
    if (isHex(obj[k])) {
      obj[k] = `0x${obj[k]}`
    }
  })
  return obj
}

export function compareBN(number1, number2) {
  logger.debug(`Comparing : ${number1} and  ${number2}`)
  return BN(+number1).eq(BN(+number2))
}

export const BN = (value) => toBN(value)
export const ETH = (value) => toWei(value + '', 'ether')
export const toETH = (value) => fromWei(value + '', 'ether')
