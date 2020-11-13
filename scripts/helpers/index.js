const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

const errorOut = (message) => {
  console.error(message)
  throw new Error(message)
}

module.exports = {
  ZERO_ADDR,
  errorOut
}
