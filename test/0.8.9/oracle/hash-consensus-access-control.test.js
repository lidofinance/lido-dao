const { ethers, contract, web3, artifacts } = require('hardhat')

const { MaxUint256 } = require('@ethersproject/constants')
const { ZERO_BYTES32 } = require('../../helpers/constants')
const { assert } = require('../../helpers/assert')
const { EvmSnapshot } = require('../../helpers/blockchain')

const { deployHashConsensus, EPOCHS_PER_FRAME, CONSENSUS_VERSION } = require('./hash-consensus-deploy.test')

const MockReportProcessor = artifacts.require('MockReportProcessor')

contract('HashConsensus', ([admin, account1, account2, member1, member2]) => {
  let consensus = null
  let reportProcessor = null
  let snapshot = null
  let reportProcessor2 = null

  const manageMembersAndQuorumRoleKeccak156 = web3.utils.keccak256('MANAGE_MEMBERS_AND_QUORUM_ROLE')
  const disableConsensusRoleKeccak156 = web3.utils.keccak256('DISABLE_CONSENSUS_ROLE')
  const manageFrameConfigRoleKeccak156 = web3.utils.keccak256('MANAGE_FRAME_CONFIG_ROLE')
  const manageReportProcessorRoleKeccak156 = web3.utils.keccak256('MANAGE_REPORT_PROCESSOR_ROLE')
  const manageFastLineConfigRoleKeccak156 = web3.utils.keccak256('MANAGE_FAST_LANE_CONFIG_ROLE')

  const deploy = async (options = undefined) => {
    const deployed = await deployHashConsensus(admin, options)
    consensus = deployed.consensus
    reportProcessor = deployed.reportProcessor

    reportProcessor2 = await MockReportProcessor.new(CONSENSUS_VERSION, { from: admin })

    snapshot = new EvmSnapshot(ethers.provider)
    await snapshot.make()
  }

  context('DEFAULT_ADMIN_ROLE', () => {
    const DEFAULT_ADMIN_ROLE = ZERO_BYTES32

    before(async () => {
      await deploy({ initialEpoch: null })
    })

    afterEach(async () => {
      await snapshot.rollback()
    })

    context('updateInitialEpoch', () => {
      it('reverts when called without DEFAULT_ADMIN_ROLE', async () => {
        assert.revertsOZAccessControl(
          consensus.updateInitialEpoch(10, { from: account1 }),
          account1,
          'DEFAULT_ADMIN_ROLE'
        )

        await consensus.grantRole(manageFrameConfigRoleKeccak156, account2)

        assert.revertsOZAccessControl(
          consensus.updateInitialEpoch(10, { from: account2 }),
          account2,
          'DEFAULT_ADMIN_ROLE'
        )
      })

      it('allows calling from a possessor of DEFAULT_ADMIN_ROLE role', async () => {
        await consensus.grantRole(DEFAULT_ADMIN_ROLE, account2, { from: admin })
        await consensus.updateInitialEpoch(10, { from: account2 })
        assert.equals((await consensus.getFrameConfig()).initialEpoch, 10)
      })
    })
  })

  context('deploying', () => {
    before(deploy)

    it('deploying hash consensus', async () => {
      assert.isNotNull(consensus)
      assert.isNotNull(reportProcessor)
    })
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  context('MANAGE_MEMBERS_AND_QUORUM_ROLE', () => {
    context('addMember', () => {
      it('should revert without MANAGE_MEMBERS_AND_QUORUM_ROLE role', async () => {
        await assert.revertsOZAccessControl(
          consensus.addMember(member1, 2, { from: account1 }),
          account1,
          'MANAGE_MEMBERS_AND_QUORUM_ROLE'
        )
        assert.equal(await consensus.getIsMember(member1), false)
        assert.equals(await consensus.getQuorum(), 0)
      })

      it('should allow calling from a possessor of MANAGE_MEMBERS_AND_QUORUM_ROLE role', async () => {
        await consensus.grantRole(manageMembersAndQuorumRoleKeccak156, account2)
        await consensus.addMember(member2, 1, { from: account2 })

        assert.equal(await consensus.getIsMember(member2), true)
        assert.equals(await consensus.getQuorum(), 1)
      })
    })

    context('removeMember', () => {
      it('should revert without MANAGE_MEMBERS_AND_QUORUM_ROLE role', async () => {
        await assert.revertsOZAccessControl(
          consensus.removeMember(member1, 2, { from: account1 }),
          account1,
          'MANAGE_MEMBERS_AND_QUORUM_ROLE'
        )
        assert.equal(await consensus.getIsMember(member1), false)
        assert.equals(await consensus.getQuorum(), 0)
      })

      it('should allow calling from a possessor of MANAGE_MEMBERS_AND_QUORUM_ROLE role', async () => {
        await consensus.grantRole(manageMembersAndQuorumRoleKeccak156, account2)
        await consensus.addMember(member2, 1, { from: account2 })
        assert.equal(await consensus.getIsMember(member2), true)

        await consensus.removeMember(member2, 1, { from: account2 })
        assert.equal(await consensus.getIsMember(member2), false)

        assert.equals(await consensus.getQuorum(), 1)
      })
    })

    context('setQuorum', () => {
      it('should revert without MANAGE_MEMBERS_AND_QUORUM_ROLE role', async () => {
        await assert.revertsOZAccessControl(
          consensus.setQuorum(1, { from: account1 }),
          account1,
          'MANAGE_MEMBERS_AND_QUORUM_ROLE'
        )
        assert.equals(await consensus.getQuorum(), 0)
      })

      it('should allow calling from a possessor of MANAGE_MEMBERS_AND_QUORUM_ROLE role', async () => {
        await consensus.grantRole(manageMembersAndQuorumRoleKeccak156, account2)
        await consensus.setQuorum(1, { from: account2 })

        assert.equals(await consensus.getQuorum(), 1)
      })
    })

    context('disableConsensus', () => {
      it('should revert without MANAGE_MEMBERS_AND_QUORUM_ROLE role', async () => {
        await assert.revertsOZAccessControl(
          consensus.disableConsensus({ from: account1 }),
          account1,
          'DISABLE_CONSENSUS_ROLE'
        )
        assert.equals(await consensus.getQuorum(), 0)
      })
    })
  })

  context('DISABLE_CONSENSUS_ROLE', () => {
    context('setQuorum', () => {
      it('should revert without DISABLE_CONSENSUS_ROLE role', async () => {
        await assert.revertsOZAccessControl(
          consensus.setQuorum(MaxUint256, { from: account1 }),
          account1,
          'DISABLE_CONSENSUS_ROLE'
        )
        assert.equals(await consensus.getQuorum(), 0)
      })

      it('should allow calling from a possessor of DISABLE_CONSENSUS_ROLE role', async () => {
        await consensus.grantRole(disableConsensusRoleKeccak156, account2)
        await consensus.setQuorum(MaxUint256, { from: account2 })

        assert.equals(await consensus.getQuorum(), MaxUint256)
      })
    })

    context('disableConsensus', () => {
      it('should revert without DISABLE_CONSENSUS_ROLE role', async () => {
        await assert.revertsOZAccessControl(
          consensus.disableConsensus({ from: account1 }),
          account1,
          'DISABLE_CONSENSUS_ROLE'
        )
        assert.equals(await consensus.getQuorum(), 0)
      })

      it('should allow calling from a possessor of DISABLE_CONSENSUS_ROLE role', async () => {
        await consensus.grantRole(disableConsensusRoleKeccak156, account2)
        await consensus.disableConsensus({ from: account2 })

        assert.equals(await consensus.getQuorum(), MaxUint256)
      })
    })
  })

  context('MANAGE_FRAME_CONFIG_ROLE', () => {
    context('setFrameConfig', () => {
      it('should revert without MANAGE_FRAME_CONFIG_ROLE role', async () => {
        await assert.revertsOZAccessControl(
          consensus.setFrameConfig(5, 0, { from: account1 }),
          account1,
          'MANAGE_FRAME_CONFIG_ROLE'
        )
        assert.equals((await consensus.getFrameConfig()).epochsPerFrame, EPOCHS_PER_FRAME)
      })

      it('should allow calling from a possessor of MANAGE_FRAME_CONFIG_ROLE role', async () => {
        await consensus.grantRole(manageFrameConfigRoleKeccak156, account2)
        await consensus.setFrameConfig(5, 0, { from: account2 })

        assert.equals((await consensus.getFrameConfig()).epochsPerFrame, 5)
      })
    })
  })

  context('MANAGE_REPORT_PROCESSOR_ROLE', () => {
    context('setReportProcessor', async () => {
      it('should revert without MANAGE_REPORT_PROCESSOR_ROLE role', async () => {
        await assert.revertsOZAccessControl(
          consensus.setReportProcessor(reportProcessor2.address, { from: account1 }),
          account1,
          'MANAGE_REPORT_PROCESSOR_ROLE'
        )
      })

      it('should allow calling from a possessor of MANAGE_REPORT_PROCESSOR_ROLE role', async () => {
        await consensus.grantRole(manageReportProcessorRoleKeccak156, account2)
        await consensus.setReportProcessor(reportProcessor2.address, { from: account2 })

        assert.equals(await consensus.getReportProcessor(), reportProcessor2.address)
      })
    })
  })

  context('MANAGE_FAST_LANE_CONFIG_ROLE', () => {
    context('setFastLaneLengthSlots', () => {
      it('should revert without MANAGE_FAST_LANE_CONFIG_ROLE role', async () => {
        await assert.revertsOZAccessControl(
          consensus.setFastLaneLengthSlots(5, { from: account1 }),
          account1,
          'MANAGE_FAST_LANE_CONFIG_ROLE'
        )
      })

      it('should allow calling from a possessor of MANAGE_FAST_LANE_CONFIG_ROLE role', async () => {
        await consensus.grantRole(manageFastLineConfigRoleKeccak156, account2)
        await consensus.setFastLaneLengthSlots(64, { from: account2 })

        assert.equals((await consensus.getFrameConfig()).fastLaneLengthSlots, 64)
      })
    })
  })
})
