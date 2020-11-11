const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')

const { deployDaoAndPool } = require('../test/scenario/helpers/deploy')

const Lido = artifacts.require('TestLido.sol')

async function main() {
  const addresses = await web3.eth.getAccounts()
  const [appManager, voting, stakingProvider] = addresses

  const deployed = await deployDaoAndPool(appManager, voting, 100)
  const { pool, spRegistry } = deployed

  await printTx(`pool.setFee`, pool.setFee(0.01 * 10000, { from: voting }))
}

async function printTx(name, promise) {
  const result = await promise
  console.log(`${name} tx hash:`, result.tx)
  return result
}

main()
  .catch((e) => console.error(e.stack))
  .then(() => process.exit(0))
