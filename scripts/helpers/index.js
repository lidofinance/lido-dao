const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

const errorOut = (message) => {
  console.error(message)
  throw new Error(message)
}

// 100% => 10,000 BP
function percentToBP(percent) {
  return Math.floor(percent * 100)
}

module.exports = {
  ZERO_ADDR,
  errorOut,
  percentToBP
}
