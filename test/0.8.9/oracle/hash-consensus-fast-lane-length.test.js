const { contract } = require('hardhat')
const { assert } = require('../../helpers/assert')

const { deployHashConsensus } = require('./hash-consensus-deploy.test')

contract('HashConsensus', ([admin, member1, member2, stranger]) => {
  context('Fast Lane Length', () => {
    let consensus

    const deploy = async (options = undefined) => {
      const deployed = await deployHashConsensus(admin, options)
      consensus = deployed.consensus
    }

    context('initial data', () => {
      it('sets properly', async () => {
        await deploy({ fastLaneLengthSlots: 0 })
        assert.equals((await consensus.getFrameConfig()).fastLaneLengthSlots, 0)
        await deploy({ fastLaneLengthSlots: 4 })
        assert.equals((await consensus.getFrameConfig()).fastLaneLengthSlots, 4)
      })
    })

    context('method setFastLaneLengthSlots', () => {
      beforeEach(deploy)

      const getFastLaneLengthSlotsLimit = async () => {
        const { slotsPerEpoch } = await consensus.getChainConfig()
        const { epochsPerFrame } = await consensus.getFrameConfig()
        return +slotsPerEpoch * +epochsPerFrame
      }

      it('should revert if fastLaneLengthSlots > epochsPerFrame * slotsPerEpoch', async () => {
        const fastLaneLengthSlots = (await getFastLaneLengthSlotsLimit()) + 1
        await assert.reverts(
          consensus.setFastLaneLengthSlots(fastLaneLengthSlots, { from: admin }),
          'FastLanePeriodCannotBeLongerThanFrame()'
        )
      })

      it('sets new value properly', async () => {
        const fastLaneLengthSlots = await getFastLaneLengthSlotsLimit()
        await consensus.setFastLaneLengthSlots(fastLaneLengthSlots, { from: admin })
        assert.equals((await consensus.getFrameConfig()).fastLaneLengthSlots, fastLaneLengthSlots)
      })

      it('emits FastLaneConfigSet event', async () => {
        const fastLaneLengthSlots = await getFastLaneLengthSlotsLimit()
        const tx = await consensus.setFastLaneLengthSlots(fastLaneLengthSlots, { from: admin })
        assert.emits(tx, 'FastLaneConfigSet', { fastLaneLengthSlots })
      })

      it('not emits FastLaneConfigSet if new value is the same', async () => {
        const fastLaneLengthSlots = +(await consensus.getFrameConfig()).fastLaneLengthSlots
        const tx = await consensus.setFastLaneLengthSlots(fastLaneLengthSlots, { from: admin })
        assert.notEmits(tx, 'FastLaneConfigSet', { fastLaneLengthSlots })
      })
    })
  })
})
