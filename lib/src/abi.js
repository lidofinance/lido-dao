const truffleContract = require('@truffle/contract')

const abiByName = {}
const contractByName = {}

function getContract(name) {
  if (contractByName[name]) {
    return contractByName[name]
  }
  const abi = getABI(name)
  const contract = truffleContract({ abi })
  return (contractByName[name] = contract)
}

function getABI(name) {
  return abiByName[name] || (abiByName[name] = require(`../abi/${name}.json`))
}

module.exports = { getABI, getContract }
