const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { getEventArgument, ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

const { pad, ETH, hexConcat } = require('../helpers/utils')
const { deployDaoAndPool } = require('./helpers/deploy')
const { signDepositData } = require('../0.8.9/helpers/signatures')
const { waitBlocks } = require('../helpers/blockchain')

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
    // an unrelated address
    nobody
  ] = addresses

  // Limits the number of validators assigned in a single transaction, regardless the amount
  // of Ether submitted to/buffered in the contract and the number of spare validator keys.
  // This is needed to prevent the deposit loop from failing due to it using more gas than
  // available in a single block and to protect from possible attacks exploiting this.

  let pool, nodeOperatorRegistry, depositContractMock
  let depositSecurityModule, depositRoot, guardians

  it('DAO, node operators registry, token, pool and deposit security module are deployed and initialized', async () => {
    const deployed = await deployDaoAndPool(appManager, voting)

    // contracts/Lido.sol
    pool = deployed.pool
    await pool.resumeProtocolAndStaking()

    // contracts/nos/NodeOperatorsRegistry.sol
    nodeOperatorRegistry = deployed.nodeOperatorRegistry

    // mocks
    depositContractMock = deployed.depositContractMock

    depositSecurityModule = deployed.depositSecurityModule
    guardians = deployed.guardians
    depositRoot = await depositContractMock.get_deposit_root()

    await pool.setFee(0.01 * 10000, { from: voting })
    await pool.setFeeDistribution(0.3 * 10000, 0.2 * 10000, 0.5 * 10000, { from: voting })
    await pool.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await depositSecurityModule.setMaxDeposits(10, { from: appManager })
    assertBn(await depositSecurityModule.getMaxDeposits(), 10, 'invariant failed: max deposits')
  })

  it('voting adds a node operator with 26 signing keys', async () => {
    const validatorsLimit = 1000
    const numKeys = 26

    const txn = await nodeOperatorRegistry.addNodeOperator('operator_1', nodeOperator, { from: voting })
    await nodeOperatorRegistry.setNodeOperatorStakingLimit(0, validatorsLimit, { from: voting })

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

  it('a user submits 25 * 32 ETH', async () => {
    const depositAmount = 25 * 32
    const referral = ZERO_ADDRESS
    await pool.submit(referral, { from: user1, value: ETH(depositAmount) })
    assertBn(await pool.getTotalPooledEther(), ETH(depositAmount), 'total controlled ether')

    // at this point, no deposit assignments were made and all ether is buffered
    assertBn(await pool.getBufferedEther(), ETH(depositAmount), 'buffered ether')

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 0, 'deposited validators')
  })

  it('guardians can assign the buffered ether to validators by calling depositBufferedEther()', async () => {
    const block = await web3.eth.getBlock('latest')
    const keysOpIndex = await nodeOperatorRegistry.getKeysOpIndex()
    const signatures = [
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        depositRoot,
        keysOpIndex,
        block.number,
        block.hash,
        guardians.privateKeys[guardians.addresses[0]]
      ),
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        depositRoot,
        keysOpIndex,
        block.number,
        block.hash,
        guardians.privateKeys[guardians.addresses[1]]
      )
    ]
    await depositSecurityModule.depositBufferedEther(depositRoot, keysOpIndex, block.number, block.hash, signatures)

    // no more than depositIterationLimit validators are assigned in a single transaction
    assertBn(await depositContractMock.totalCalls(), 10, 'total validators assigned')

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 10, 'deposited validators')

    // the rest of the received Ether is still buffered in the pool
    assertBn(await pool.getBufferedEther(), ETH(15 * 32), 'buffered ether')
  })

  it('guardians can advance the deposit loop further by calling depositBufferedEther() once again', async () => {
    const block = await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
    const keysOpIndex = await nodeOperatorRegistry.getKeysOpIndex()
    const signatures = [
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        depositRoot,
        keysOpIndex,
        block.number,
        block.hash,
        guardians.privateKeys[guardians.addresses[0]]
      ),
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        depositRoot,
        keysOpIndex,
        block.number,
        block.hash,
        guardians.privateKeys[guardians.addresses[1]]
      )
    ]
    await depositSecurityModule.depositBufferedEther(depositRoot, keysOpIndex, block.number, block.hash, signatures)

    assertBn(await depositContractMock.totalCalls(), 20, 'total validators assigned')

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 20, 'deposited validators')
    assertBn(await pool.getBufferedEther(), ETH(5 * 32), 'buffered ether')
  })

  it('the number of assigned validators is limited by the remaining ether', async () => {
    const block = await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
    const keysOpIndex = await nodeOperatorRegistry.getKeysOpIndex()
    const signatures = [
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        depositRoot,
        keysOpIndex,
        block.number,
        block.hash,
        guardians.privateKeys[guardians.addresses[0]]
      ),
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        depositRoot,
        keysOpIndex,
        block.number,
        block.hash,
        guardians.privateKeys[guardians.addresses[1]]
      )
    ]
    await depositSecurityModule.depositBufferedEther(depositRoot, keysOpIndex, block.number, block.hash, signatures)

    assertBn(await depositContractMock.totalCalls(), 25)

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 25, 'deposited validators')

    // the is no ether left buffered in the pool
    assertBn(await pool.getBufferedEther(), ETH(0), 'buffered ether')
  })

  it('a user submits 2 * 32 ETH', async () => {
    const referral = ZERO_ADDRESS
    await pool.submit(referral, { from: user1, value: ETH(2 * 32) })

    assertBn(await pool.getTotalPooledEther(), ETH(27 * 32), 'total controlled ether')
    assertBn(await pool.getBufferedEther(), ETH(2 * 32), 'buffered ether')
  })

  it('the number of assigned validators is still limited by the number of available validator keys', async () => {
    const block = await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
    const keysOpIndex = await nodeOperatorRegistry.getKeysOpIndex()
    const signatures = [
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        depositRoot,
        keysOpIndex,
        block.number,
        block.hash,
        guardians.privateKeys[guardians.addresses[0]]
      ),
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        depositRoot,
        keysOpIndex,
        block.number,
        block.hash,
        guardians.privateKeys[guardians.addresses[1]]
      )
    ]
    await depositSecurityModule.depositBufferedEther(depositRoot, keysOpIndex, block.number, block.hash, signatures)

    assertBn(await depositContractMock.totalCalls(), 26)

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 26, 'deposited validators')

    // the rest of the received Ether is still buffered in the pool
    assertBn(await pool.getBufferedEther(), ETH(1 * 32), 'buffered ether')
  })

  it('depositBufferedEther is a nop if there are no signing keys available', async () => {
    const block = await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
    const keysOpIndex = await nodeOperatorRegistry.getKeysOpIndex()
    const signatures = [
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        depositRoot,
        keysOpIndex,
        block.number,
        block.hash,
        guardians.privateKeys[guardians.addresses[0]]
      ),
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        depositRoot,
        keysOpIndex,
        block.number,
        block.hash,
        guardians.privateKeys[guardians.addresses[1]]
      )
    ]
    await depositSecurityModule.depositBufferedEther(depositRoot, keysOpIndex, block.number, block.hash, signatures)

    assertBn(await depositContractMock.totalCalls(), 26, 'total validators assigned')

    // the rest of the received Ether is still buffered in the pool
    assertBn(await pool.getBufferedEther(), ETH(1 * 32), 'buffered ether')
  })
})
