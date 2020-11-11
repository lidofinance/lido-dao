const Foo = artifacts.require('Foo.sol')
const Bar = artifacts.require('Bar.sol')

async function main() {
  const addresses = await web3.eth.getAccounts()

  const bar = await Bar.new({ gas: 10000000 })
  const foo = await Foo.new(bar.address, { gas: 10000000 })

  console.log()
  console.log('Foo address:', foo.address)
  console.log('Bar address:', bar.address)
  console.log()

  console.log('Foo deploy tx:', foo.transactionHash)
  console.log('Bar deploy tx:', bar.transactionHash)
  console.log()

  await printTx(`foo.foo`, foo.foo(3, { from: addresses[0] }))
}

async function printTx(name, promise) {
  const result = await promise
  console.log(`${name} tx:`, result.tx)
  return result
}

main()
  .catch((e) => console.error(e.stack))
  .then(() => process.exit(0))
