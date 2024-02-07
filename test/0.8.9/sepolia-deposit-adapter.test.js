const { artifacts, contract, ethers } = require('hardhat')
const { assert } = require('../helpers/assert')

const { EvmSnapshot } = require('../helpers/blockchain')

const SepoliaDepositAdapter = artifacts.require('SepoliaDepositAdapter')

contract('SepoliaDepositAdapter impl', ([deployer]) => {
  let depositAdapter
  let snapshot
  const sepoliaDepositAdapterContract = '0x899e45316FaA439200b36c7d7733192530e3DfC0'
  const sepoliaDepositContract = '0x7f02C3E3c98b133055B8B348B2Ac625669Ed295D'
  const bepoliaTokenHolder = '0x388Ea662EF2c223eC0B047D41Bf3c0f362142ad5'
  const EOAddress = '0x6885E36BFcb68CB383DfE90023a462C03BCB2AE5'

  before('deploy lido with dao', async () => {
    depositAdapter = await SepoliaDepositAdapter.at(sepoliaDepositAdapterContract)
    const dna = await depositAdapter.TEST_VALUE()
    console.log(dna)

    const bepoliaToken = await ethers.getContractAt('SepoliaDepositContract', sepoliaDepositContract)
    const bepoliaStartBalance = await bepoliaToken.balanceOf(bepoliaTokenHolder)

    const impersonatedSigner = await ethers.getImpersonatedSigner(bepoliaTokenHolder)
    await impersonatedSigner.sendTransaction({ to: EOAddress, value: ethers.utils.parseEther('2.0') })

    const bepoliaTokensToTransfer = 1
    bepoliaToken.connect(impersonatedSigner).transfer(EOAddress, bepoliaTokensToTransfer)

    const bepoliaOwnTokens = await bepoliaToken.balanceOf(EOAddress)
    assert.equals(bepoliaOwnTokens, bepoliaTokensToTransfer)

    const bepoliaEndBalance = await bepoliaToken.balanceOf(bepoliaTokenHolder)
    assert.equals(bepoliaEndBalance, bepoliaStartBalance - bepoliaTokensToTransfer)
    console.log(bepoliaEndBalance)

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
