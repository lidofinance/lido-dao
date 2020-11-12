const { newDao, newApp } = require('./0.4.24/helpers/dao')
const { assertBn, assertRevert } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')
const { BN } = require('bn.js')

const StETH = artifacts.require('StETH.sol') // we can just import due to StETH imported in test_helpers/Imports.sol
const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

const Lido = artifacts.require('TestLido.sol')
const OracleMock = artifacts.require('OracleMock.sol')
const DepositContract = artifacts.require('DepositContract')

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'
const ADDRESS_3 = '0x0000000000000000000000000000000000000003'
const ADDRESS_4 = '0x0000000000000000000000000000000000000004'

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

const changeEndianness = (string) => {
  string = string.replace('0x', '')
  const result = []
  let len = string.length - 2
  while (len >= 0) {
    result.push(string.substr(len, 2))
    len -= 2
  }
  return '0x' + result.join('')
}

// Divides a BN by 1e15
const div15 = (bn) => bn.div(new BN(1000000)).div(new BN(1000000)).div(new BN(1000))

const ETH = (value) => web3.utils.toWei(value + '', 'ether')
const tokens = ETH

contract('Lido with official deposit contract', ([appManager, voting, user1, user2, user3, nobody]) => {
  let appBase, stEthBase, nodeOperatorsRegistryBase, app, token, oracle, depositContract, operators
  let treasuryAddr, insuranceAddr

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await Lido.new()
    stEthBase = await StETH.new()
    oracle = await OracleMock.new()
    nodeOperatorsRegistryBase = await NodeOperatorsRegistry.new()
  })

  beforeEach('deploy dao and app', async () => {
    depositContract = await DepositContract.new()
    const { dao, acl } = await newDao(appManager)

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    let proxyAddress = await newApp(dao, 'lido', appBase.address, appManager)
    app = await Lido.at(proxyAddress)

    // NodeOperatorsRegistry
    proxyAddress = await newApp(dao, 'node-operators-registry', nodeOperatorsRegistryBase.address, appManager)
    operators = await NodeOperatorsRegistry.at(proxyAddress)
    await operators.initialize(app.address)

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
    await app.initialize(token.address, depositContract.address, oracle.address, operators.address, 10)
    treasuryAddr = await app.getTreasury()
    insuranceAddr = await app.getInsuranceFund()

    await oracle.setPool(app.address)
    // await depositContract.reset()
  })

  const checkStat = async ({ depositedValidators, beaconBalance }) => {
    const stat = await app.getBeaconStat()
    assertBn(stat.depositedValidators, depositedValidators, 'deposited ether check')
    assertBn(stat.beaconBalance, beaconBalance, 'remote ether check')
  }

  // Assert reward distribution. The values must be divided by 1e15.
  const checkRewards = async ({ treasury, insurance, operator }) => {
    const [treasury_b, insurance_b, operators_b, a1, a2, a3, a4] = await Promise.all([
      token.balanceOf(treasuryAddr),
      token.balanceOf(insuranceAddr),
      token.balanceOf(operators.address),
      token.balanceOf(ADDRESS_1),
      token.balanceOf(ADDRESS_2),
      token.balanceOf(ADDRESS_3),
      token.balanceOf(ADDRESS_4)
    ])

    assertBn(div15(treasury_b), treasury, 'treasury token balance check')
    assertBn(div15(insurance_b), insurance, 'insurance fund token balance check')
    assertBn(div15(operators_b.add(a1).add(a2).add(a3).add(a4)), operator, 'node operators token balance check')
  }

  it('deposit works', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, UNLIMITED, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, UNLIMITED, { from: voting })

    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    // +1 ETH
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(1) })
    await app.depositBufferedEther()

    await checkStat({ depositedValidators: 0, beaconBalance: 0 })
    assertBn(bn(await app.toLittleEndian64(await depositContract.get_deposit_count())), 0)
    assertBn(await app.getTotalPooledEther(), ETH(1))
    assertBn(await app.getBufferedEther(), ETH(1))
    assertBn(await token.balanceOf(user1), tokens(1))
    assertBn(await token.totalSupply(), tokens(1))

    // +2 ETH
    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2) }) // another form of a deposit call
    await app.depositBufferedEther()

    await checkStat({ depositedValidators: 0, beaconBalance: 0 })
    assertBn(bn(await depositContract.get_deposit_count()), 0)
    assertBn(await app.getTotalPooledEther(), ETH(3))
    assertBn(await app.getBufferedEther(), ETH(3))
    assertBn(await token.balanceOf(user2), tokens(2))
    assertBn(await token.totalSupply(), tokens(3))

    // +30 ETH
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(30) })
    await app.depositBufferedEther()

    await checkStat({ depositedValidators: 1, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(33))
    assertBn(await app.getBufferedEther(), ETH(1))
    assertBn(await token.balanceOf(user1), tokens(1))
    assertBn(await token.balanceOf(user2), tokens(2))
    assertBn(await token.balanceOf(user3), tokens(30))
    assertBn(await token.totalSupply(), tokens(33))

    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 1)

    // +100 ETH
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(100) })
    await app.depositBufferedEther()

    await checkStat({ depositedValidators: 4, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(133))
    assertBn(await app.getBufferedEther(), ETH(5))
    assertBn(await token.balanceOf(user1), tokens(101))
    assertBn(await token.balanceOf(user2), tokens(2))
    assertBn(await token.balanceOf(user3), tokens(30))
    assertBn(await token.totalSupply(), tokens(133))

    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 4)
  })

  it('key removal is taken into account during deposit', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, UNLIMITED, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, UNLIMITED, { from: voting })

    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(33) })
    await app.depositBufferedEther()

    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 1)
    await assertRevert(operators.removeSigningKey(0, 0, { from: voting }), 'KEY_WAS_USED')

    await operators.removeSigningKey(0, 1, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(100) })
    await app.depositBufferedEther()

    await assertRevert(operators.removeSigningKey(0, 1, { from: voting }), 'KEY_WAS_USED')
    await assertRevert(operators.removeSigningKey(0, 2, { from: voting }), 'KEY_WAS_USED')
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 3)
    assertBn(await app.getTotalPooledEther(), ETH(133))
    assertBn(await app.getBufferedEther(), ETH(37))
  })

  it('Node Operators filtering during deposit works when doing a huge deposit', async () => {
    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addNodeOperator('good', ADDRESS_1, UNLIMITED, { from: voting }) // 0
    await operators.addSigningKeys(0, 2, hexConcat(pad('0x0001', 48), pad('0x0002', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })

    await operators.addNodeOperator('limited', ADDRESS_2, 1, { from: voting }) // 1
    await operators.addSigningKeys(1, 2, hexConcat(pad('0x0101', 48), pad('0x0102', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })

    await operators.addNodeOperator('deactivated', ADDRESS_3, UNLIMITED, { from: voting }) // 2
    await operators.addSigningKeys(2, 2, hexConcat(pad('0x0201', 48), pad('0x0202', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })
    await operators.setNodeOperatorActive(2, false, { from: voting })

    await operators.addNodeOperator('short on keys', ADDRESS_4, UNLIMITED, { from: voting }) // 3

    await app.setFee(5000, { from: voting })
    await app.setFeeDistribution(3000, 2000, 5000, { from: voting })

    // Deposit huge chunk
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(32 * 3 + 50) })
    await app.depositBufferedEther()

    await checkStat({ depositedValidators: 3, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(146))
    assertBn(await app.getBufferedEther(), ETH(50))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 3)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Next deposit changes nothing
    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(32) })
    await app.depositBufferedEther()

    await checkStat({ depositedValidators: 3, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(178))
    assertBn(await app.getBufferedEther(), ETH(82))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 3)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // #1 goes below the limit
    await operators.reportStoppedValidators(1, 1, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.depositBufferedEther()

    await checkStat({ depositedValidators: 4, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(179))
    assertBn(await app.getBufferedEther(), ETH(51))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 4)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Adding a key will help
    await operators.addSigningKeys(0, 1, pad('0x0003', 48), pad('0x01', 96), { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.depositBufferedEther()

    await checkStat({ depositedValidators: 5, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(180))
    assertBn(await app.getBufferedEther(), ETH(20))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 5)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Reactivation of #2
    await operators.setNodeOperatorActive(2, true, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(12) })
    await app.depositBufferedEther()

    await checkStat({ depositedValidators: 6, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(192))
    assertBn(await app.getBufferedEther(), ETH(0))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 6)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)
  })

  it('Node Operators filtering during deposit works when doing small deposits', async () => {
    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addNodeOperator('good', ADDRESS_1, UNLIMITED, { from: voting }) // 0
    await operators.addSigningKeys(0, 2, hexConcat(pad('0x0001', 48), pad('0x0002', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })

    await operators.addNodeOperator('limited', ADDRESS_2, 1, { from: voting }) // 1
    await operators.addSigningKeys(1, 2, hexConcat(pad('0x0101', 48), pad('0x0102', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })

    await operators.addNodeOperator('deactivated', ADDRESS_3, UNLIMITED, { from: voting }) // 2
    await operators.addSigningKeys(2, 2, hexConcat(pad('0x0201', 48), pad('0x0202', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })
    await operators.setNodeOperatorActive(2, false, { from: voting })

    await operators.addNodeOperator('short on keys', ADDRESS_4, UNLIMITED, { from: voting }) // 3

    await app.setFee(5000, { from: voting })
    await app.setFeeDistribution(3000, 2000, 5000, { from: voting })

    // Small deposits
    for (let i = 0; i < 14; i++) await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(10) })
    await app.depositBufferedEther()

    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(6) })
    await app.depositBufferedEther()

    await checkStat({ deposited: ETH(96), remote: 0 })
    assertBn(await app.setTotalPooledEther(), ETH(146))
    assertBn(await app.getBufferedEther(), ETH(50))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 3)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Next deposit changes nothing
    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(32) })
    await app.depositBufferedEther()

    await checkStat({ depositedValidators: 3, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(178))
    assertBn(await app.getBufferedEther(), ETH(82))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 3)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // #1 goes below the limit
    await operators.reportStoppedValidators(1, 1, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.depositBufferedEther()

    await checkStat({ depositedValidators: 4, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(179))
    assertBn(await app.getBufferedEther(), ETH(51))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 4)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Adding a key will help
    await operators.addSigningKeys(0, 1, pad('0x0003', 48), pad('0x01', 96), { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.depositBufferedEther()

    await checkStat({ depositedValidators: 5, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(180))
    assertBn(await app.getBufferedEther(), ETH(20))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 5)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Reactivation of #2
    await operators.setNodeOperatorActive(2, true, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(12) })
    await app.depositBufferedEther()

    await checkStat({ depositedValidators: 6, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(192))
    assertBn(await app.getBufferedEther(), ETH(0))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 6)

    assertBn(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assertBn(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 0)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)
  })

  it('Deposit finds the right operator', async () => {
    await app.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addNodeOperator('good', ADDRESS_1, UNLIMITED, { from: voting }) // 0
    await operators.addSigningKeys(0, 2, hexConcat(pad('0x0001', 48), pad('0x0002', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })

    await operators.addNodeOperator('2nd good', ADDRESS_2, UNLIMITED, { from: voting }) // 1
    await operators.addSigningKeys(1, 2, hexConcat(pad('0x0101', 48), pad('0x0102', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })

    await operators.addNodeOperator('deactivated', ADDRESS_3, UNLIMITED, { from: voting }) // 2
    await operators.addSigningKeys(2, 2, hexConcat(pad('0x0201', 48), pad('0x0202', 48)), hexConcat(pad('0x01', 96), pad('0x01', 96)), {
      from: voting
    })
    await operators.setNodeOperatorActive(2, false, { from: voting })

    await operators.addNodeOperator('short on keys', ADDRESS_4, UNLIMITED, { from: voting }) // 3

    await app.setFee(5000, { from: voting })
    await app.setFeeDistribution(3000, 2000, 5000, { from: voting })

    // #1 and #0 get the funds
    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(64) })
    await app.depositBufferedEther()

    await checkStat({ depositedValidators: 2, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(64))
    assertBn(await app.getBufferedEther(), ETH(0))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 2)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Reactivation of #2 - has the smallest stake
    await operators.setNodeOperatorActive(2, true, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(36) })
    await app.depositBufferedEther()

    await checkStat({ depositedValidators: 3, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(100))
    assertBn(await app.getBufferedEther(), ETH(4))
    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 3)

    assertBn(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 1)
    assertBn(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)
  })
})
