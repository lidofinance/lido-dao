const Foo = artifacts.require('Foo.sol')
const Bar = artifacts.require('Bar.sol')
const Baz = artifacts.require('Baz.sol')

async function main() {
  const addresses = await web3.eth.getAccounts()

  const baz = await Baz.new()
  const bar = await Bar.new(baz.address)
  const foo = await Foo.new(bar.address)

  console.log()
  console.log('Foo address:', foo.address)
  console.log('Bar address:', bar.address)
  console.log('Baz address:', baz.address)
  console.log()

  console.log('Foo deploy tx:', foo.transactionHash)

  await printTx(
    `foo.foo`,
    foo.foo(3, { from: addresses[0] })
  )
}

async function printTx(name, promise) {
  const result = await promise
  console.log(`${name} tx:`, result.tx)
  return result
}

main()
  .catch(e => console.error(e.stack))
  .then(() => process.exit(0))
