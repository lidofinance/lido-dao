const Foo = artifacts.require('Foo.sol')
const Bar = artifacts.require('Bar.sol')
const Baz = artifacts.require('Baz.sol')

contract('Gas Profile Test', ([appManager]) => {
  it('Deploy and run test tx', async () => {
    const baz = await Baz.new()
    const bar = await Bar.new(baz.address)
    const foo = await Foo.new(bar.address)

    console.log('Foo address:', foo.address)
    console.log('Bar address:', bar.address)
    console.log('Baz address:', baz.address)

    const result = await foo.foo(3, { from: appManager })
    console.log('TX hash:', result.tx)
  })
})
