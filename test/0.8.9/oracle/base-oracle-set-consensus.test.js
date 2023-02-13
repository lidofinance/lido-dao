const { assert } = require('../../helpers/assert')
const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const MockConsensusContract = artifacts.require('MockConsensusContract')

const {
  SLOTS_PER_EPOCH,
  SECONDS_PER_SLOT,
  GENESIS_TIME,
  EPOCHS_PER_FRAME,
  SLOTS_PER_FRAME,
  HASH_1,
  HASH_2,
  CONSENSUS_VERSION,
  deployBaseOracle
} = require('./base-oracle-deploy.test')

contract('BaseOracle', ([admin, member, notMember]) => {
  let consensus
  let baseOracle
  let initialRefSlot

  const deployContract = async () => {
    const deployed = await deployBaseOracle(admin, { initialEpoch: 1, mockMember: member })
    consensus = deployed.consensusContract
    baseOracle = deployed.oracle
    await baseOracle.grantRole(web3.utils.keccak256('MANAGE_CONSENSUS_CONTRACT_ROLE'), admin, { from: admin })
    await baseOracle.grantRole(web3.utils.keccak256('MANAGE_CONSENSUS_VERSION_ROLE'), admin, { from: admin })
    initialRefSlot = +(await baseOracle.getTime())
  }

  describe('setConsensusContract safely changes used consensus contract', () => {
    before(deployContract)

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
        0,
        0,
        admin,
        { from: admin }
      )
      await assert.revertsWithCustomError(
        baseOracle.setConsensusContract(wrongConsensusContract.address),
        'UnexpectedChainConfig()'
      )
    })

    it('reverts on consensus current frame behind current processing', async () => {
      const wrongConsensusContract = await MockConsensusContract.new(
        SLOTS_PER_EPOCH,
        SECONDS_PER_SLOT,
        GENESIS_TIME,
        EPOCHS_PER_FRAME,
        0,
        0,
        admin,
        { from: admin }
      )
      await wrongConsensusContract.setCurrentFrame(10, 1, 2000)
      await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, initialRefSlot + SLOTS_PER_FRAME)
      await baseOracle.startProcessing()

      await assert.revertsWithCustomError(
        baseOracle.setConsensusContract(wrongConsensusContract.address),
        `RefSlotCannotBeLessThanProcessingOne(1, ${initialRefSlot})`
      )
    })

    it('successfully sets new consensus contract', async () => {
      const newConsensusContract = await MockConsensusContract.new(
        SLOTS_PER_EPOCH,
        SECONDS_PER_SLOT,
        GENESIS_TIME,
        EPOCHS_PER_FRAME,
        0,
        0,
        admin,
        { from: admin }
      )
      await newConsensusContract.setCurrentFrame(10, initialRefSlot + 1, initialRefSlot + SLOTS_PER_FRAME)
      const tx = await baseOracle.setConsensusContract(newConsensusContract.address)
      assert.emits(tx, 'ConsensusHashContractSet', { addr: newConsensusContract.address, prevAddr: consensus.address })
      const addressAtStorage = await baseOracle.getConsensusContract()
      assert.addressEqual(addressAtStorage, newConsensusContract.address)
    })
  })

  describe('setConsensusVersion updates contract state', () => {
    before(deployContract)

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
    before(deployContract)

    it('report is submitted', async () => {
      await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, initialRefSlot + 10)
    })

    it('deadline missed on current ref slot, reverts on any arguments', async () => {
      await baseOracle.advanceTimeBy(11)
      await assert.revertsWithCustomError(
        baseOracle.checkConsensusData(initialRefSlot, CONSENSUS_VERSION, HASH_1),
        `ProcessingDeadlineMissed(${initialRefSlot + 10})`
      )
      await baseOracle.setTime(initialRefSlot)
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

  describe('_isConsensusMember correctly check address for consensus membership trough consensus contract', () => {
    before(deployContract)

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
    before(deployContract)

    it('refSlot matches', async () => {
      const oracle_slot = await baseOracle.getCurrentRefSlot()
      const consensus_slot = (await consensus.getCurrentFrame()).refSlot
      assert.equals(oracle_slot, consensus_slot)
    })
  })
})
