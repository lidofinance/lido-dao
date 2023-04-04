const { contract, artifacts, web3, ethers } = require('hardhat')
const { assert } = require('../../helpers/assert')
const { ZERO_ADDRESS } = require('../../helpers/constants')
const { EvmSnapshot } = require('../../helpers/blockchain')

const MockConsensusContract = artifacts.require('MockConsensusContract')

const {
  SLOTS_PER_EPOCH,
  SECONDS_PER_SLOT,
  GENESIS_TIME,
  EPOCHS_PER_FRAME,
  HASH_1,
  HASH_2,
  CONSENSUS_VERSION,
  computeEpochFirstSlotAt,
  computeDeadlineFromRefSlot,
  deployBaseOracle,
} = require('./base-oracle-deploy.test')

contract('BaseOracle', ([admin, member, notMember]) => {
  const evmSnapshot = new EvmSnapshot(ethers.provider)
  let consensus
  let baseOracle
  let initialRefSlot

  const deployContract = async () => {
    const deployed = await deployBaseOracle(admin, { initialEpoch: 1, mockMember: member })
    consensus = deployed.consensusContract
    baseOracle = deployed.oracle
    await baseOracle.grantRole(web3.utils.keccak256('MANAGE_CONSENSUS_CONTRACT_ROLE'), admin, { from: admin })
    await baseOracle.grantRole(web3.utils.keccak256('MANAGE_CONSENSUS_VERSION_ROLE'), admin, { from: admin })
    const time = (await baseOracle.getTime()).toNumber()
    initialRefSlot = computeEpochFirstSlotAt(time)
    await evmSnapshot.make()
  }
  const rollback = async () => evmSnapshot.rollback()

  before(deployContract)

  describe('setConsensusContract safely changes used consensus contract', () => {
    before(rollback)

    it('reverts on zero address', async () => {
      await assert.revertsWithCustomError(baseOracle.setConsensusContract(ZERO_ADDRESS), 'AddressCannotBeZero()')
    })

    it('reverts on same contract', async () => {
      await assert.revertsWithCustomError(baseOracle.setConsensusContract(consensus.address), 'AddressCannotBeSame()')
    })

    it('reverts on invalid contract', async () => {
      await assert.reverts(baseOracle.setConsensusContract(member))
    })

    it('reverts on mismatched config', async () => {
      const MockConsensusContract = artifacts.require('MockConsensusContract')
      const wrongConsensusContract = await MockConsensusContract.new(
        SLOTS_PER_EPOCH,
        SECONDS_PER_SLOT + 1,
        GENESIS_TIME + 1,
        EPOCHS_PER_FRAME,
        1,
        0,
        admin,
        { from: admin }
      )
      await assert.revertsWithCustomError(
        baseOracle.setConsensusContract(wrongConsensusContract.address),
        'UnexpectedChainConfig()'
      )
    })

    it('reverts on consensus initial ref slot behind currently processing', async () => {
      const processingRefSlot = 100

      await consensus.submitReportAsConsensus(HASH_1, processingRefSlot, +(await baseOracle.getTime()) + 1)
      await baseOracle.startProcessing()

      const wrongConsensusContract = await MockConsensusContract.new(
        SLOTS_PER_EPOCH,
        SECONDS_PER_SLOT,
        GENESIS_TIME,
        EPOCHS_PER_FRAME,
        1,
        0,
        admin,
        { from: admin }
      )

      await wrongConsensusContract.setInitialRefSlot(processingRefSlot - 1)

      await assert.revertsWithCustomError(
        baseOracle.setConsensusContract(wrongConsensusContract.address),
        `InitialRefSlotCannotBeLessThanProcessingOne(${processingRefSlot - 1}, ${processingRefSlot})`
      )
    })

    it('successfully sets new consensus contract', async () => {
      const newConsensusContract = await MockConsensusContract.new(
        SLOTS_PER_EPOCH,
        SECONDS_PER_SLOT,
        GENESIS_TIME,
        EPOCHS_PER_FRAME,
        1,
        0,
        admin,
        { from: admin }
      )
      await newConsensusContract.setInitialRefSlot(initialRefSlot)
      const tx = await baseOracle.setConsensusContract(newConsensusContract.address)
      assert.emits(tx, 'ConsensusHashContractSet', { addr: newConsensusContract.address, prevAddr: consensus.address })
      const addressAtStorage = await baseOracle.getConsensusContract()
      assert.addressEqual(addressAtStorage, newConsensusContract.address)
    })
  })

  describe('setConsensusVersion updates contract state', () => {
    before(rollback)

    it('reverts on same version', async () => {
      await assert.revertsWithCustomError(baseOracle.setConsensusVersion(CONSENSUS_VERSION), 'VersionCannotBeSame()')
    })

    it('sets updated version', async () => {
      const tx = await baseOracle.setConsensusVersion(2)
      assert.emits(tx, 'ConsensusVersionSet', { version: 2, prevVersion: CONSENSUS_VERSION })
      const versionInState = await baseOracle.getConsensusVersion()
      assert.equal(versionInState, 2)
    })
  })

  describe('_checkConsensusData checks provided data against internal state', () => {
    before(rollback)
    let deadline

    it('report is submitted', async () => {
      deadline = computeDeadlineFromRefSlot(initialRefSlot)
      await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, deadline)
    })

    it('reverts on mismatched slot', async () => {
      await assert.revertsWithCustomError(
        baseOracle.checkConsensusData(initialRefSlot + 1, CONSENSUS_VERSION, HASH_1),
        `UnexpectedRefSlot(${initialRefSlot}, ${initialRefSlot + 1})`
      )
    })

    it('reverts on mismatched consensus version', async () => {
      await assert.revertsWithCustomError(
        baseOracle.checkConsensusData(initialRefSlot, CONSENSUS_VERSION + 1, HASH_1),
        `UnexpectedConsensusVersion(${CONSENSUS_VERSION}, ${CONSENSUS_VERSION + 1})`
      )
    })

    it('reverts on mismatched hash', async () => {
      await assert.revertsWithCustomError(
        baseOracle.checkConsensusData(initialRefSlot, CONSENSUS_VERSION, HASH_2),
        `UnexpectedDataHash("${HASH_1}", "${HASH_2}")`
      )
    })

    it('check succeeds', async () => {
      await baseOracle.checkConsensusData(initialRefSlot, CONSENSUS_VERSION, HASH_1)
    })
  })

  describe('_checkProcessingDeadline checks report processing deadline', () => {
    before(rollback)
    let deadline

    it('report is submitted', async () => {
      deadline = computeDeadlineFromRefSlot(initialRefSlot)
      await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, deadline)
    })

    it('reverts if deadline is missed', async () => {
      await baseOracle.setTime(deadline + 10)
      await assert.revertsWithCustomError(baseOracle.checkProcessingDeadline(), `ProcessingDeadlineMissed(${deadline})`)
    })
  })

  describe('_isConsensusMember correctly check address for consensus membership trough consensus contract', () => {
    before(rollback)

    it('returns false on non member', async () => {
      const r = await baseOracle.isConsensusMember(notMember)
      assert(!r)
    })

    it('returns true on member', async () => {
      const r = await baseOracle.isConsensusMember(member)
      assert(r)
    })
  })

  describe('_getCurrentRefSlot correctly gets refSlot trough consensus contract', () => {
    before(rollback)

    it('refSlot matches', async () => {
      const oracle_slot = await baseOracle.getCurrentRefSlot()
      const consensus_slot = (await consensus.getCurrentFrame()).refSlot
      assert.equals(oracle_slot, consensus_slot)
    })
  })
})
