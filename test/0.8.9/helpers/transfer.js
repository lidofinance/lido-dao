const { artifacts } = require('hardhat')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')

const ForceTransfer = artifacts.require('ForceTransfer.sol')

async function forceTransfer(address, amount) {
  try {
    await ForceTransfer.new(address, { value: amount })
  } catch (error) {
    // it can't find a contract after selfdestruct, so fails with exception
    assertBn(await web3.eth.getBalance(address), amount)
  }
}

module.exports = {
  forceTransfer
}
