const { artifacts, contract, ethers } = require('hardhat')

const { EvmSnapshot } = require('../helpers/blockchain')

const SepoliaDepositAdapter = artifacts.require('SepoliaDepositAdapter')

contract('SepoliaDepositAdapter', ([deployer]) => {
  let depositAdapter
  let snapshot

  before('deploy lido with dao', async () => {
    depositAdapter = await SepoliaDepositAdapter.new(deployer, { from: deployer })
    const dna = await depositAdapter.TEST_VALUE()
    console.log(dna)

    snapshot = new EvmSnapshot(ethers.provider)
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  describe('SepoliaDepositAdapter Logic', () => {
    it(`state after deployment`, async () => {})
  })
})
