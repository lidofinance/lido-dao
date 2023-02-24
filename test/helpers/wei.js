const hre = require('hardhat')

function wei(...args) {
  return parseWeiExpression(weiExpressionTag(...args))
}

wei.int = (...args) => {
  if (args.length === 0) {
    throw new Error('No arguments provided to wei.int() call')
  }

  // when str is used as JS tag it first argument will be array of strings
  if (Array.isArray(args[0]) && args[0].every((e) => typeof e === 'string')) {
    return wei(...args)
  }

  // when first argument is string, consider it as wei expression
  if (typeof args[0] === 'string') {
    return wei(...args)
  }

  // in all other cases just cast first item to string and convert it to BigInt
  return BigInt(args[0].toString())
}

wei.str = (...args) => {
  if (args.length === 0) {
    throw new Error('No arguments provided to wei.str() call')
  }

  // when str is used as JS tag it first argument will be array of strings
  if (Array.isArray(args[0]) && args[0].every((e) => typeof e === 'string')) {
    return wei(...args).toString()
  }

  // when first argument is string, consider it as wei expression
  if (typeof args[0] === 'string') {
    return wei(...args).toString()
  }

  // in all other cases just cast first item to string
  return args[0].toString()
}

wei.min = (...values) => {
  if (values.length === 0) {
    throw new Error(`No arguments provided to wei.min() call`)
  }
  return values.reduce((min, value) => (wei.int(value) < min ? wei.int(value) : min), wei.int(values[0]))
}

wei.max = (...values) => {
  if (values.length === 0) {
    throw new Error(`No arguments provided to wei.min() call`)
  }
  return values.reduce((max, value) => (wei.int(value) > max ? wei.int(value) : max), wei.int(values[0]))
}

function weiExpressionTag(strings, ...values) {
  if (!Array.isArray(strings) && typeof strings !== 'string') {
    throw new Error(`wei was used with invalid arg type. Make sure that was passed valid JS template string`)
  }
  // when wei used not like js tag but called like regular function
  // the first argument will be string instead of array of strings
  if (typeof strings === 'string') {
    strings = [strings]
  }

  // case when wei used without arguments
  if (strings.length === 1 && strings[0] === '' && values.length === 0) {
    throw new Error('Empty wei tag template. Please specify expression inside wei`` tag')
  }

  // combine interpolations in one expression
  let expression = strings[0]
  for (let i = 1; i < strings.length; ++i) {
    expression += values[i - 1].toString() + strings[i]
  }
  return expression
}

function parseWeiExpression(expression) {
  const [amount, unit = 'wei'] = expression
    .replaceAll('_', '') // remove all _ from numbers written like '100_00'
    .trim() // remove all leading and trealing spaces
    .split(' ') // split amount and unit parts
    .filter((v) => !!v) // remove all empty strings if value had redundant spaces between amount and unit parts

  if (!Number.isFinite(+amount)) {
    throw new Error(`Amount ${amount} is not a number`)
  }

  return BigInt(hre.web3.utils.toWei(amount, unit.toLowerCase()))
}

module.exports = {
  wei,
}
