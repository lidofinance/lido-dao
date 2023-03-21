const hre = require('hardhat')

const ETHER_UNITS = [
  'wei',
  'kwei',
  'mwei',
  'gwei',
  'nano',
  'nanoether',
  'micro',
  'microether',
  'milli',
  'milliether',
  'ether',
  'kether',
  'grand',
  'mether',
  'gether',
  'tether',
]

const weiToString = (templateOrStringifiable, ...values) => processWeiTagInput(templateOrStringifiable, values)

const weiToBigInt = (templateOrStringifiable, ...values) => BigInt(processWeiTagInput(templateOrStringifiable, values))

const wei = Object.assign(weiToBigInt, {
  int: weiToBigInt,
  str: weiToString,
  min: (...values) => {
    if (values.length === 0) {
      throw new Error(`No arguments provided to wei.min() call`)
    }
    return values.reduce((min, value) => (wei.int(value) < min ? wei.int(value) : min), wei.int(values[0]))
  },
  max: (...values) => {
    if (values.length === 0) {
      throw new Error(`No arguments provided to wei.min() call`)
    }
    return values.reduce((max, value) => (wei.int(value) > max ? wei.int(value) : max), wei.int(values[0]))
  },
})

function processWeiTagInput(templateOrStringifiable, values) {
  return parseWeiExpression(
    isTemplateStringArray(templateOrStringifiable)
      ? templateToString(templateOrStringifiable, values)
      : stringifiableToString(templateOrStringifiable)
  )
}

function parseWeiExpression(expression) {
  const [amount, unit = 'wei'] = expression
    .replaceAll('_', '') // remove all _ from numbers written like '100_00'
    .trim() // remove all leading and trailing spaces
    .split(' ') // split amount and unit parts
    .filter((v) => !!v) // remove all empty strings if value had redundant spaces between amount and unit parts
    .map((v) => v.toLowerCase()) // needed for units

  if (!Number.isFinite(+amount)) {
    throw new Error(`Wei Parse Error: Amount "${amount}" is not a valid number`)
  }

  if (!isValidEtherUnit(unit)) {
    throw new Error(`Wei Parse Error: unsupported unit value: ${unit}`)
  }

  return hre.web3.utils.toWei(amount, unit)
}

function isValidEtherUnit(maybeUnit) {
  return ETHER_UNITS.some((unit) => unit === maybeUnit)
}

function templateToString(template, args) {
  let expression = template[0]
  for (let i = 1; i < template.length; ++i) {
    expression += args[i - 1].toString() + template[i]
  }
  return expression
}

function stringifiableToString(stringifiable) {
  return stringifiable.toString()
}

function isTemplateStringArray(maybeTemplate) {
  return !!maybeTemplate.raw && Array.isArray(maybeTemplate) && maybeTemplate.every((elem) => typeof elem === 'string')
}

module.exports = { wei }
