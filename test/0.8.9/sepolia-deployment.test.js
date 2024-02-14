const { artifacts, contract, ethers } = require('hardhat')
const { assert } = require('../helpers/assert')

const { EvmSnapshot } = require('../helpers/blockchain')

const SepoliaDepositAdapter = artifacts.require('SepoliaDepositAdapter')

contract('SepoliaDepositAdapter deployment', ([deployer]) => {
  let depositAdapter
  let snapshot

  before('deploy lido with dao', async () => {
    depositAdapter = await SepoliaDepositAdapter.new(deployer, { from: deployer })

    snapshot = new EvmSnapshot(ethers.provider)
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  describe('SepoliaDepositAdapter Logic', () => {
    it(`state after deployment`, async () => {
      const depositAdapterVersion = await depositAdapter.VERSION()
      assert.equals(depositAdapterVersion, 2)
    })
  })
})
