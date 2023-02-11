const { assert } = require('../../helpers/assert')
const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const MockConsensusContract = artifacts.require('MockConsensusContract')

const baseOracleAbi = require('../../../lib/abi/BaseOracle.json')

const {
  INITIAL_FAST_LANE_LENGHT_SLOTS,
  INITIAL_EPOCH,
  SLOTS_PER_EPOCH,
  SECONDS_PER_SLOT,
  GENESIS_TIME,
  EPOCHS_PER_FRAME,
  SECONDS_PER_EPOCH,
  SECONDS_PER_FRAME,
  SLOTS_PER_FRAME,
  computeSlotAt,
  computeEpochAt,
  computeEpochFirstSlot,
  computeEpochFirstSlotAt,
  computeTimestampAtSlot,
  computeTimestampAtEpoch,
  ZERO_HASH,
  HASH_1,
  HASH_2,
  HASH_3,
  HASH_4,
  HASH_5,
  CONSENSUS_VERSION,
  UNREACHABLE_QUORUM,
  deployBaseOracle
} = require('./base-oracle-deploy.test')

contract('BaseOracle', ([admin, member]) => {
  let consensus
  let baseOracle
  let initialRefSlot

  const deployContract = async () => {
    const deployed = await deployBaseOracle(admin, { initialEpoch: 1 })
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
      assert.emits(tx, 'ConsensusContractSet', { addr: newConsensusContract.address, prevAddr: consensus.address })
      const addressAtStorage = await baseOracle.getConsensusContract()
      assert.addressEqual(addressAtStorage, newConsensusContract.address)
    })
  })

  describe('setConsensusVersion updates contract state', () => {
    before(deployContract)

    it('reverts on same version', async () => {
      await assert.revertsWithCustomError(baseOracle.setConsensusVersion(1), 'VersionCannotBeSame()')
    })

    it('sets updated version', async () => {
      const tx = await baseOracle.setConsensusVersion(2)
      assert.emits(tx, 'ConsensusVersionSet', { version: 2, prevVersion: 1 })
      const versionInState = await baseOracle.getConsensusVersion()
      assert.equal(versionInState, 2)
    })
  })
})
