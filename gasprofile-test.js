const Bar = artifacts.require('Bar.sol')
const Foo = artifacts.require('Foo.sol')

contract('Gas Profile Test', ([appManager]) => {
  it('Deploy and run test tx', async () => {
    const bar = await Bar.new()
    const foo = await Foo.new(bar.address)
    
    console.log('bar address', bar.address)
    console.log('foo address', foo.address)

    const spTx = await foo.foo(2, { from: appManager })
    console.log(spTx)
  })
})