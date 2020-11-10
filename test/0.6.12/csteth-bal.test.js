const { BN, constants } = require('@openzeppelin/test-helpers')
const { newDao, newApp } = require('../0.4.24/helpers/dao')
const { expect } = require('chai')

const CstETH = artifacts.require('CstETHMock')
const LidoMock = artifacts.require('LidoMock')
const StETH = artifacts.require('StETH')

contract('CstETH', function ([deployer, initialHolder, recipient, anotherAccount, ...otherAccounts]) {
  let csteth, steth, lido

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    const stEthBase = await StETH.new({ from: deployer })
    const lidoBase = await LidoMock.new({ from: deployer })

    const { dao, acl } = await newDao(deployer)

    const stEthProxyAddress = await newApp(dao, 'steth', stEthBase.address, deployer)
    steth = await StETH.at(stEthProxyAddress)

    // Set up the permissions for token management
    // await acl.createPermission(deployer, steth.address, await steth.PAUSE_ROLE(), deployer, { from: deployer })
    await acl.createPermission(deployer, steth.address, await steth.MINT_ROLE(), deployer, { from: deployer })
    await acl.createPermission(deployer, steth.address, await steth.BURN_ROLE(), deployer, { from: deployer })
    const lidoProxyAddress = await newApp(dao, 'lido', lidoBase.address, deployer)
    lido = await LidoMock.at(lidoProxyAddress)
    // Initialize the app's proxy.
    await steth.initialize(lido.address, { from: deployer })
    await lido.initialize(steth.address, { from: deployer })
    csteth = await CstETH.new(stEthProxyAddress, { from: deployer })
  })

  describe('stETH wrapper', function () {
    const [user1, treasury] = otherAccounts

    before(async function () {
      // deposit
      await steth.mint(user1, new BN(10000000), { from: deployer })

      // 1st pushdata +1eth, fee=10%
      await steth.mint(treasury, new BN(1000000), { from: deployer })
      await lido.setTotalControlledEther(new BN(20000000), { from: deployer })
      await steth.approve(csteth.address, 10000000, { from: user1 })
    })

    it('balance', async function () {
      // 18181818'
      expect(await steth.balanceOf(user1)).to.be.bignumber.equal('19000000')
      expect(await steth.allowance(user1, csteth.address)).to.be.bignumber.equal('10000000')
    })
    it('wrap/unwrap', async function () {
      await csteth.wrap(10000000, { from: user1 })
      expect(await steth.balanceOf(user1)).to.be.bignumber.equal('9000000')
      expect(await csteth.balanceOf(user1)).to.be.bignumber.equal('5500000')

      await csteth.unwrap(5500000, { from: user1 })
      expect(await steth.balanceOf(user1)).to.be.bignumber.equal('19000000')
      expect(await csteth.balanceOf(user1)).to.be.bignumber.equal('0')
    })
  })
})
