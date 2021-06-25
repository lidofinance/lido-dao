const { newDao, newApp } = require('./0.4.24/helpers/dao')
const { buildKeyData } = require('./0.4.24/helpers/keyData')
const { packKeyArray, packSigArray, createKeyBatches, createSigBatches } = require('./0.4.24/helpers/publicKeyArrays')
const { KEYS_BATCH_SIZE, hexConcat, padHash, padKey, padSig, ETH, tokens, div15 } = require('./helpers/utils')
const { assertBn, assertRevert } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const StETH = artifacts.require('StETH.sol') // we can just import due to StETH imported in test_helpers/Imports.sol
const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

const Lido = artifacts.require('LidoMock.sol')
const OracleMock = artifacts.require('OracleMock.sol')
const DepositContract = artifacts.require('DepositContract')

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'
const ADDRESS_3 = '0x0000000000000000000000000000000000000003'
const ADDRESS_4 = '0x0000000000000000000000000000000000000004'

const UNLIMITED = 1000000000

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

contract('Lido with official deposit contract', ([appManager, voting, user1, user2, user3, nobody]) => {
  let appBase, stEthBase, nodeOperatorsRegistryBase, app, token, oracle, depositContract, operators
  let treasuryAddr, insuranceAddr

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await Lido.new()
    // stEthBase = await StETH.new()
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
    // proxyAddress = await newApp(dao, 'steth', stEthBase.address, appManager)
    token = app
    // await token.initialize(app.address)

    // Set up the app's permissions.
    await acl.createPermission(voting, app.address, await app.PAUSE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.MANAGE_FEE(), appManager, { from: appManager })
    await acl.createPermission(voting, app.address, await app.MANAGE_WITHDRAWAL_KEY(), appManager, { from: appManager })

    // await acl.createPermission(app.address, token.address, await token.MINT_ROLE(), appManager, { from: appManager })
    // await acl.createPermission(app.address, token.address, await token.BURN_ROLE(), appManager, { from: appManager })

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
    await app.initialize(depositContract.address, oracle.address, operators.address)
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

    await app.setWithdrawalCredentials(padHash('0x0202'), { from: voting })

    const op0 = {
      keys: createKeyBatches(1),
      sigs: createSigBatches(1)
    }
    const op1 = {
      keys: createKeyBatches(3, KEYS_BATCH_SIZE),
      sigs: createSigBatches(3, KEYS_BATCH_SIZE)
    }

    const operatorArray = [op0, op1]

    await operators.addSigningKeys(0, KEYS_BATCH_SIZE, packKeyArray(op0.keys), packSigArray(op0.sigs), { from: voting })
    await operators.addSigningKeys(1, 3 * KEYS_BATCH_SIZE, packKeyArray(op1.keys), packSigArray(op1.sigs), { from: voting })

    // +1 ETH
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(1) })

    // +32 * KEYS_BATCH_SIZE ETH
    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(32 * KEYS_BATCH_SIZE) })
    await checkStat({ depositedValidators: 0, beaconBalance: 0 })
    assertBn(bn(await depositContract.get_deposit_count()), 0)
    assertBn(await app.getTotalPooledEther(), ETH(32 * KEYS_BATCH_SIZE + 1))
    assertBn(await app.getBufferedEther(), ETH(32 * KEYS_BATCH_SIZE + 1))
    assertBn(await token.balanceOf(user1), tokens(1))
    assertBn(await token.balanceOf(user2), tokens(32 * KEYS_BATCH_SIZE))
    assertBn(await token.totalSupply(), tokens(32 * KEYS_BATCH_SIZE + 1))

    await app.depositBufferedEther([buildKeyData(operatorArray, 0, 0)])

    await checkStat({ depositedValidators: KEYS_BATCH_SIZE, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(32 * KEYS_BATCH_SIZE + 1))
    assertBn(await app.getBufferedEther(), ETH(1))
    assertBn(await token.balanceOf(user1), tokens(1))
    assertBn(await token.balanceOf(user2), tokens(32 * KEYS_BATCH_SIZE))
    assertBn(await token.totalSupply(), tokens(32 * KEYS_BATCH_SIZE + 1))

    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), KEYS_BATCH_SIZE)

    // +100 ETH
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(3 * KEYS_BATCH_SIZE * 32) })
    await app.depositBufferedEther([
      buildKeyData(operatorArray, 1, 0),
      buildKeyData(operatorArray, 1, 1),
      buildKeyData(operatorArray, 1, 2)
    ])

    await checkStat({ depositedValidators: 4 * KEYS_BATCH_SIZE, beaconBalance: 0 })
    assertBn(await app.getTotalPooledEther(), ETH(4 * 32 * KEYS_BATCH_SIZE + 1))
    assertBn(await app.getBufferedEther(), ETH(1))
    assertBn(await token.balanceOf(user1), tokens(3 * 32 * KEYS_BATCH_SIZE + 1))
    assertBn(await token.balanceOf(user2), tokens(32 * KEYS_BATCH_SIZE))
    assertBn(await token.totalSupply(), tokens(4 * 32 * KEYS_BATCH_SIZE + 1))

    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 4 * KEYS_BATCH_SIZE)
  })

  it('key removal is taken into account during deposit', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, UNLIMITED, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, UNLIMITED, { from: voting })

    await app.setWithdrawalCredentials(padHash('0x0202'), { from: voting })
    const op0 = {
      keys: createKeyBatches(3),
      sigs: createSigBatches(3)
    }
    const op1 = {
      keys: createKeyBatches(3, 3 * KEYS_BATCH_SIZE),
      sigs: createSigBatches(3, 3 * KEYS_BATCH_SIZE)
    }

    const operatorArray = [op0, op1]

    await operators.addSigningKeys(0, 3 * KEYS_BATCH_SIZE, packKeyArray(op0.keys), packSigArray(op0.sigs), { from: voting })
    await operators.addSigningKeys(1, 3 * KEYS_BATCH_SIZE, packKeyArray(op1.keys), packSigArray(op1.sigs), { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(KEYS_BATCH_SIZE * 32 + 1) })
    await app.depositBufferedEther([buildKeyData(operatorArray, 0, 0)])

    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), KEYS_BATCH_SIZE)

    // Clear two remaining batches from operator 0
    await operators.clearMerkleRoot(0, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(2 * KEYS_BATCH_SIZE * 32) })
    await app.depositBufferedEther([buildKeyData(operatorArray, 1, 0), buildKeyData(operatorArray, 1, 1)])

    assertBn(bn(changeEndianness(await depositContract.get_deposit_count())), 3 * KEYS_BATCH_SIZE)
    assertBn(await app.getTotalPooledEther(), ETH(3 * KEYS_BATCH_SIZE * 32 + 1))
    assertBn(await app.getBufferedEther(), ETH(1))
  })

  it('Node Operators filtering during deposit works when doing a huge deposit', async () => {
    await app.setWithdrawalCredentials(padHash('0x0202'), { from: voting })

    await operators.addNodeOperator('good', ADDRESS_1, UNLIMITED, { from: voting }) // 0
    await operators.addSigningKeys(0, 2, hexConcat(padKey('0x0001'), padKey('0x0002')), hexConcat(padSig('0x01'), padSig('0x01')), {
      from: voting
    })

    await operators.addNodeOperator('limited', ADDRESS_2, 1, { from: voting }) // 1
    await operators.addSigningKeys(1, 2, hexConcat(padKey('0x0101'), padKey('0x0102')), hexConcat(padSig('0x01'), padSig('0x01')), {
      from: voting
    })

    await operators.addNodeOperator('deactivated', ADDRESS_3, UNLIMITED, { from: voting }) // 2
    await operators.addSigningKeys(2, 2, hexConcat(padKey('0x0201'), padKey('0x0202')), hexConcat(padSig('0x01'), padSig('0x01')), {
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
    await operators.addSigningKeys(0, 1, padKey('0x0003'), padSig('0x01'), { from: voting })
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
    await app.setWithdrawalCredentials(padHash('0x0202'), { from: voting })

    await operators.addNodeOperator('good', ADDRESS_1, UNLIMITED, { from: voting }) // 0
    await operators.addSigningKeys(0, 2, hexConcat(padKey('0x0001'), padKey('0x0002')), hexConcat(padSig('0x01'), padSig('0x01')), {
      from: voting
    })

    await operators.addNodeOperator('limited', ADDRESS_2, 1, { from: voting }) // 1
    await operators.addSigningKeys(1, 2, hexConcat(padKey('0x0101'), padKey('0x0102')), hexConcat(padSig('0x01'), padSig('0x01')), {
      from: voting
    })

    await operators.addNodeOperator('deactivated', ADDRESS_3, UNLIMITED, { from: voting }) // 2
    await operators.addSigningKeys(2, 2, hexConcat(padKey('0x0201'), padKey('0x0202')), hexConcat(padSig('0x01'), padSig('0x01')), {
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
    await operators.addSigningKeys(0, 1, padKey('0x0003'), padSig('0x01'), { from: voting })
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
    await app.setWithdrawalCredentials(padHash('0x0202'), { from: voting })

    await operators.addNodeOperator('good', ADDRESS_1, UNLIMITED, { from: voting }) // 0
    await operators.addSigningKeys(0, 2, hexConcat(padKey('0x0001'), padKey('0x0002')), hexConcat(padSig('0x01'), padSig('0x01')), {
      from: voting
    })

    await operators.addNodeOperator('2nd good', ADDRESS_2, UNLIMITED, { from: voting }) // 1
    await operators.addSigningKeys(1, 2, hexConcat(padKey('0x0101'), padKey('0x0102')), hexConcat(padSig('0x01'), padSig('0x01')), {
      from: voting
    })

    await operators.addNodeOperator('deactivated', ADDRESS_3, UNLIMITED, { from: voting }) // 2
    await operators.addSigningKeys(2, 2, hexConcat(padKey('0x0201'), padKey('0x0202')), hexConcat(padSig('0x01'), padSig('0x01')), {
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
