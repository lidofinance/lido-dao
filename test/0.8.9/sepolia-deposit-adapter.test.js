const { contract, ethers } = require('hardhat')
const { assert } = require('../helpers/assert')

const { EvmSnapshot } = require('../helpers/blockchain')

contract('SepoliaDepositAdapter impl', ([deployer]) => {
  let depositAdapter
  let snapshot
  let bepoliaToken
  // const sepoliaDepositAdapterContract = '0x899e45316FaA439200b36c7d7733192530e3DfC0'
  const sepoliaDepositContract = '0x7f02C3E3c98b133055B8B348B2Ac625669Ed295D'
  const bepoliaTokenHolder = '0x388Ea662EF2c223eC0B047D41Bf3c0f362142ad5'
  // const EOAddress = '0x6885E36BFcb68CB383DfE90023a462C03BCB2AE5'

  before('deploy lido with dao', async () => {
    // depositAdapter = await SepoliaDepositAdapter.at(sepoliaDepositAdapterContract)
    // depositAdapter = await SepoliaDepositAdapter.new(deployer, [sepoliaDepositContract], { from: deployer })
    depositAdapter = await ethers.deployContract('SepoliaDepositAdapter', [sepoliaDepositContract])
    console.log('depositAdapter address', depositAdapter.address)

    const depositAdapterVersion = await depositAdapter.VERSION()
    assert.equals(depositAdapterVersion, 2)

    bepoliaToken = await ethers.getContractAt('SepoliaDepositContract', sepoliaDepositContract)

    snapshot = new EvmSnapshot(ethers.provider)
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  describe('SepoliaDepositAdapter Logic', () => {
    it(`transfer Bepolia tokens`, async () => {
      const depositCaller = depositAdapter.address

      const bepoliaStartBalance = await bepoliaToken.balanceOf(bepoliaTokenHolder)
      console.log('bepoliaStartBalance', bepoliaStartBalance)

      const impersonatedSigner = await ethers.getImpersonatedSigner(bepoliaTokenHolder)

      const bepoliaTokensToTransfer = 2
      await bepoliaToken.connect(impersonatedSigner).transfer(depositCaller, bepoliaTokensToTransfer)

      const bepoliaOwnTokens = await bepoliaToken.balanceOf(depositCaller)
      assert.equals(bepoliaOwnTokens, bepoliaTokensToTransfer)

      const bepoliaEndBalance = await bepoliaToken.balanceOf(bepoliaTokenHolder)
      assert.equals(bepoliaEndBalance, bepoliaStartBalance - bepoliaTokensToTransfer)
      console.log('bepoliaEndBalance', bepoliaEndBalance)
    })

    it(`call deposit on Adapter`, async () => {
      const key = '0x90823dc2e5ab8a52a0b32883ea8451cbe4c921a42ce439f4fb306a90e9f267e463241da7274b6d44c2e4b95ddbcb0ad3'
      const withdrawalCredentials = '0x005bfe00d82068a0c2a6687afaf969dad5a9c663cb492815a65d203885aaf993'
      const sig =
        '0x802899068eb4b37c95d46869947cac42b9c65b90fcb3fde3854c93ad5737800c01e9c82e174c8ed5cc18210bd60a94ea0082a850817b1dddd4096059b6846417b05094c59d3dd7f4028ed9dff395755f9905a88015b0ed200a7ec1ed60c24922'
      const dataRoot = '0x8b09ed1d0fb3b8e3bb8398c6b77ee3d8e4f67c23cb70555167310ef02b06e5f5'

      const depositCaller = depositAdapter.address

      const impersonatedSigner = await ethers.getImpersonatedSigner(bepoliaTokenHolder)

      await depositAdapter.connect(impersonatedSigner)
      await bepoliaToken.connect(impersonatedSigner).transfer(depositCaller, 1)

      const bal3 = await bepoliaToken.balanceOf(bepoliaTokenHolder)
      const bal4 = await bepoliaToken.balanceOf(depositCaller)
      console.log('balances before', bal3, bal4)

      const result = await depositAdapter.test()
      console.log('result', result)
      await depositAdapter.deposit(key, withdrawalCredentials, sig, dataRoot)

      const bal1 = await bepoliaToken.balanceOf(bepoliaTokenHolder)
      const bal2 = await bepoliaToken.balanceOf(depositCaller)
      console.log('balances', bal1, bal2)
    })
  })
})
