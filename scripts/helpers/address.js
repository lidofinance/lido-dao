function isZeroAddress(addr) {
  return !addr || addr === '0x0000000000000000000000000000000000000000' || addr === '0x' || addr === '0x0'
}

module.exports = { isZeroAddress }
