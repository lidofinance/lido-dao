const hre = require('hardhat')
const { EvmSnapshot } = require('../helpers/blockchain')
const { deployProtocol } = require('../helpers/protocol')

contract('StakingRouter', () => {
  const snapshot = new EvmSnapshot(hre.ethers.provider)
  let deployed

  before(async () => {
    deployed = await deployProtocol({})

    await snapshot.make()
  })
  describe('deposit', async () => {
    after(async () => {
      await snapshot.revert()
    })

    
  })
})
