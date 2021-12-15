const { assertBn, assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')
const { newDao, newApp } = require('../0.4.24/helpers/dao')

const { BN } = require('bn.js')

const { assert } = require('chai')

const SelfOwnerStETHBurner = artifacts.require('SelfOwnedStETHBurner.sol')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

const LidoMock = artifacts.require('LidoMock.sol')
const LidoOracleMock = artifacts.require('OracleMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')

const ERC20OZMock = artifacts.require('ERC20OZMock.sol')
const ERC721OZMock = artifacts.require('ERC721OZMock.sol')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')
const stETH = ETH

contract.only('SelfOwnedStETHBurner', function ([appManager, voting, deployer, depositor, anotherAccount, ...otherAccounts]) {
  let oracle, lido, burner
  let treasuryAddr

  before('deploy lido with dao', async () => {
    const lidoBase = await LidoMock.new({ from: deployer })
    oracle = await LidoOracleMock.new({ from: deployer })
    const depositContract = await DepositContractMock.new({ from: deployer })
    const nodeOperatorsRegistryBase = await NodeOperatorsRegistry.new({ from: deployer })

    ;({ dao, acl } = await newDao(appManager))

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    let proxyAddress = await newApp(dao, 'lido', lidoBase.address, appManager)
    lido = await LidoMock.at(proxyAddress)

    // NodeOperatorsRegistry
    proxyAddress = await newApp(dao, 'node-operators-registry', nodeOperatorsRegistryBase.address, appManager)
    operators = await NodeOperatorsRegistry.at(proxyAddress)
    await operators.initialize(lido.address)

    // Set up the app's permissions.
    await acl.createPermission(voting, lido.address, await lido.PAUSE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, lido.address, await lido.MANAGE_FEE(), appManager, { from: appManager })
    await acl.createPermission(voting, lido.address, await lido.MANAGE_WITHDRAWAL_KEY(), appManager, { from: appManager })
    await acl.createPermission(voting, lido.address, await lido.BURN_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, lido.address, await lido.SET_TREASURY(), appManager, { from: appManager })
    await acl.createPermission(voting, lido.address, await lido.SET_ORACLE(), appManager, { from: appManager })
    await acl.createPermission(voting, lido.address, await lido.SET_INSURANCE_FUND(), appManager, { from: appManager })

    await acl.createPermission(voting, operators.address, await operators.MANAGE_SIGNING_KEYS(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.ADD_NODE_OPERATOR_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_ACTIVE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_NAME_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_ADDRESS_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_LIMIT_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.REPORT_STOPPED_VALIDATORS_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(depositor, lido.address, await lido.DEPOSIT_ROLE(), appManager, { from: appManager })

    // Initialize the app's proxy.
    await lido.initialize(depositContract.address, oracle.address, operators.address)
    treasuryAddr = await lido.getInsuranceFund()

    await oracle.setPool(lido.address)
    await depositContract.reset()
  })

  beforeEach('deploy dao and set acl', async () => {
    burner = await SelfOwnerStETHBurner.new(treasuryAddr, lido.address, { from: deployer })
  })

  describe('Requests and burn invocation', function () {
    it(`request shares burn for cover`, async function () {
      assert.fail('Not implemented yet')
    })

    it(`request shares burn for non-cover`, async function () {
      assert.fail('Not implemented yet')
    })

    it(`invoke an oracle without requested burn + measure gas`, async function () {
      assert.fail('Not implemented yet')
    })

    it(`invoke an oracle with requested cover OR non-cover burn + measure gas`, async function () {
      assert.fail('Not implemented yet')
    })

    it(`invoke an oracle with requested cover AND non-cover burn + measure gas`, async function () {
      assert.fail('Not implemented yet')
    })

    it(`check burnt counters`, async function () {
      assert.fail('Not implemented yet')
    })
  })

  describe('Recover excess stETH', function () {
    it(`can't recover requested for burn stETH`, async function () {
      assert.fail('Not implemented yet')
    })

    it(`recover some stETH`, async function () {
      assert.fail('Not implemented yet')
    })
  })

  describe('Recover ERC20 / ERC721', function () {
    let mockERC20Token, mockNFT
    let nft1, nft2
    let totalERC20Supply

    beforeEach(async function () {
      // setup ERC20 token with total supply 100,000 units
      // mint two NFTs
      // the deployer solely holds newly created ERC20 and ERC721 items on setup

      nft1 = new BN('666')
      nft2 = new BN('777')
      totalERC20Supply = new BN('1000000')

      mockERC20Token = await ERC20OZMock.new(totalERC20Supply, { from: deployer })

      assertBn(await mockERC20Token.totalSupply(), totalERC20Supply)
      assertBn(await mockERC20Token.balanceOf(deployer), totalERC20Supply)

      await mockERC20Token.balanceOf(deployer)

      mockNFT = await ERC721OZMock.new({ from: deployer })

      await mockNFT.mintToken(nft1, { from: deployer })
      await mockNFT.mintToken(nft2, { from: deployer })

      assertBn(await mockNFT.balanceOf(deployer), new BN('2'))
      assert.equal(await mockNFT.ownerOf(nft1), deployer)
      assert.equal(await mockNFT.ownerOf(nft2), deployer)
    })

    it(`can't recover zero ERC20 amount`, async function () {
      assertRevert(burner.recoverERC20(mockERC20Token.address, new BN('0')), `ZERO_RECOVERY_AMOUNT`)
    })

    it(`can't recover zero-address ERC20`, async function () {
      assertRevert(burner.recoverERC20(ZERO_ADDRESS, new BN('10')), `ZERO_ERC20_ADDRESS`)
    })

    it(`can't recover stETH by recoverERC20`, async function () {
      // initial stETH balance is zero
      assertBn(await lido.balanceOf(anotherAccount), stETH(0))
      // submit 10 ETH to mint 10 stETH
      await web3.eth.sendTransaction({ from: anotherAccount, to: lido.address, value: ETH(10) })
      // check 10 stETH minted on balance
      assertBn(await lido.balanceOf(anotherAccount), stETH(10))
      // transfer 5 stETH to the burner account
      await lido.transfer(burner.address, stETH(5), { from: anotherAccount })

      assertBn(await lido.balanceOf(anotherAccount), stETH(5))
      assertBn(await lido.balanceOf(burner.address), stETH(5))

      // revert from anotherAccount
      // need to use recoverExcessStETH
      assertRevert(burner.recoverERC20(lido.address, stETH(1), { from: anotherAccount }), `STETH_RECOVER_WRONG_FUNC`)

      // revert from deployer
      // same reason
      assertRevert(burner.recoverERC20(lido.address, stETH(1), { from: deployer }), `STETH_RECOVER_WRONG_FUNC`)
    })

    it(`recover some ERC20 amount`, async function () {
      // distribute deployer's balance among anotherAccount and burner
      await mockERC20Token.transfer(anotherAccount, new BN('400000'), { from: deployer })
      await mockERC20Token.transfer(burner.address, new BN('600000'), { from: deployer })

      // check the resulted state
      assertBn(await mockERC20Token.balanceOf(deployer), new BN('0'))
      assertBn(await mockERC20Token.balanceOf(anotherAccount), new BN('400000'))
      assertBn(await mockERC20Token.balanceOf(burner.address), new BN('600000'))

      // recover ERC20
      await burner.recoverERC20(mockERC20Token.address, new BN('100000'), { from: deployer })
      await burner.recoverERC20(mockERC20Token.address, new BN('400000'), { from: anotherAccount })

      // check balances again
      assertBn(await mockERC20Token.balanceOf(burner.address), new BN('100000'))
      assertBn(await mockERC20Token.balanceOf(treasuryAddr), new BN('500000'))
      assertBn(await mockERC20Token.balanceOf(deployer), new BN('0'))
      assertBn(await mockERC20Token.balanceOf(anotherAccount), new BN('400000'))

      // recover last portion
      await burner.recoverERC20(mockERC20Token.address, new BN('100000'), { from: anotherAccount })

      // balance is zero already, have to be reverted
      assertRevert(burner.recoverERC20(mockERC20Token.address, new BN('1'), { from: deployer }), `ERC20: transfer amount exceeds balance`)
    })

    it(`can't recover zero-address ERC721(NFT)`, async function () {
      assertRevert(burner.recoverERC721(ZERO_ADDRESS, 0), `ZERO_ERC721_ADDRESS`)
    })

    it(`recover some NFTs`, async function () {
      // send nft1 to anotherAccount and nft2 to the burner address
      await mockNFT.transferFrom(deployer, anotherAccount, nft1, { from: deployer })
      await mockNFT.transferFrom(deployer, burner.address, nft2, { from: deployer })

      // check the new holders' rights
      assertBn(await mockNFT.balanceOf(deployer), new BN('0'))
      assertBn(await mockNFT.balanceOf(anotherAccount), new BN('1'))
      assertBn(await mockNFT.balanceOf(burner.address), new BN('1'))

      // recover nft2 should work
      await burner.recoverERC721(mockNFT.address, nft2, { from: anotherAccount })

      // but nft1 recovery should revert
      assertRevert(burner.recoverERC721(mockNFT.address, nft1), `ERC721: transfer caller is not owner nor approved`)

      // send nft1 to burner and recover it
      await mockNFT.transferFrom(anotherAccount, burner.address, nft1, { from: anotherAccount })
      await burner.recoverERC721(mockNFT.address, nft1, { from: deployer })

      // check final NFT ownership state
      assertBn(await mockNFT.balanceOf(treasuryAddr), new BN('2'))
      assertBn(await mockNFT.ownerOf(nft1), treasuryAddr)
      assertBn(await mockNFT.ownerOf(nft2), treasuryAddr)
    })
  })

  it(`Don't accept ETH`, async function () {
    const burner_addr = burner.address

    // try send 1 ETH, should be reverted with fallback defined reason
    assertRevert(web3.eth.sendTransaction({ from: anotherAccount, to: burner_addr, value: ETH(1) }), `INCOMING_ETH_IS_FORBIDDEN`)

    // try send 100 ETH, should be reverted with fallback defined reason
    assertRevert(web3.eth.sendTransaction({ from: anotherAccount, to: burner_addr, value: ETH(100) }), `INCOMING_ETH_IS_FORBIDDEN`)

    // try send 0.001 ETH, should be reverted with fallback defined reason
    assertRevert(web3.eth.sendTransaction({ from: anotherAccount, to: burner_addr, value: ETH(0.001) }), `INCOMING_ETH_IS_FORBIDDEN`)
  })
})
