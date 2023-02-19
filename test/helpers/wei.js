const hre = require('hardhat')

function wei(strings, ...values) {
  // when wei used not like js tag but called like regular function
  // the first argument will be string instead of array of strings
  if (typeof strings === 'string') {
    throw new Error("Invalid wei tag usage. Please, use it like JS tag: wei`1 ether` instead of: wei('1 ether')")
  }

  // case when wei used without arguments
  if (strings.length === 1 && strings[0] === '' && values.length === 0) {
    throw new Error('Empty wei tag template. Please specify expression inside wei`` tag')
  }

  // combine interpolations in one expression
  let expression = strings[0]
  for (let i = 1; i < strings.length; ++i) {
    expression += values[i - 1] + strings[i]
  }

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

wei.int = (value) => BigInt(value.toString())

wei.str = (value) => value.toString()

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

module.exports = {
  wei
}
