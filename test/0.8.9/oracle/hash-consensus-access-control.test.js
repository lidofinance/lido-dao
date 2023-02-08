const { MaxUint256 } = require('@ethersproject/constants')
const { assert } = require('../../helpers/assert')

const { deployHashConsensus, EPOCHS_PER_FRAME } = require('./hash-consensus-deploy.test')

contract('HashConsensus', ([admin, account1, account2, member1, member2, stranger]) => {
  let consensus = null
  let reportProcessor = null
  const manageMembersAndQuorumRoleKeccak156 = web3.utils.keccak256('MANAGE_MEMBERS_AND_QUORUM_ROLE')
  const disableConsensusRoleKeccak156 = web3.utils.keccak256('DISABLE_CONSENSUS_ROLE')
  const manageFrameConfigRoleKeccak156 = web3.utils.keccak256('MANAGE_FRAME_CONFIG_ROLE')
  const manageReportProcessorRoleKeccak156 = web3.utils.keccak256('MANAGE_REPORT_PROCESSOR_ROLE')
  const manageFastLineConfigRoleKeccak156 = web3.utils.keccak256('MANAGE_FAST_LANE_CONFIG_ROLE')

  const deploy = async (options = undefined) => {
    const deployed = await deployHashConsensus(admin, options)
    consensus = deployed.consensus
    reportProcessor = deployed.reportProcessor
  }

  context('deploying', () => {
    before(deploy)

    it('deploying hash consensus', async () => {
      assert.isNotNull(consensus)
      assert.isNotNull(reportProcessor)
    })
  })

  context('MANAGE_MEMBERS_AND_QUORUM_ROLE', () => {
    const errorMessage = `AccessControl: account ${account1.toLowerCase()} is missing role ${manageMembersAndQuorumRoleKeccak156}`

    beforeEach(deploy)

    context('addMember', () => {
      it('should revert without manage members and qourum role', async () => {
        await assert.reverts(consensus.addMember(member1, 2, { from: account1 }), errorMessage)
        assert.equal(await consensus.getIsMember(member1), false)
        assert.equal(+(await consensus.getQuorum()), 0)
      })

      it('should check manage members and qourum role', async () => {
        await consensus.grantRole(manageMembersAndQuorumRoleKeccak156, account2)
        await consensus.addMember(member2, 1, { from: account2 })

        assert.equal(await consensus.getIsMember(member2), true)
        assert.equal(+(await consensus.getQuorum()), 1)
      })
    })

    context('removeMember', () => {
      it('should revert without manage members and qourum role', async () => {
        await assert.reverts(consensus.removeMember(member1, 2, { from: account1 }), errorMessage)
        assert.equal(await consensus.getIsMember(member1), false)
        assert.equal(+(await consensus.getQuorum()), 0)
      })

      it('should check manage members and qourum role', async () => {
        await consensus.grantRole(manageMembersAndQuorumRoleKeccak156, account2)
        await consensus.addMember(member2, 1, { from: account2 })
        assert.equal(await consensus.getIsMember(member2), true)

        await consensus.removeMember(member2, 1, { from: account2 })
        assert.equal(await consensus.getIsMember(member2), false)

        assert.equal(+(await consensus.getQuorum()), 1)
      })
    })

    context('setQuorum', () => {
      it('should revert without manage members and qourum role', async () => {
        await assert.reverts(consensus.setQuorum(1, { from: account1 }), errorMessage)
        assert.equal(+(await consensus.getQuorum()), 0)
      })

      it('should check manage members and qourum role', async () => {
        await consensus.grantRole(manageMembersAndQuorumRoleKeccak156, account2)
        await consensus.setQuorum(1, { from: account2 })

        assert.equal(+(await consensus.getQuorum()), 1)
      })
    })

    context('disableConsensus', () => {
      it('should revert without manage members and qourum role', async () => {
        const errorMessage = `AccessControl: account ${account1.toLowerCase()} is missing role ${disableConsensusRoleKeccak156}`

        await assert.reverts(consensus.disableConsensus({ from: account1 }), errorMessage)
        assert.equal(+(await consensus.getQuorum()), 0)
      })
    })
  })

  context('DISABLE_CONSENSUS_ROLE', () => {
    const errorMessage = `AccessControl: account ${account1.toLowerCase()} is missing role ${disableConsensusRoleKeccak156}`

    beforeEach(deploy)

    context('setQuorum', () => {
      it('should revert without disable consensus role', async () => {
        await assert.reverts(consensus.setQuorum(MaxUint256, { from: account1 }), errorMessage)
        assert.equal(+(await consensus.getQuorum()), 0)
      })

      it('should check disable consensus role', async () => {
        await consensus.grantRole(disableConsensusRoleKeccak156, account2)
        await consensus.setQuorum(MaxUint256, { from: account2 })

        assert.equal(+(await consensus.getQuorum()), MaxUint256)
      })
    })

    context('disableConsensus', () => {
      it('should revert without disable consensus role', async () => {
        await assert.reverts(consensus.disableConsensus({ from: account1 }), errorMessage)
        assert.equal(+(await consensus.getQuorum()), 0)
      })

      it('should check disable consensus role', async () => {
        await consensus.grantRole(disableConsensusRoleKeccak156, account2)
        await consensus.disableConsensus({ from: account2 })

        assert.equal(+(await consensus.getQuorum()), MaxUint256)
      })
    })
  })

  context('MANAGE_FRAME_CONFIG_ROLE', () => {
    const errorMessage = `AccessControl: account ${account1.toLowerCase()} is missing role ${manageFrameConfigRoleKeccak156}`

    beforeEach(deploy)

    context('setFrameConfig', () => {
      it('should revert without manage frame config role', async () => {
        await assert.reverts(consensus.setFrameConfig(5, 0, { from: account1 }), errorMessage)
        assert.equal(+(await consensus.getFrameConfig()).epochsPerFrame, EPOCHS_PER_FRAME)
      })

      it('should check manage frame config role', async () => {
        await consensus.grantRole(manageFrameConfigRoleKeccak156, account2)
        await consensus.setFrameConfig(5, 0, { from: account2 })

        assert.equal(+(await consensus.getFrameConfig()).epochsPerFrame, 5)
      })
    })
  })

  context('MANAGE_REPORT_PROCESSOR_ROLE', () => {
    const errorMessage = `AccessControl: account ${account1.toLowerCase()} is missing role ${manageReportProcessorRoleKeccak156}`

    beforeEach(deploy)

    context('setReportProcessor', () => {
      it('should revert without manage report processor role', async () => {
        await assert.reverts(consensus.setReportProcessor(member1, { from: account1 }), errorMessage)
      })
    })
  })

  context('MANAGE_FAST_LANE_CONFIG_ROLE', () => {
    const errorMessage = `AccessControl: account ${account1.toLowerCase()} is missing role ${manageFastLineConfigRoleKeccak156}`

    beforeEach(deploy)

    context('setFastLaneLengthSlots', () => {
      it('should revert without manage fast lane config role', async () => {
        await assert.reverts(consensus.setFastLaneLengthSlots(member1, { from: account1 }), errorMessage)
      })
    })
  })
})
