const Web3 = require('web3')

const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

async function getSenderAddr(truffleInstance, opts) {
  if (opts && opts.from) {
    return opts.from
  }
  const web3 = new Web3(truffleInstance.contract.currentProvider)
  const accounts = await web3.eth.getAccounts()
  return accounts[0]
}

function addressEqual(addr1, addr2) {
  return addr1.toLowerCase() === addr2.toLowerCase()
}

function trim0x(str) {
  return str[0] === '0' && str[1] === 'x' ? str.slice(2) : str
}

module.exports = { ZERO_ADDR, getSenderAddr, addressEqual, trim0x }
