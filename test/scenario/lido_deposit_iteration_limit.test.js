const { contract, artifacts, web3 } = require('hardhat')
const { getEventArgument } = require('@aragon/contract-helpers-test')
const { assert } = require('../helpers/assert')

const { pad, ETH, hexConcat } = require('../helpers/utils')
const { waitBlocks } = require('../helpers/blockchain')
const { DSMAttestMessage, DSMPauseMessage } = require('../helpers/signatures')
const { deployProtocol } = require('../helpers/protocol')
const { setupNodeOperatorsRegistry } = require('../helpers/staking-modules')
const { ZERO_ADDRESS } = require('../helpers/constants')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')
const CURATED_MODULE_ID = 1

contract('Lido: deposit loop iteration limit', ([user1, nobody, nodeOperator]) => {
  // Limits the number of validators assigned in a single transaction, regardless the amount
  // of Ether submitted to/buffered in the contract and the number of spare validator keys.
  // This is needed to prevent the deposit loop from failing due to it using more gas than
  // available in a single block and to protect from possible attacks exploiting this.

  let pool, nodeOperatorsRegistry, depositContractMock
  let depositSecurityModule, depositRoot, guardians, appManager, voting

  it('DAO, node operators registry, token, pool and deposit security module are deployed and initialized', async () => {
    const deployed = await deployProtocol({
      stakingModulesFactory: async (protocol) => {
        const curatedModule = await setupNodeOperatorsRegistry(protocol)
        return [
          {
            module: curatedModule,
            name: 'Curated',
            targetShares: 10000,
            moduleFee: 500,
            treasuryFee: 500,
          },
        ]
      },
    })

    pool = deployed.pool
    nodeOperatorsRegistry = deployed.stakingModules[0]
    depositContractMock = deployed.depositContract
    depositSecurityModule = deployed.depositSecurityModule
    guardians = deployed.guardians
    depositRoot = await depositContractMock.get_deposit_root()
    appManager = deployed.appManager.address
    voting = deployed.voting.address

    await depositSecurityModule.setMaxDeposits(10, { from: appManager })
    assert.equals(await depositSecurityModule.getMaxDeposits(), 10, 'invariant failed: max deposits')
  })

  it('voting adds a node operator with 26 signing keys', async () => {
    const validatorsLimit = 1000
    const numKeys = 26

    const txn = await nodeOperatorsRegistry.addNodeOperator('operator_1', nodeOperator, { from: voting })

    // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
    const nodeOperatorId = getEventArgument(txn, 'NodeOperatorAdded', 'nodeOperatorId', {
      decodeForAbi: NodeOperatorsRegistry._json.abi,
    })

    assert.equals(await nodeOperatorsRegistry.getNodeOperatorsCount(), 1, 'total node operators')

    const data = Array.from({ length: numKeys }, (_, i) => {
      const n = 1 + 10 * i
      return {
        key: pad(`0x${n.toString(16)}`, 48),
        sig: pad(`0x${n.toString(16)}`, 96),
      }
    })

    const keys = hexConcat(...data.map((v) => v.key))
    const sigs = hexConcat(...data.map((v) => v.sig))

    await nodeOperatorsRegistry.addSigningKeysOperatorBH(nodeOperatorId, numKeys, keys, sigs, { from: nodeOperator })

    await nodeOperatorsRegistry.setNodeOperatorStakingLimit(0, validatorsLimit, { from: voting })

    const totalKeys = await nodeOperatorsRegistry.getTotalSigningKeyCount(nodeOperatorId, { from: nobody })
    assert.equals(totalKeys, numKeys, 'total signing keys')
  })

  it('a user submits 25 * 32 ETH', async () => {
    const depositAmount = 25 * 32
    const referral = ZERO_ADDRESS
    await pool.submit(referral, { from: user1, value: ETH(depositAmount - 1) })
    assert.equals(await pool.getTotalPooledEther(), ETH(depositAmount), 'total controlled ether')

    // at this point, no deposit assignments were made and all ether is buffered
    assert.equals(await pool.getBufferedEther(), ETH(depositAmount), 'buffered ether')

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 0, 'deposited validators')
  })

  it('guardians can assign the buffered ether to validators by calling depositBufferedEther()', async () => {
    const block = await web3.eth.getBlock('latest')
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex
    )
    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]]),
    ]
    await depositSecurityModule.depositBufferedEther(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex,
      '0x',
      signatures
    )

    // no more than depositIterationLimit validators are assigned in a single transaction
    assert.equals(await depositContractMock.totalCalls(), 10, 'total validators assigned')

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 10, 'deposited validators')

    // the rest of the received Ether is still buffered in the pool
    assert.equals(await pool.getBufferedEther(), ETH(15 * 32), 'buffered ether')
  })

  it('guardians can advance the deposit loop further by calling depositBufferedEther() once again', async () => {
    const block = await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex
    )
    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]]),
    ]
    await depositSecurityModule.depositBufferedEther(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex,
      '0x',
      signatures
    )

    assert.equals(await depositContractMock.totalCalls(), 20, 'total validators assigned')

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 20, 'deposited validators')
    assert.equals(await pool.getBufferedEther(), ETH(5 * 32), 'buffered ether')
  })

  it('the number of assigned validators is limited by the remaining ether', async () => {
    const block = await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex
    )
    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]]),
    ]
    await depositSecurityModule.depositBufferedEther(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex,
      '0x',
      signatures
    )

    assert.equals(await depositContractMock.totalCalls(), 25)

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 25, 'deposited validators')

    // the is no ether left buffered in the pool
    assert.equals(await pool.getBufferedEther(), ETH(0), 'buffered ether')
  })

  it('a user submits 2 * 32 ETH', async () => {
    const referral = ZERO_ADDRESS
    await pool.submit(referral, { from: user1, value: ETH(2 * 32) })

    assert.equals(await pool.getTotalPooledEther(), ETH(27 * 32), 'total controlled ether')
    assert.equals(await pool.getBufferedEther(), ETH(2 * 32), 'buffered ether')
  })

  it('the number of assigned validators is still limited by the number of available validator keys', async () => {
    const block = await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex
    )
    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]]),
    ]
    await depositSecurityModule.depositBufferedEther(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex,
      '0x',
      signatures
    )

    assert.equals(await depositContractMock.totalCalls(), 26)

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 26, 'deposited validators')

    // the rest of the received Ether is still buffered in the pool
    assert.equals(await pool.getBufferedEther(), ETH(1 * 32), 'buffered ether')
  })

  it('depositBufferedEther is a nop if there are no signing keys available', async () => {
    const block = await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex
    )
    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]]),
    ]
    await depositSecurityModule.depositBufferedEther(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex,
      '0x',
      signatures
    )

    assert.equals(await depositContractMock.totalCalls(), 26, 'total validators assigned')

    // the rest of the received Ether is still buffered in the pool
    assert.equals(await pool.getBufferedEther(), ETH(1 * 32), 'buffered ether')
  })
})
