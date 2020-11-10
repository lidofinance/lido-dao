const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

const _getRegistered = async (ens, hash) => {
  const owner = await ens.owner(hash)
  return owner !== ZERO_ADDR && owner !== '0x' ? owner : false
}

const errorOut = (message) => {
  console.error(message)
  throw new Error(message)
}

module.exports = {
  ZERO_ADDR,
  _getRegistered,
  errorOut
}
