const { contract, ethers } = require('hardhat')
const { assert } = require('../helpers/assert')

const { EvmSnapshot } = require('../helpers/blockchain')

contract('SepoliaDepositAdapter impl', ([deployer]) => {
  let depositAdapter
  let snapshot
  let bepoliaToken
  // const sepoliaDepositAdapterContract = '0x899e45316FaA439200b36c7d7733192530e3DfC0'
  const sepoliaDepositContract = '0x7f02C3E3c98b133055B8B348B2Ac625669Ed295D'
  const EOAddress = '0x6885E36BFcb68CB383DfE90023a462C03BCB2AE5'
  const bepoliaTokenHolder = EOAddress
  // const log = console.log
  const log = () => {}

  before('deploy lido with dao', async () => {
    // depositAdapter = await SepoliaDepositAdapter.at(sepoliaDepositAdapterContract)
    depositAdapter = await ethers.deployContract('SepoliaDepositAdapter', [sepoliaDepositContract])
    log('depositAdapter address', depositAdapter.address)

    const depositAdapterVersion = await depositAdapter.VERSION()
    assert.equals(depositAdapterVersion, 2)

    bepoliaToken = await ethers.getContractAt('ISepoliaDepositContract', sepoliaDepositContract)

    snapshot = new EvmSnapshot(ethers.provider)
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  describe('SepoliaDepositAdapter Logic', () => {
    it(`transfer Bepolia tokens`, async () => {
      const adapterAddr = depositAdapter.address
      const BEPOLIA_TO_TRANSFER = 2
      const bepoliaHolderInitialBalance = await bepoliaToken.balanceOf(bepoliaTokenHolder)
      const impersonatedSigner = await ethers.getImpersonatedSigner(bepoliaTokenHolder)

      log('bepoliaHolderInitialBalance', bepoliaHolderInitialBalance)
      await bepoliaToken.connect(impersonatedSigner).transfer(adapterAddr, BEPOLIA_TO_TRANSFER)

      assert.equals(await bepoliaToken.balanceOf(adapterAddr), BEPOLIA_TO_TRANSFER)

      const bepoliaHolderEndBalance = await bepoliaToken.balanceOf(bepoliaTokenHolder)
      assert.equals(bepoliaHolderEndBalance, bepoliaHolderInitialBalance - BEPOLIA_TO_TRANSFER)
      log('bepoliaHolderEndBalance', bepoliaHolderEndBalance)

      // Drain Bepolia tokens
      await depositAdapter.drainBepolia()

      const bepoliaTokensOnAdapter = await bepoliaToken.balanceOf(adapterAddr)
      assert.equals(bepoliaTokensOnAdapter, 0)

      const [owner] = await ethers.getSigners()
      const bepoliaTokenHolderEnd = await bepoliaToken.balanceOf(owner.address)
      assert.equals(bepoliaTokenHolderEnd, BEPOLIA_TO_TRANSFER)
    })

    it(`call deposit on Adapter`, async () => {
      const key = '0x90823dc2e5ab8a52a0b32883ea8451cbe4c921a42ce439f4fb306a90e9f267e463241da7274b6d44c2e4b95ddbcb0ad3'
      const withdrawalCredentials = '0x005bfe00d82068a0c2a6687afaf969dad5a9c663cb492815a65d203885aaf993'
      const sig =
        '0x802899068eb4b37c95d46869947cac42b9c65b90fcb3fde3854c93ad5737800c01e9c82e174c8ed5cc18210bd60a94ea0082a850817b1dddd4096059b6846417b05094c59d3dd7f4028ed9dff395755f9905a88015b0ed200a7ec1ed60c24922'
      const dataRoot = '0x8b09ed1d0fb3b8e3bb8398c6b77ee3d8e4f67c23cb70555167310ef02b06e5f5'

      const adapterAddr = depositAdapter.address

      const balance0ETH = await ethers.provider.getBalance(adapterAddr)
      assert.equals(balance0ETH, 0)

      const impersonatedSigner = await ethers.getImpersonatedSigner(bepoliaTokenHolder)
      await depositAdapter.connect(impersonatedSigner)
      // Transfer 1 Bepolia token to depositCaller
      await bepoliaToken.connect(impersonatedSigner).transfer(adapterAddr, 1)

      const [owner] = await ethers.getSigners()
      // log('owner', owner.address);
      // await owner.sendTransaction({
      //   to: adapterAddr,
      //   value: ethers.utils.parseEther("10.0"), // Sends exactly 1.0 ether
      // });

      const bepoliaTokenHolderBalance = await bepoliaToken.balanceOf(bepoliaTokenHolder)
      const adapterBepoliaBalance = await bepoliaToken.balanceOf(adapterAddr)
      log('bepoliaTokenHolder and adapter balances: ', bepoliaTokenHolderBalance, adapterBepoliaBalance)
      // We need to have exactly 1 Bepolia token in the adapter
      assert.equals(adapterBepoliaBalance, 1)

      const result = await depositAdapter.test()
      assert.equals(result, 'Sepolia deposit contract token')

      const depositRootBefore = await depositAdapter.get_deposit_root()
      log('depositRoot', depositRootBefore)
      const depositCountBefore = await depositAdapter.get_deposit_count()
      log('depositCount', depositCountBefore)

      await depositAdapter.deposit(key, withdrawalCredentials, sig, dataRoot, {
        from: owner.address,
        value: ethers.utils.parseEther('32.0'),
      })
      const depositRootAfter = await depositAdapter.get_deposit_root()
      log('depositRoot After', depositRootAfter)
      const depositCountAfter = await depositAdapter.get_deposit_count()
      log('depositCount After', depositCountAfter)
      assert.notEqual(depositRootBefore, depositRootAfter)
      assert.equals(BigInt(depositCountBefore) + BigInt('0x0100000000000000'), BigInt(depositCountAfter))

      const ethAfterDeposit = await ethers.provider.getBalance(adapterAddr)
      log('ethAfterDeposit', ethAfterDeposit.toString())
      assert.equals(ethAfterDeposit, '32000000000000000000')

      await depositAdapter.drain()
      const balanceEthAfterDrain = await ethers.provider.getBalance(adapterAddr)
      log('balanceEthAfterDrain', balanceEthAfterDrain.toString())
      assert.equals(balanceEthAfterDrain, 0)

      const adapterBepoliaBalanceAfter = await bepoliaToken.balanceOf(adapterAddr)
      assert.equals(adapterBepoliaBalanceAfter, 0)
    })
  })
})
