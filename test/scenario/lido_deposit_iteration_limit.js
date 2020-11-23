const { assert } = require('chai')
const { assertBn, assertRevert } = require('@aragon/contract-helpers-test/src/asserts')
const { getEvents, getEventArgument, ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

const { pad, ETH, hexConcat } = require('../helpers/utils')
const { deployDaoAndPool } = require('./helpers/deploy')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

contract('Lido: deposit loop iteration limit', (addresses) => {
  const [
    // the root account which deployed the DAO
    appManager,
    // the address which we use to simulate the voting DAO application
    voting,
    // node operators
    nodeOperator,
    // users who deposit Ether to the pool
    user1,
    user2,
    // an unrelated address
    nobody
  ] = addresses

  // Limits the number of validators assigned in a single transaction, regardless the amount
  // of Ether submitted to/buffered in the contract and the number of spare validator keys.
  // This is needed to prevent the deposit loop from failing due to it using more gas than
  // available in a single block and to protect from possible attacks exploiting this.
  const depositIterationLimit = 5

  let pool, nodeOperatorRegistry, validatorRegistrationMock

  it('DAO, node operators registry, token, and pool are deployed and initialized', async () => {
    const deployed = await deployDaoAndPool(appManager, voting)

    // contracts/Lido.sol
    pool = deployed.pool

    // contracts/nos/NodeOperatorsRegistry.sol
    nodeOperatorRegistry = deployed.nodeOperatorRegistry

    // mocks
    validatorRegistrationMock = deployed.validatorRegistrationMock

    await pool.setFee(0.01 * 10000, { from: voting })
    await pool.setFeeDistribution(0.3 * 10000, 0.2 * 10000, 0.5 * 10000, { from: voting })
    await pool.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
  })

  it('voting adds a node operator with 16 signing keys', async () => {
    const validatorsLimit = 1000
    const numKeys = 21

    const txn = await nodeOperatorRegistry.addNodeOperator('operator_1', nodeOperator, validatorsLimit, { from: voting })

    // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
    const nodeOperatorId = getEventArgument(txn, 'NodeOperatorAdded', 'id', { decodeForAbi: NodeOperatorsRegistry._json.abi })

    assertBn(await nodeOperatorRegistry.getNodeOperatorsCount(), 1, 'total node operators')

    const data = Array.from({ length: numKeys }, (_, i) => {
      const n = 1 + 10 * i
      return {
        key: pad(`0x${n.toString(16)}`, 48),
        sig: pad(`0x${n.toString(16)}`, 96)
      }
    })

    const keys = hexConcat(...data.map((v) => v.key))
    const sigs = hexConcat(...data.map((v) => v.sig))

    await nodeOperatorRegistry.addSigningKeysOperatorBH(nodeOperatorId, numKeys, keys, sigs, { from: nodeOperator })

    const totalKeys = await nodeOperatorRegistry.getTotalSigningKeyCount(nodeOperatorId, { from: nobody })
    assertBn(totalKeys, numKeys, 'total signing keys')
  })

  it('a user submits 20 * 32 ETH', async () => {
    const referral = ZERO_ADDRESS
    await pool.submit(referral, { from: user1, value: ETH(20 * 32) })
    assertBn(await pool.getTotalPooledEther(), ETH(20 * 32), 'total controlled ether')

    // at this point, no deposit assignments were made and all ether is buffered
    assertBn(await pool.getBufferedEther(), ETH(20 * 32), 'buffered ether')

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 0, 'deposited validators')
  })

  it('one can assign the buffered ether to validators by calling depositBufferedEther() and passing deposit iteration limit', async () => {
    const depositIterationLimit = 5
    await pool.depositBufferedEther(depositIterationLimit)

    // no more than depositIterationLimit validators are assigned in a single transaction
    assertBn(await validatorRegistrationMock.totalCalls(), 5, 'total validators assigned')

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 5, 'deposited validators')

    // the rest of the received Ether is still buffered in the pool
    assertBn(await pool.getBufferedEther(), ETH(15 * 32), 'buffered ether')
  })

  it('one can advance the deposit loop further by calling depositBufferedEther() once again', async () => {
    const depositIterationLimit = 10
    await pool.depositBufferedEther(depositIterationLimit)

    assertBn(await validatorRegistrationMock.totalCalls(), 15, 'total validators assigned')

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 15, 'deposited validators')

    assertBn(await pool.getBufferedEther(), ETH(5 * 32), 'buffered ether')
  })

  it('the number of assigned validators is limited by the remaining ether', async () => {
    const depositIterationLimit = 10
    await pool.depositBufferedEther(depositIterationLimit)

    assertBn(await validatorRegistrationMock.totalCalls(), 20)

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 20, 'deposited validators')

    // the is no ether left buffered in the pool
    assertBn(await pool.getBufferedEther(), ETH(0), 'buffered ether')
  })

  it('a user submits 2 * 32 ETH', async () => {
    const referral = ZERO_ADDRESS
    await pool.submit(referral, { from: user1, value: ETH(2 * 32) })

    assertBn(await pool.getTotalPooledEther(), ETH(22 * 32), 'total controlled ether')
    assertBn(await pool.getBufferedEther(), ETH(2 * 32), 'buffered ether')
  })

  it('the number of assigned validators is still limited by the number of available validator keys', async () => {
    const depositIterationLimit = 10
    await pool.depositBufferedEther(depositIterationLimit)

    assertBn(await validatorRegistrationMock.totalCalls(), 21)

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 21, 'deposited validators')

    // the rest of the received Ether is still buffered in the pool
    assertBn(await pool.getBufferedEther(), ETH(1 * 32), 'buffered ether')
  })

  it('depositBufferedEther is a nop if there are no signing keys available', async () => {
    const depositIterationLimit = 10
    await pool.depositBufferedEther(depositIterationLimit)

    assertBn(await validatorRegistrationMock.totalCalls(), 21, 'total validators assigned')

    // the rest of the received Ether is still buffered in the pool
    assertBn(await pool.getBufferedEther(), ETH(1 * 32), 'buffered ether')
  })
})
