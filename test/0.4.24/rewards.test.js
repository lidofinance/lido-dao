const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { BN } = require('bn.js')

const StETH = artifacts.require('StETH.sol') // we can just import due to StETH imported in test_helpers/Imports.sol
const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

const Lido = artifacts.require('TestLido.sol')
const OracleMock = artifacts.require('OracleMock.sol')
const ValidatorRegistrationMock = artifacts.require('ValidatorRegistrationMock.sol')

const UNLIMITED = 1000000000

const pad = (hex, bytesLength) => {
  const absentZeroes = bytesLength * 2 + 2 - hex.length
  if (absentZeroes > 0) hex = '0x' + '0'.repeat(absentZeroes) + hex.substr(2)
  return hex
}

const hexConcat = (first, ...rest) => {
  let result = first.startsWith('0x') ? first : '0x' + first
  rest.forEach((item) => {
    result += item.startsWith('0x') ? item.substr(2) : item
  })
  return result
}

const round = (bn) => bn.addn(50).divn(100).muln(100)
const ETH = (value) => web3.utils.toWei(value + '', 'ether')
const tokens = ETH

contract('Lido with StEth', ([appManager, voting, user1, user2, user3, nobody, nodeOperatorAddress1, nodeOperatorAddress2]) => {
  let appBase, stEthBase, nodeOperatorsRegistryBase, app, token, oracle, validatorRegistration, operators
  let treasuryAddr, insuranceAddr
  // Fee and its distribution are in basis points, 10000 corresponding to 100%
  // Total fee is 1%
  const totalFeePoints = 0.1 * 10000

  // Of this 1%, 30% goes to the treasury
  const treasuryFeePoints = 0.3 * 10000
  // 20% goes to the insurance fund
  const insuranceFeePoints = 0.2 * 10000
  // 50% goes to node operators
  const nodeOperatorsFeePoints = 0.5 * 10000

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await Lido.new()
    stEthBase = await StETH.new()
    oracle = await OracleMock.new()
    validatorRegistration = await ValidatorRegistrationMock.new()
    nodeOperatorsRegistryBase = await NodeOperatorsRegistry.new()
  })

  beforeEach('deploy dao and app', async () => {
    const { dao, acl } = await newDao(appManager)

    // NodeOperatorsRegistry
    let proxyAddress = await newApp(dao, 'node-operators-registry', nodeOperatorsRegistryBase.address, appManager)
    operators = await NodeOperatorsRegistry.at(proxyAddress)
    await operators.initialize()

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    proxyAddress = await newApp(dao, 'lido', appBase.address, appManager)
    app = await Lido.at(proxyAddress)

    // token
    proxyAddress = await newApp(dao, 'steth', stEthBase.address, appManager)
    token = await StETH.at(proxyAddress)
    await token.initialize(app.address)

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.PAUSE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.MANAGE_FEE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.MANAGE_WITHDRAWAL_KEY(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.SET_DEPOSIT_ITERATION_LIMIT(), appManager, { from: appManager })

    await acl.createPermission(app.address, token.address, await token.MINT_ROLE(), appManager, { from: appManager })
    await acl.createPermission(app.address, token.address, await token.BURN_ROLE(), appManager, { from: appManager })

    await acl.createPermission(voting, operators.address, await operators.SET_POOL(), appManager, { from: appManager })
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

    // Initialize the app's proxy.
    await app.initialize(token.address, validatorRegistration.address, oracle.address, operators.address, 10)
    treasuryAddr = await app.getTreasury()
    insuranceAddr = await app.getInsuranceFund()
    await oracle.setPool(app.address)
    await validatorRegistration.reset()
    await operators.setPool(app.address, { from: voting })

    // Set fee
    await app.setFee(totalFeePoints, { from: voting })
    await app.setFeeDistribution(treasuryFeePoints, insuranceFeePoints, nodeOperatorsFeePoints, { from: voting })
  })

  it('check fee configuration', async () => {
    assertBn(await app.getFee(), totalFeePoints)
    const fees = await app.getFeeDistribution()
    assertBn(fees.treasuryFeeBasisPoints, treasuryFeePoints)
    assertBn(fees.insuranceFeeBasisPoints, insuranceFeePoints)
    assertBn(fees.operatorsFeeBasisPoints, nodeOperatorsFeePoints)
  })

  context('check rewards', () => {
    beforeEach(async () => {
        await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
        await operators.addNodeOperator('1', nodeOperatorAddress1, UNLIMITED, { from: voting })
        await operators.addSigningKeys(0, 1, hexConcat(pad('0x010203', 48)), hexConcat(pad('0x01', 96)), { from: voting })

        await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(32) })
        await app.depositBufferedEther()
        await oracle.reportEther2(200, ETH(64))
    })

    it('Lido', async () => {
        const stat = await app.getEther2Stat()
        assertBn(stat.deposited, ETH(32))
        assertBn(stat.remote, ETH(64))
        assertBn(await app.getBufferedEther(), ETH(0))
        assertBn(await app.getTotalControlledEther(), ETH(64))
        assertBn(await app.getRewardBase(), ETH(64))
    })

    it('stETH', async () => {
        assertBn(await token.totalSupply(), tokens(64))
        assertBn(round(await token.balanceOf(app.address)), tokens(0))
        assertBn(round(await token.balanceOf(user1)), tokens(60.8))
        assertBn(round(await token.balanceOf(treasuryAddr)), tokens(0.96))
        assertBn(round(await token.balanceOf(insuranceAddr)), tokens(0.64))
        assertBn(round(await token.balanceOf(nodeOperatorAddress1)), tokens(1.6))
    })
  })
})