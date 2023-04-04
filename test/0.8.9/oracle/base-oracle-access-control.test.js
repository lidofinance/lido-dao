const { contract, web3, artifacts, ethers } = require('hardhat')
const { assert } = require('../../helpers/assert')
const { EvmSnapshot } = require('../../helpers/blockchain')

const {
  deployBaseOracle,
  EPOCHS_PER_FRAME,
  SECONDS_PER_EPOCH,
  SECONDS_PER_SLOT,
  GENESIS_TIME,
  INITIAL_FAST_LANE_LENGTH_SLOTS,
  INITIAL_EPOCH,
  CONSENSUS_VERSION,
  HASH_1,
  SLOTS_PER_FRAME,
} = require('./base-oracle-deploy.test')

const MockConsensusContract = artifacts.require('MockConsensusContract')

contract('BaseOracle', ([admin, account1, account2, member1, member2]) => {
  let oracle = null
  let consensus = null
  let snapshot = null
  const manageConsensusContractRoleKeccak156 = web3.utils.keccak256('MANAGE_CONSENSUS_CONTRACT_ROLE')
  const manageConsensusVersionRoleKeccak156 = web3.utils.keccak256('MANAGE_CONSENSUS_VERSION_ROLE')

  const deploy = async (options = undefined) => {
    snapshot = new EvmSnapshot(ethers.provider)
    const deployed = await deployBaseOracle(admin, options)
    oracle = deployed.oracle
    consensus = deployed.consensusContract
    await snapshot.make()
  }

  const rollback = async () => {
    await snapshot.rollback()
  }

  before(deploy)

  context('deploying', () => {
    after(rollback)

    it('deploying oracle', async () => {
      assert.isNotNull(oracle)
      assert.isNotNull(consensus)
    })
  })

  context('MANAGE_CONSENSUS_CONTRACT_ROLE', () => {
    afterEach(rollback)

    context('setConsensusContract', () => {
      it('should revert without MANAGE_CONSENSUS_CONTRACT_ROLE role', async () => {
        await assert.revertsOZAccessControl(
          oracle.setConsensusContract(member1, { from: account1 }),
          account1,
          'MANAGE_CONSENSUS_CONTRACT_ROLE'
        )

        assert.equal(await oracle.getConsensusContract(), consensus.address)
      })

      it('should allow calling from a possessor of MANAGE_CONSENSUS_CONTRACT_ROLE role', async () => {
        const consensusContract2 = await MockConsensusContract.new(
          SECONDS_PER_EPOCH,
          SECONDS_PER_SLOT,
          GENESIS_TIME,
          EPOCHS_PER_FRAME,
          INITIAL_EPOCH,
          INITIAL_FAST_LANE_LENGTH_SLOTS,
          admin,
          { from: admin }
        )

        await oracle.grantRole(manageConsensusContractRoleKeccak156, account2, { from: admin })
        await oracle.setConsensusContract(consensusContract2.address, { from: account2 })

        assert.equal(await oracle.getConsensusContract(), consensusContract2.address)
      })
    })
  })

  context('MANAGE_CONSENSUS_VERSION_ROLE', () => {
    afterEach(rollback)

    context('setConsensusVersion', () => {
      it('should revert without MANAGE_CONSENSUS_VERSION_ROLE role', async () => {
        await assert.revertsOZAccessControl(
          oracle.setConsensusVersion(1, { from: account1 }),
          account1,
          'MANAGE_CONSENSUS_VERSION_ROLE'
        )

        assert.equal(await oracle.getConsensusVersion(), CONSENSUS_VERSION)
      })

      it('should allow calling from a possessor of MANAGE_CONSENSUS_VERSION_ROLE role', async () => {
        await oracle.grantRole(manageConsensusVersionRoleKeccak156, account2, { from: admin })
        await oracle.setConsensusVersion(2, { from: account2 })

        assert.equal(await oracle.getConsensusVersion(), 2)
      })
    })
  })

  context('CONSENSUS_CONTRACT', () => {
    afterEach(rollback)

    context('submitConsensusReport', async () => {
      const initialRefSlot = +(await oracle.getTime())

      it('should revert from not a consensus contract', async () => {
        await assert.revertsWithCustomError(
          oracle.submitConsensusReport(HASH_1, initialRefSlot, initialRefSlot, { from: account1 }),
          'SenderIsNotTheConsensusContract()'
        )

        assert.equals((await oracle.getConsensusReportLastCall()).callCount, 0)
      })

      it('should allow calling from a consensus contract', async () => {
        await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, initialRefSlot + SLOTS_PER_FRAME)

        assert.equals((await oracle.getConsensusReportLastCall()).callCount, 1)
      })
    })
  })

  context('CONSENSUS_CONTRACT', () => {
    afterEach(rollback)

    context('submitConsensusReport', () => {
      let initialRefSlot = null

      before(async () => {
        initialRefSlot = +(await oracle.getTime())
      })

      it('should revert from not a consensus contract', async () => {
        await assert.revertsWithCustomError(
          oracle.submitConsensusReport(HASH_1, initialRefSlot, initialRefSlot, { from: account1 }),
          'SenderIsNotTheConsensusContract()'
        )

        assert.equals((await oracle.getConsensusReportLastCall()).callCount, 0)
      })

      it('should allow calling from a consensus contract', async () => {
        await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, initialRefSlot + SLOTS_PER_FRAME)

        assert.equals((await oracle.getConsensusReportLastCall()).callCount, 1)
      })

      it('should allow to discard report from a consensus contract', async () => {
        await consensus.submitReportAsConsensus(HASH_1, initialRefSlot, initialRefSlot + SLOTS_PER_FRAME)
        assert.equals((await oracle.getConsensusReportLastCall()).callCount, 1)
        await consensus.discardReportAsConsensus(initialRefSlot)
      })

      it('should revert on discard from stranger', async () => {
        await assert.revertsWithCustomError(
          oracle.discardConsensusReport(initialRefSlot),
          'SenderIsNotTheConsensusContract()'
        )
      })
    })
  })
})
