const { contract, ethers, web3 } = require('hardhat')
const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

const { ETH, StETH, shareRate, shares } = require('../helpers/utils')
const { assert } = require('../helpers/assert')
const { impersonate, EvmSnapshot, setBalance } = require('../helpers/blockchain')

const {
  deployWithdrawalQueue,
  QUEUE_NAME,
  QUEUE_SYMBOL,
  NFT_DESCRIPTOR_BASE_URI,
} = require('./withdrawal-queue-deploy.test')

contract('WithdrawalQueue', ([owner, stranger, daoAgent, user, tokenUriManager]) => {
  let withdrawalQueue, steth, nftDescriptor

  const manageTokenUriRoleKeccak156 = web3.utils.keccak256('MANAGE_TOKEN_URI_ROLE')
  const snapshot = new EvmSnapshot(ethers.provider)

  before('Deploy', async () => {
    const deployed = await deployWithdrawalQueue({
      stethOwner: owner,
      queueAdmin: daoAgent,
      queuePauser: daoAgent,
      queueResumer: daoAgent,
      queueFinalizer: daoAgent,
    })

    steth = deployed.steth
    withdrawalQueue = deployed.withdrawalQueue
    nftDescriptor = deployed.nftDescriptor

    await steth.setTotalPooledEther(ETH(600))
    // we need 1 ETH additionally to pay gas on finalization because coverage ingnores gasPrice=0
    await setBalance(steth.address, ETH(600 + 1))
    await steth.mintShares(user, shares(1))
    await steth.approve(withdrawalQueue.address, StETH(300), { from: user })
    await withdrawalQueue.grantRole(manageTokenUriRoleKeccak156, tokenUriManager, { from: daoAgent })

    await impersonate(ethers.provider, steth.address)
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  it('Initial properties', async () => {
    assert.equals(await withdrawalQueue.isPaused(), false)
    assert.equals(await withdrawalQueue.getLastRequestId(), 0)
    assert.equals(await withdrawalQueue.getLastFinalizedRequestId(), 0)
    assert.equals(await withdrawalQueue.getLastCheckpointIndex(), 0)
    assert.equals(await withdrawalQueue.unfinalizedStETH(), StETH(0))
    assert.equals(await withdrawalQueue.unfinalizedRequestNumber(), 0)
    assert.equals(await withdrawalQueue.getLockedEtherAmount(), ETH(0))
  })

  context('constructor', function () {
    it('should set name and symbol', async function () {
      assert.equals(await withdrawalQueue.name(), QUEUE_NAME)
      assert.equals(await withdrawalQueue.symbol(), QUEUE_SYMBOL)
    })
  })

  context('supportsInterface', async () => {
    it('supports ERC165', async () => {
      assert.isTrue(await withdrawalQueue.supportsInterface('0x01ffc9a7'))
    })

    it('supports ERC721', async () => {
      assert.isTrue(await withdrawalQueue.supportsInterface('0x80ac58cd'))
    })

    it('supports ERC721Metadata', async () => {
      assert.isTrue(await withdrawalQueue.supportsInterface('0x5b5e139f'))
    })

    it('not supports interface not supported', async () => {
      assert.isFalse(await withdrawalQueue.supportsInterface('0x12345678'))
    })
  })

  context('name', async () => {
    it('returns name', async () => {
      assert.equals(await withdrawalQueue.name(), QUEUE_NAME)
    })
  })

  context('symbol', async () => {
    it('returns symbol', async () => {
      assert.equals(await withdrawalQueue.symbol(), QUEUE_SYMBOL)
    })
  })

  context('tokenURI', async () => {
    const requestId = 1
    const baseTokenUri = 'https://example.com/'

    beforeEach(async function () {
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
    })

    it('returns tokenURI without nftDescriptor', async () => {
      await withdrawalQueue.setBaseURI(baseTokenUri, { from: tokenUriManager })
      assert.equals(await withdrawalQueue.tokenURI(1), `${baseTokenUri}${requestId}`)
    })

    it('returns tokenURI without nftDescriptor and baseUri', async () => {
      assert.equals(await withdrawalQueue.tokenURI(1), '')
    })

    it('returns tokenURI with nftDescriptor', async () => {
      await withdrawalQueue.setNFTDescriptorAddress(nftDescriptor.address, { from: tokenUriManager })

      assert.equals(await withdrawalQueue.tokenURI(1), `${NFT_DESCRIPTOR_BASE_URI}${requestId}`)
    })

    it('revert on invalid token id', async () => {
      await assert.reverts(withdrawalQueue.tokenURI(0), 'InvalidRequestId(0)')
    })

    it('should set baseURI and return', async () => {
      await withdrawalQueue.setBaseURI(baseTokenUri, { from: tokenUriManager })
      assert.equals(await withdrawalQueue.getBaseURI(), baseTokenUri)
    })

    it('should set nftDescriptorAddress and return', async () => {
      await withdrawalQueue.setNFTDescriptorAddress(nftDescriptor.address, { from: tokenUriManager })
      assert.equals(await withdrawalQueue.getNFTDescriptorAddress(), nftDescriptor.address)
    })
  })

  context('balanceOf', () => {
    it('should return 0 for not existing', async () => {
      assert.equals(await withdrawalQueue.balanceOf(stranger), 0)
    })

    it('should return 1 after request', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25)], user, { from: user })
      assert.equals(await withdrawalQueue.balanceOf(user), 1)
    })

    it('should return 2 after request', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
      assert.equals(await withdrawalQueue.balanceOf(user), 2)
    })

    it('should return 0 after claim', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25)], user, { from: user })
      assert.equals(await withdrawalQueue.balanceOf(user), 1)

      const batch = await withdrawalQueue.finalizationBatch(1, shareRate(1))
      await withdrawalQueue.finalize(1, { from: daoAgent, value: batch.ethToLock })
      await withdrawalQueue.claimWithdrawal(1, { from: user })

      assert.equals(await withdrawalQueue.balanceOf(user), 0)
    })

    it('should revert with ZeroAddress', async () => {
      await assert.reverts(withdrawalQueue.balanceOf(ZERO_ADDRESS), `InvalidOwnerAddress("${ZERO_ADDRESS}")`)
    })
  })

  context('ownerOf', () => {
    it('should revert with not existing', async () => {
      await assert.reverts(withdrawalQueue.ownerOf(1), 'InvalidRequestId(1)')
    })
    it('should return owner after request', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25)], user, { from: user })
      assert.equals(await withdrawalQueue.ownerOf(1), user)
    })

    it('should revert after claim', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25)], user, { from: user })
      assert.equals(await withdrawalQueue.ownerOf(1), user)

      const batch = await withdrawalQueue.finalizationBatch(1, shareRate(1))
      await withdrawalQueue.finalize(1, { from: daoAgent, value: batch.ethToLock })
      await withdrawalQueue.claimWithdrawal(1, { from: user })

      await assert.reverts(withdrawalQueue.ownerOf(1), 'RequestAlreadyClaimed(1)')
    })
  })

  context('getApproved', () => {
    it('should revert with invalid request id', async () => {
      await assert.reverts(withdrawalQueue.getApproved(1), 'InvalidRequestId(1)')
    })

    it('should return zero address for not approved', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25)], user, { from: user })
      assert.equals(await withdrawalQueue.getApproved(1), ZERO_ADDRESS)
    })

    it('should return approved address', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25)], user, { from: user })
      await withdrawalQueue.approve(stranger, 1, { from: user })
      assert.equals(await withdrawalQueue.getApproved(1), stranger)
    })
  })

  context('isApprovedForAll', () => {
    it('should return false for not approved', async () => {
      assert.isFalse(await withdrawalQueue.isApprovedForAll(user, stranger))
    })

    it('should return true for approved', async () => {
      await withdrawalQueue.setApprovalForAll(stranger, true, { from: user })
      assert.isTrue(await withdrawalQueue.isApprovedForAll(user, stranger))
    })
  })

  context('mint', async () => {
    it('should mint', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })

      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.tokenURI(1), '')
    })

    it('should mint with tokenURI', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
      await withdrawalQueue.setBaseURI('https://example.com/', { from: tokenUriManager })

      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.tokenURI(1), 'https://example.com/1')
    })

    it('should mint with nftDescriptor', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
      await withdrawalQueue.setNFTDescriptorAddress(nftDescriptor.address, { from: tokenUriManager })
      nftDescriptor.setBaseTokenURI('https://nftDescriptor.com/')

      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.tokenURI(1), 'https://nftDescriptor.com/1')
    })

    it('should mint more after request', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.ownerOf(2), user)

      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })

      assert.equals(await withdrawalQueue.balanceOf(user), 4)
      assert.equals(await withdrawalQueue.ownerOf(3), user)
      assert.equals(await withdrawalQueue.ownerOf(4), user)
    })
  })

  context('burn', async () => {
    it('should burn', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })

      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.ownerOf(2), user)

      const batch = await withdrawalQueue.finalizationBatch(1, shareRate(1))
      await withdrawalQueue.finalize(1, { from: daoAgent, value: batch.ethToLock })
      await withdrawalQueue.claimWithdrawal(1, { from: user })

      assert.equals(await withdrawalQueue.balanceOf(user), 1)
      assert.equals(await withdrawalQueue.ownerOf(2), user)
      await assert.reverts(withdrawalQueue.ownerOf(1), 'RequestAlreadyClaimed(1)')
    })

    it('revert on claim not owner', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })

      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.ownerOf(2), user)

      const batch = await withdrawalQueue.finalizationBatch(1, shareRate(1))
      await withdrawalQueue.finalize(1, { from: daoAgent, value: batch.ethToLock })

      await assert.reverts(withdrawalQueue.claimWithdrawal(1, { from: stranger }), `NotOwner("${stranger}", "${user}")`)

      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.ownerOf(2), user)
    })

    it('revert on claim not existing', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })

      await assert.reverts(withdrawalQueue.claimWithdrawal(1, { from: user }), 'RequestNotFoundOrNotFinalized(1)')
    })

    it('should burn more after request', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.ownerOf(2), user)

      const batch = await withdrawalQueue.finalizationBatch(2, shareRate(1))
      await withdrawalQueue.finalize(2, { from: daoAgent, value: batch.ethToLock })
      await withdrawalQueue.claimWithdrawal(1, { from: user })

      assert.equals(await withdrawalQueue.balanceOf(user), 1)
      assert.equals(await withdrawalQueue.ownerOf(2), user)
      await assert.reverts(withdrawalQueue.ownerOf(1), 'RequestAlreadyClaimed(1)')

      await withdrawalQueue.claimWithdrawal(2, { from: user })

      assert.equals(await withdrawalQueue.balanceOf(user), 0)
    })

    it('should burn after transfer', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.ownerOf(2), user)

      await withdrawalQueue.transferFrom(user, stranger, 1, { from: user })

      assert.equals(await withdrawalQueue.balanceOf(user), 1)
      assert.equals(await withdrawalQueue.ownerOf(2), user)
      assert.equals(await withdrawalQueue.ownerOf(1), stranger)

      const batch = await withdrawalQueue.finalizationBatch(2, shareRate(1))
      await withdrawalQueue.finalize(2, { from: daoAgent, value: batch.ethToLock })
      await withdrawalQueue.claimWithdrawal(2, { from: user })

      assert.equals(await withdrawalQueue.balanceOf(user), 0)
    })

    it('should revert on transfer himself', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.ownerOf(2), user)

      await assert.reverts(withdrawalQueue.transferFrom(user, user, 1, { from: user }), 'TransferToThemselves()')
    })

    it('should revert on transfer not owner', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.ownerOf(2), user)

      await assert.reverts(
        withdrawalQueue.transferFrom(user, stranger, 1, { from: stranger }),
        `NotOwnerOrApproved("${stranger}")`
      )
    })

    it('should burn after approve and transfer ', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25), ETH(25)], user, { from: user })
      assert.equals(await withdrawalQueue.balanceOf(user), 3)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.ownerOf(2), user)
      assert.equals(await withdrawalQueue.ownerOf(3), user)

      await withdrawalQueue.approve(stranger, 2, { from: user })
      await withdrawalQueue.approve(stranger, 3, { from: user })

      assert.equals(await withdrawalQueue.balanceOf(user), 3)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.ownerOf(2), user)
      assert.equals(await withdrawalQueue.ownerOf(3), user)

      await withdrawalQueue.transferFrom(user, stranger, 3, { from: stranger })

      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.balanceOf(stranger), 1)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.ownerOf(2), user)
      assert.equals(await withdrawalQueue.ownerOf(3), stranger)

      const batch = await withdrawalQueue.finalizationBatch(3, shareRate(1))
      await withdrawalQueue.finalize(3, { from: daoAgent, value: batch.ethToLock })
      await withdrawalQueue.claimWithdrawal(1, { from: user })
      await withdrawalQueue.claimWithdrawal(3, { from: stranger })

      assert.equals(await withdrawalQueue.balanceOf(user), 1)
      assert.equals(await withdrawalQueue.balanceOf(stranger), 0)

      await assert.reverts(withdrawalQueue.claimWithdrawal(2, { from: stranger }), `NotOwner("${stranger}", "${user}")`)

      assert.equals(await withdrawalQueue.balanceOf(user), 1)
    })
  })
})
