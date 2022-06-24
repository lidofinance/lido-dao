const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')
const { newDao, newApp } = require('../0.4.24/helpers/dao')

const { assert } = require('chai')

const LidoELRewardsVault = artifacts.require('LidoExecutionLayerRewardsVault.sol')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

const LidoMock = artifacts.require('LidoMock.sol')
const LidoOracleMock = artifacts.require('OracleMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')

const ERC20OZMock = artifacts.require('ERC20OZMock.sol')
const ERC721OZMock = artifacts.require('ERC721OZMock.sol')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')
// semantic aliases
const stETH = ETH
const stETHShares = ETH

contract('LidoExecutionLayerRewardsVault', ([appManager, voting, deployer, depositor, anotherAccount, ...otherAccounts]) => {
  let oracle, lido, elRewardsVault
  let treasuryAddr
  let dao, acl, operators

  beforeEach('deploy lido with dao', async () => {
    const lidoBase = await LidoMock.new({ from: deployer })
    oracle = await LidoOracleMock.new({ from: deployer })
    const depositContract = await DepositContractMock.new({ from: deployer })
    const nodeOperatorsRegistryBase = await NodeOperatorsRegistry.new({ from: deployer })

    const daoAclObj = await newDao(appManager)
    dao = daoAclObj.dao
    acl = daoAclObj.acl

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    let proxyAddress = await newApp(dao, 'lido', lidoBase.address, appManager)
    lido = await LidoMock.at(proxyAddress)
    await lido.resumeProtocolAndStaking()

    // NodeOperatorsRegistry
    proxyAddress = await newApp(dao, 'node-operators-registry', nodeOperatorsRegistryBase.address, appManager)
    operators = await NodeOperatorsRegistry.at(proxyAddress)
    await operators.initialize(lido.address)

    // Init the BURN_ROLE role and assign in to voting
    await acl.createPermission(voting, lido.address, await lido.BURN_ROLE(), appManager, { from: appManager })

    // Initialize the app's proxy.
    await lido.initialize(depositContract.address, oracle.address, operators.address)
    treasuryAddr = await lido.getInsuranceFund()

    await oracle.setPool(lido.address)
    await depositContract.reset()

    elRewardsVault = await LidoELRewardsVault.new(lido.address, treasuryAddr, { from: deployer })
  })

  it('Addresses which are not Lido contract cannot withdraw from execution layer rewards vault', async () => {
    await assertRevert(elRewardsVault.withdrawRewards(12345, { from: anotherAccount }), 'ONLY_LIDO_CAN_WITHDRAW')
    await assertRevert(elRewardsVault.withdrawRewards(12345, { from: deployer }), 'ONLY_LIDO_CAN_WITHDRAW')
    await assertRevert(elRewardsVault.withdrawRewards(12345, { from: appManager }), 'ONLY_LIDO_CAN_WITHDRAW')
  })

  it('Execution layer rewards vault can receive Ether by plain transfers (no call data)', async () => {
    const before = +(await web3.eth.getBalance(elRewardsVault.address)).toString()
    const amount = 0.02
    await web3.eth.sendTransaction({ to: elRewardsVault.address, from: anotherAccount, value: ETH(amount) })
    assertBn(await web3.eth.getBalance(elRewardsVault.address), ETH(before + amount))
  })

  it('Execution layer rewards vault refuses to receive Ether by transfers with call data', async () => {
    const before = +(await web3.eth.getBalance(elRewardsVault.address)).toString()
    const amount = 0.02
    await assertRevert(
      web3.eth.sendTransaction({ to: elRewardsVault.address, from: anotherAccount, value: ETH(amount), data: '0x12345678' })
    )
  })

  describe('Recover ERC20 / ERC721', () => {
    let mockERC20Token, mockNFT
    let nft1, nft2
    let totalERC20Supply

    beforeEach(async () => {
      // setup ERC20 token with total supply 100,000 units
      // mint two NFTs
      // the deployer solely holds newly created ERC20 and ERC721 items on setup

      nft1 = bn(666)
      nft2 = bn(777)
      totalERC20Supply = bn(1000000)

      mockERC20Token = await ERC20OZMock.new(totalERC20Supply, { from: deployer })

      assertBn(await mockERC20Token.totalSupply(), totalERC20Supply)
      assertBn(await mockERC20Token.balanceOf(deployer), totalERC20Supply)

      await mockERC20Token.balanceOf(deployer)

      mockNFT = await ERC721OZMock.new({ from: deployer })

      await mockNFT.mintToken(nft1, { from: deployer })
      await mockNFT.mintToken(nft2, { from: deployer })

      assertBn(await mockNFT.balanceOf(deployer), bn(2))
      assert.equal(await mockNFT.ownerOf(nft1), deployer)
      assert.equal(await mockNFT.ownerOf(nft2), deployer)
    })

    it(`can't recover zero ERC20 amount`, async () => {
      assertRevert(elRewardsVault.recoverERC20(mockERC20Token.address, bn(0)), `ZERO_RECOVERY_AMOUNT`)
    })

    it(`can't recover zero-address ERC20`, async () => {
      assertRevert(elRewardsVault.recoverERC20(ZERO_ADDRESS, bn(10)))
    })

    it(`can't recover stETH by recoverERC20`, async () => {
      // initial stETH balance is zero
      assertBn(await lido.balanceOf(anotherAccount), stETH(0))
      // submit 10 ETH to mint 10 stETH
      await web3.eth.sendTransaction({ from: anotherAccount, to: lido.address, value: ETH(10) })
      // check 10 stETH minted on balance
      assertBn(await lido.balanceOf(anotherAccount), stETH(10))
      // transfer 5 stETH to the elRewardsVault account
      await lido.transfer(elRewardsVault.address, stETH(5), { from: anotherAccount })

      assertBn(await lido.balanceOf(anotherAccount), stETH(5))
      assertBn(await lido.balanceOf(elRewardsVault.address), stETH(5))
    })

    it(`recover some accidentally sent ERC20`, async () => {
      // distribute deployer's balance among anotherAccount and elRewardsVault
      await mockERC20Token.transfer(anotherAccount, bn(400000), { from: deployer })
      await mockERC20Token.transfer(elRewardsVault.address, bn(600000), { from: deployer })

      // check the resulted state
      assertBn(await mockERC20Token.balanceOf(deployer), bn(0))
      assertBn(await mockERC20Token.balanceOf(anotherAccount), bn(400000))
      assertBn(await mockERC20Token.balanceOf(elRewardsVault.address), bn(600000))

      // recover ERC20
      const firstReceipt = await elRewardsVault.recoverERC20(mockERC20Token.address, bn(100000), { from: deployer })
      assertEvent(firstReceipt, `ERC20Recovered`, {
        expectedArgs: { requestedBy: deployer, token: mockERC20Token.address, amount: bn(100000) }
      })

      const secondReceipt = await elRewardsVault.recoverERC20(mockERC20Token.address, bn(400000), { from: anotherAccount })
      assertEvent(secondReceipt, `ERC20Recovered`, {
        expectedArgs: { requestedBy: anotherAccount, token: mockERC20Token.address, amount: bn(400000) }
      })

      // check balances again
      assertBn(await mockERC20Token.balanceOf(elRewardsVault.address), bn(100000))
      assertBn(await mockERC20Token.balanceOf(treasuryAddr), bn(500000))
      assertBn(await mockERC20Token.balanceOf(deployer), bn(0))
      assertBn(await mockERC20Token.balanceOf(anotherAccount), bn(400000))

      // recover last portion
      const lastReceipt = await elRewardsVault.recoverERC20(mockERC20Token.address, bn(100000), { from: anotherAccount })
      assertEvent(lastReceipt, `ERC20Recovered`, {
        expectedArgs: { requestedBy: anotherAccount, token: mockERC20Token.address, amount: bn(100000) }
      })

      // balance is zero already, have to be reverted
      assertRevert(elRewardsVault.recoverERC20(mockERC20Token.address, bn(1), { from: deployer }), `ERC20: transfer amount exceeds balance`)
    })

    it(`can't recover zero-address ERC721(NFT)`, async () => {
      assertRevert(elRewardsVault.recoverERC721(ZERO_ADDRESS, 0))
    })

    it(`recover some accidentally sent NFTs`, async () => {
      // send nft1 to anotherAccount and nft2 to the elRewardsVault address
      await mockNFT.transferFrom(deployer, anotherAccount, nft1, { from: deployer })
      await mockNFT.transferFrom(deployer, elRewardsVault.address, nft2, { from: deployer })

      // check the new holders' rights
      assertBn(await mockNFT.balanceOf(deployer), bn(0))
      assertBn(await mockNFT.balanceOf(anotherAccount), bn(1))
      assertBn(await mockNFT.balanceOf(elRewardsVault.address), bn(1))

      // recover nft2 should work
      const receiptNfc2 = await elRewardsVault.recoverERC721(mockNFT.address, nft2, { from: anotherAccount })
      assertEvent(receiptNfc2, `ERC721Recovered`, { expectedArgs: { requestedBy: anotherAccount, token: mockNFT.address, tokenId: nft2 } })

      // but nft1 recovery should revert
      assertRevert(elRewardsVault.recoverERC721(mockNFT.address, nft1), `ERC721: transfer caller is not owner nor approved`)

      // send nft1 to elRewardsVault and recover it
      await mockNFT.transferFrom(anotherAccount, elRewardsVault.address, nft1, { from: anotherAccount })
      const receiptNft1 = await elRewardsVault.recoverERC721(mockNFT.address, nft1, { from: deployer })

      assertEvent(receiptNft1, `ERC721Recovered`, { expectedArgs: { requestedBy: deployer, token: mockNFT.address, tokenId: nft1 } })

      // check final NFT ownership state
      assertBn(await mockNFT.balanceOf(treasuryAddr), bn(2))
      assertBn(await mockNFT.ownerOf(nft1), treasuryAddr)
      assertBn(await mockNFT.ownerOf(nft2), treasuryAddr)
    })
  })
})
