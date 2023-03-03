const { contract, ethers } = require('hardhat')
const { assert } = require('../helpers/assert')
const { impersonate } = require('../helpers/blockchain')

const { legacyOracleFactory } = require('../helpers/factories')

const {
  deployAccountingOracleSetup,
  initAccountingOracle,
  EPOCHS_PER_FRAME,
  SLOTS_PER_EPOCH,
  SECONDS_PER_SLOT,
  GENESIS_TIME,
} = require('../0.8.9/oracle/accounting-oracle-deploy.test')

async function deployLegacyOracle({ admin, initialEpoch = 1, lastProcessingRefSlot = 31 }) {
  const legacyOracle = await legacyOracleFactory({ appManager: { address: admin } })
  const { locatorAddr, consensus, oracle, lido } = await deployAccountingOracleSetup(admin, {
    initialEpoch,
    legacyOracleAddrArg: legacyOracle.address,
    getLegacyOracle: () => {
      return legacyOracle
    },
  })
  await legacyOracle.initialize(locatorAddr, consensus.address)
  await initAccountingOracle({ admin, oracle, consensus, shouldMigrateLegacyOracle: false, lastProcessingRefSlot })
  return { legacyOracle, consensus, accountingOracle: oracle, lido }
}

module.exports = {
  deployLegacyOracle,
}

contract('LegacyOracle', ([admin, stranger]) => {
  let legacyOracle, accountingOracle, lido, consensus

  context('Fresh deploy and puppet methods checks', () => {
    before('deploy', async () => {
      const deployed = await deployLegacyOracle({ admin })
      legacyOracle = deployed.legacyOracle
      accountingOracle = deployed.accountingOracle
      lido = deployed.lido
      consensus = deployed.consensus
    })

    it('initial state is correct', async () => {
      assert.equals(await legacyOracle.getVersion(), 4)
      assert.equals(await legacyOracle.getAccountingOracle(), accountingOracle.address)
      assert.equals(await legacyOracle.getLido(), lido.address)
      const spec = await legacyOracle.getBeaconSpec()
      assert.equals(spec.epochsPerFrame, EPOCHS_PER_FRAME)
      assert.equals(spec.slotsPerEpoch, SLOTS_PER_EPOCH)
      assert.equals(spec.secondsPerSlot, SECONDS_PER_SLOT)
      assert.equals(spec.genesisTime, GENESIS_TIME)
      const frame = await consensus.getCurrentFrame()
      const epochId = frame.refSlot.addn(1).divn(SLOTS_PER_EPOCH)
      assert.equals(await legacyOracle.getCurrentEpochId(), epochId)
      assert.equals(await legacyOracle.getLastCompletedEpochId(), 0)
    })

    it('handlePostTokenRebase performs AC, emits event and changes state', async () => {
      await impersonate(ethers.provider, lido.address)
      await assert.reverts(
        legacyOracle.handlePostTokenRebase(1, 2, 3, 4, 5, 6, 7, { from: stranger }),
        'SENDER_NOT_ALLOWED'
      )
      const tx = await legacyOracle.handlePostTokenRebase(1, 2, 3, 4, 5, 6, 7, { from: lido.address })
      assert.emits(tx, 'PostTotalShares', {
        postTotalPooledEther: 6,
        preTotalPooledEther: 4,
        timeElapsed: 2,
        totalShares: 5,
      })
      const delta = await legacyOracle.getLastCompletedReportDelta()
      assert.equals(delta.postTotalPooledEther, 6)
      assert.equals(delta.preTotalPooledEther, 4)
      assert.equals(delta.timeElapsed, 2)
    })

    it('handleConsensusLayerReport performs AC, emits event and changes state', async () => {
      const refSlot = 3000
      await impersonate(ethers.provider, accountingOracle.address)
      await assert.reverts(
        legacyOracle.handleConsensusLayerReport(refSlot, 2, 3, { from: stranger }),
        'SENDER_NOT_ALLOWED'
      )
      const tx = await legacyOracle.handleConsensusLayerReport(refSlot, 2, 3, { from: accountingOracle.address })
      const epochId = Math.floor((refSlot + 1) / SLOTS_PER_EPOCH)
      assert.emits(tx, 'Completed', {
        epochId,
        beaconBalance: 2,
        beaconValidators: 3,
      })
      const completedEpoch = await legacyOracle.getLastCompletedEpochId()
      assert.equals(completedEpoch, epochId)
    })
  })

  context('Migration from old contract', () => {
    it.skip('deploy')
  })
})
