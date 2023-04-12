const { contract, ethers, web3, artifacts } = require('hardhat')
const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

const { ETH, StETH, shareRate, shares } = require('../helpers/utils')
const { assert } = require('../helpers/assert')
const { EvmSnapshot, setBalance } = require('../helpers/blockchain')

const ERC721ReceiverMock = artifacts.require('ERC721ReceiverMock')

const {
  deployWithdrawalQueue,
  QUEUE_NAME,
  QUEUE_SYMBOL,
  NFT_DESCRIPTOR_BASE_URI,
} = require('./withdrawal-queue-deploy.test')

contract('WithdrawalQueue', ([owner, stranger, daoAgent, user, tokenUriManager, recipient]) => {
  let withdrawalQueue, steth, nftDescriptor, erc721ReceiverMock

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
    erc721ReceiverMock = await ERC721ReceiverMock.new({ from: owner })

    await steth.setTotalPooledEther(ETH(600))
    // we need 1 ETH additionally to pay gas on finalization because coverage ignores gasPrice=0
    await setBalance(steth.address, ETH(600 + 1))
    await steth.mintShares(user, shares(1))
    await steth.approve(withdrawalQueue.address, StETH(300), { from: user })
    await withdrawalQueue.grantRole(manageTokenUriRoleKeccak156, tokenUriManager, { from: daoAgent })

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

  context('constructor', () => {
    it('should set name and symbol', async function () {
      assert.equals(await withdrawalQueue.name(), QUEUE_NAME)
      assert.equals(await withdrawalQueue.symbol(), QUEUE_SYMBOL)
    })
  })

  context('supportsInterface', () => {
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

  context('name', () => {
    it('returns name', async () => {
      assert.equals(await withdrawalQueue.name(), QUEUE_NAME)
    })
  })

  context('symbol', () => {
    it('returns symbol', async () => {
      assert.equals(await withdrawalQueue.symbol(), QUEUE_SYMBOL)
    })
  })

  context('tokenURI', () => {
    const requestId = 1
    const baseTokenUri = 'https://example.com'

    beforeEach(async function () {
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
    })

    it('returns tokenURI without nftDescriptor', async () => {
      const tx = await withdrawalQueue.setBaseURI(baseTokenUri, { from: tokenUriManager })
      assert.emits(tx, 'BaseURISet', { baseURI: baseTokenUri })

      assert.equals(
        await withdrawalQueue.tokenURI(1),
        `${baseTokenUri}/${requestId}?requested=${ETH(25)}&created_at=${
          (await withdrawalQueue.getWithdrawalStatus([1]))[0].timestamp
        }`
      )
    })

    it('correct tokenURI after finalization', async () => {
      const tx = await withdrawalQueue.setBaseURI(baseTokenUri, { from: tokenUriManager })
      assert.emits(tx, 'BaseURISet', { baseURI: baseTokenUri })

      await withdrawalQueue.finalize(1, shareRate(300), { from: daoAgent, value: ETH(25) })

      assert.equals(
        await withdrawalQueue.tokenURI(1),
        `${baseTokenUri}/${requestId}?requested=${ETH(25)}&created_at=${
          (await withdrawalQueue.getWithdrawalStatus([1]))[0].timestamp
        }&finalized=${(await withdrawalQueue.getClaimableEther([1], [1]))[0]}`
      )
    })

    it('correct tokenURI after finalization with discount', async () => {
      const tx = await withdrawalQueue.setBaseURI(baseTokenUri, { from: tokenUriManager })
      assert.emits(tx, 'BaseURISet', { baseURI: baseTokenUri })

      const batch = await withdrawalQueue.prefinalize([1], shareRate(1))
      await withdrawalQueue.finalize(1, shareRate(1), { from: daoAgent, value: batch.ethToLock })

      assert.equals(
        await withdrawalQueue.tokenURI(1),
        `${baseTokenUri}/${requestId}?requested=${ETH(25)}&created_at=${
          (await withdrawalQueue.getWithdrawalStatus([1]))[0].timestamp
        }&finalized=${batch.sharesToBurn}`
      )
    })

    it('returns tokenURI without nftDescriptor and baseUri', async () => {
      assert.equals(await withdrawalQueue.tokenURI(1), '')
    })

    it('returns tokenURI with nftDescriptor', async () => {
      const tx = await withdrawalQueue.setNFTDescriptorAddress(nftDescriptor.address, { from: tokenUriManager })
      assert.emits(tx, 'NftDescriptorAddressSet', { nftDescriptorAddress: nftDescriptor.address })
      assert.equals(await withdrawalQueue.tokenURI(1), `${NFT_DESCRIPTOR_BASE_URI}${requestId}`)
    })

    it('revert on invalid token id', async () => {
      await assert.reverts(withdrawalQueue.tokenURI(0), 'InvalidRequestId(0)')
    })

    it('should set baseURI and return', async () => {
      const tx = await withdrawalQueue.setBaseURI(baseTokenUri, { from: tokenUriManager })
      assert.emits(tx, 'BaseURISet', { baseURI: baseTokenUri })
      assert.equals(await withdrawalQueue.getBaseURI(), baseTokenUri)
    })

    it('should set nftDescriptorAddress and return', async () => {
      const tx = await withdrawalQueue.setNFTDescriptorAddress(nftDescriptor.address, { from: tokenUriManager })
      assert.emits(tx, 'NftDescriptorAddressSet', { nftDescriptorAddress: nftDescriptor.address })
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

      const batch = await withdrawalQueue.prefinalize([1], shareRate(1))
      await withdrawalQueue.finalize(1, shareRate(1), { from: daoAgent, value: batch.ethToLock })
      await withdrawalQueue.claimWithdrawal(1, { from: user })

      assert.equals(await withdrawalQueue.balanceOf(user), 0)
    })

    it('should revert with ZeroAddress', async () => {
      await assert.reverts(withdrawalQueue.balanceOf(ZERO_ADDRESS), `InvalidOwnerAddress("${ZERO_ADDRESS}")`)
    })
  })

  context('ownerOf', () => {
    it('should revert when token id is 0', async () => {
      await assert.reverts(withdrawalQueue.ownerOf(0), `InvalidRequestId(0)`)
    })

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

      const batch = await withdrawalQueue.prefinalize([1], shareRate(1))
      await withdrawalQueue.finalize(1, shareRate(1), { from: daoAgent, value: batch.ethToLock })
      await withdrawalQueue.claimWithdrawal(1, { from: user })

      await assert.reverts(withdrawalQueue.ownerOf(1), 'RequestAlreadyClaimed(1)')
    })
  })

  context('approve()', () => {
    let tokenId1
    beforeEach(async () => {
      await snapshot.rollback()
      const requestIds = await withdrawalQueue.requestWithdrawals.call([ETH(25), ETH(25)], user, { from: user })
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
      tokenId1 = requestIds[0]
    })

    it('reverts with message "ApprovalToOwner()" when approval for owner address', async () => {
      await assert.reverts(withdrawalQueue.approve(user, tokenId1, { from: user }), 'ApprovalToOwner()')
    })

    it('reverts with message "NotOwnerOrApprovedForAll()" when called noy by owner', async () => {
      await assert.reverts(
        withdrawalQueue.approve(recipient, tokenId1, { from: stranger }),
        `NotOwnerOrApprovedForAll("${stranger}")`
      )
    })

    it('sets approval for address and transfer by approved', async () => {
      const tx = await withdrawalQueue.approve(recipient, tokenId1, { from: user })
      assert.equal(await withdrawalQueue.getApproved(tokenId1), recipient)

      assert.emits(tx, 'Approval', { owner: user, approved: recipient, tokenId: tokenId1 })

      await withdrawalQueue.transferFrom(user, recipient, tokenId1, { from: recipient })
      assert.equals(await withdrawalQueue.ownerOf(tokenId1), recipient)
    })

    it('approval can be revoked', async () => {
      const tx1 = await withdrawalQueue.approve(recipient, tokenId1, { from: user })
      assert.equal(await withdrawalQueue.getApproved(tokenId1), recipient)

      assert.emits(tx1, 'Approval', { owner: user, approved: recipient, tokenId: tokenId1 })

      const tx2 = await withdrawalQueue.approve(ZERO_ADDRESS, tokenId1, { from: user })
      assert.equal(await withdrawalQueue.getApproved(tokenId1), ZERO_ADDRESS)

      assert.emits(tx2, 'Approval', { owner: user, approved: ZERO_ADDRESS, tokenId: tokenId1 })

      await assert.reverts(
        withdrawalQueue.transferFrom(user, recipient, tokenId1, { from: recipient }),
        'NotOwnerOrApproved',
        [`"${recipient}"`]
      )
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
      const tx = await withdrawalQueue.approve(stranger, 1, { from: user })
      assert.emits(tx, 'Approval', { owner: user, approved: stranger, tokenId: 1 })
      assert.equals(await withdrawalQueue.getApproved(1), stranger)
    })
  })

  context('setApprovalForAll()', () => {
    let tokenId1, tokenId2
    beforeEach(async () => {
      await snapshot.rollback()
      const requestIds = await withdrawalQueue.requestWithdrawals.call([ETH(25), ETH(25)], user, {
        from: user,
      })
      tokenId1 = requestIds[0]
      tokenId2 = requestIds[1]
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
    })

    it('reverts with message "ApproveToCaller()" when owner equal to operator', async () => {
      await assert.reverts(withdrawalQueue.setApprovalForAll(user, true, { from: user }), 'ApproveToCaller()')
    })

    it('approvalForAll allows transfer', async () => {
      const tx = await withdrawalQueue.setApprovalForAll(recipient, true, { from: user })
      assert.emits(tx, 'ApprovalForAll', { owner: user, operator: recipient, approved: true })
      assert.isTrue(await withdrawalQueue.isApprovedForAll(user, recipient))

      await withdrawalQueue.transferFrom(user, recipient, tokenId1, { from: recipient })
      await withdrawalQueue.transferFrom(user, recipient, tokenId2, { from: recipient })

      assert.equals(await withdrawalQueue.ownerOf(tokenId1), recipient)
      assert.equals(await withdrawalQueue.ownerOf(tokenId2), recipient)
    })

    it('approvalForAll can be revoked', async () => {
      const tx1 = await withdrawalQueue.setApprovalForAll(recipient, true, { from: user })
      assert.emits(tx1, 'ApprovalForAll', { owner: user, operator: recipient, approved: true })
      assert.isTrue(await withdrawalQueue.isApprovedForAll(user, recipient))

      const tx2 = await withdrawalQueue.setApprovalForAll(recipient, false, { from: user })
      assert.emits(tx2, 'ApprovalForAll', { owner: user, operator: recipient, approved: false })
      assert.isFalse(await withdrawalQueue.isApprovedForAll(user, recipient))

      await assert.reverts(
        withdrawalQueue.transferFrom(user, recipient, tokenId2, { from: recipient }),
        'NotOwnerOrApproved',
        [`"${recipient}"`]
      )
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

  context('safeTransferFrom(address,address,uint256)', () => {
    let requestIds
    beforeEach(async () => {
      requestIds = await withdrawalQueue.requestWithdrawals.call([ETH(25), ETH(25)], user, {
        from: user,
      })
      const tx = await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
      assert.emits(tx, 'Transfer', {
        from: ZERO_ADDRESS,
        to: user,
        tokenId: requestIds[0],
      })
      assert.emits(tx, 'Transfer', {
        from: ZERO_ADDRESS,
        to: user,
        tokenId: requestIds[1],
      })
    })

    it('reverts with message "NotOwnerOrApproved()" when approvalNotSet and not owner', async () => {
      await assert.reverts(
        withdrawalQueue.safeTransferFrom(user, recipient, requestIds[0], {
          from: stranger,
        }),
        `NotOwnerOrApproved("${stranger}")`
      )
    })

    it('transfers if called by owner', async () => {
      assert.notEqual(await withdrawalQueue.ownerOf(requestIds[0]), recipient)
      const tx = await withdrawalQueue.safeTransferFrom(user, recipient, requestIds[0], {
        from: user,
      })
      assert.emits(tx, 'Transfer', {
        from: user,
        to: recipient,
        tokenId: requestIds[0],
      })
      assert.equal(await withdrawalQueue.ownerOf(requestIds[0]), recipient)
    })

    it('transfers if token approval set', async () => {
      const approve_tx = await withdrawalQueue.approve(recipient, requestIds[0], { from: user })
      assert.emits(approve_tx, 'Approval', { owner: user, approved: recipient, tokenId: requestIds[0] })

      assert.notEqual(await withdrawalQueue.ownerOf(requestIds[0]), recipient)
      const tx = await withdrawalQueue.safeTransferFrom(user, recipient, requestIds[0], {
        from: recipient,
      })
      assert.emits(tx, 'Transfer', {
        from: user,
        to: recipient,
        tokenId: requestIds[0],
      })
      assert.equal(await withdrawalQueue.ownerOf(requestIds[0]), recipient)
    })

    it('transfers if operator approval set', async () => {
      await withdrawalQueue.setApprovalForAll(recipient, true, { from: user })
      assert.notEqual(await withdrawalQueue.ownerOf(requestIds[0]), recipient)
      assert.notEqual(await withdrawalQueue.ownerOf(requestIds[1]), recipient)
      const tx1 = await withdrawalQueue.safeTransferFrom(user, recipient, requestIds[0], {
        from: recipient,
      })
      assert.emits(tx1, 'Transfer', {
        from: user,
        to: recipient,
        tokenId: requestIds[0],
      })
      const tx2 = await withdrawalQueue.safeTransferFrom(user, recipient, requestIds[1], {
        from: recipient,
      })
      assert.emits(tx2, 'Transfer', {
        from: user,
        to: recipient,
        tokenId: requestIds[1],
      })
      assert.equal(await withdrawalQueue.ownerOf(requestIds[0]), recipient)
      assert.equal(await withdrawalQueue.ownerOf(requestIds[1]), recipient)
    })

    it('reverts with message "TransferToNonIERC721Receiver()" when transfer to contract that not implements IERC721Receiver interface', async () => {
      await assert.reverts(
        withdrawalQueue.safeTransferFrom(user, steth.address, requestIds[0], {
          from: user,
        }),
        `TransferToNonIERC721Receiver("${steth.address}")`
      )
    })

    it('reverts with propagated error message when recipient contract implements ERC721Receiver and reverts on onERC721Received call', async () => {
      await erc721ReceiverMock.setDoesAcceptTokens(false, { from: owner })
      await assert.reverts(
        withdrawalQueue.safeTransferFrom(user, erc721ReceiverMock.address, requestIds[0], {
          from: user,
        }),
        'ERC721_NOT_ACCEPT_TOKENS'
      )
    })

    it("doesn't revert when recipient contract implements ERC721Receiver interface and accepts tokens", async () => {
      await erc721ReceiverMock.setDoesAcceptTokens(true, { from: owner })
      assert.notEqual(await withdrawalQueue.ownerOf(requestIds[0]), erc721ReceiverMock.address)
      const tx = await withdrawalQueue.safeTransferFrom(user, erc721ReceiverMock.address, requestIds[0], {
        from: user,
      })
      assert.emits(tx, 'Transfer', {
        from: user,
        to: erc721ReceiverMock.address,
        tokenId: requestIds[0],
      })

      assert.equal(await withdrawalQueue.ownerOf(requestIds[0]), erc721ReceiverMock.address)
    })
  })

  describe('transferFrom()', () => {
    let requestIds

    beforeEach(async () => {
      requestIds = await withdrawalQueue.requestWithdrawals.call([ETH(25), ETH(25)], user, {
        from: user,
      })
      const tx = await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
      assert.emits(tx, 'Transfer', {
        from: ZERO_ADDRESS,
        to: user,
        tokenId: requestIds[0],
      })
      assert.emits(tx, 'Transfer', {
        from: ZERO_ADDRESS,
        to: user,
        tokenId: requestIds[1],
      })
    })

    it('reverts with message "NotOwnerOrApproved()" when approvalNotSet and not owner', async () => {
      await assert.reverts(
        withdrawalQueue.transferFrom(user, recipient, requestIds[0], { from: stranger }),
        `NotOwnerOrApproved("${stranger}")`
      )
    })

    it('reverts when transfer to the same address', async () => {
      await assert.reverts(
        withdrawalQueue.transferFrom(user, user, requestIds[0], {
          from: user,
        }),
        'TransferToThemselves()'
      )
    })

    it('reverts with error "RequestAlreadyClaimed()" when called on claimed request', async () => {
      const batch = await withdrawalQueue.prefinalize([2], shareRate(1))
      await withdrawalQueue.finalize(2, shareRate(1), { from: daoAgent, value: batch.ethToLock })

      await withdrawalQueue.methods['claimWithdrawal(uint256)'](requestIds[0], {
        from: user,
      })

      await assert.reverts(
        withdrawalQueue.transferFrom(user, recipient, requestIds[0], {
          from: user,
        }),
        `RequestAlreadyClaimed(${requestIds[0]})`
      )
    })

    it('transfers if called by owner', async () => {
      assert.notEqual(await withdrawalQueue.ownerOf(requestIds[0]), recipient)
      const tx = await withdrawalQueue.transferFrom(user, recipient, requestIds[0], {
        from: user,
      })
      assert.emits(tx, 'Transfer', {
        from: user,
        to: recipient,
        tokenId: requestIds[0],
      })
      assert.equal(await withdrawalQueue.ownerOf(requestIds[0]), recipient)
    })

    it('transfers if token approval set', async () => {
      await withdrawalQueue.approve(recipient, requestIds[0], { from: user })

      assert.notEqual(await withdrawalQueue.ownerOf(requestIds[0]), recipient)
      const tx = await withdrawalQueue.transferFrom(user, recipient, requestIds[0], {
        from: recipient,
      })
      assert.emits(tx, 'Transfer', {
        from: user,
        to: recipient,
        tokenId: requestIds[0],
      })
      assert.equal(await withdrawalQueue.ownerOf(requestIds[0]), recipient)
    })

    it('transfers if operator approval set', async () => {
      await withdrawalQueue.setApprovalForAll(recipient, true, { from: user })
      assert.notEqual(await withdrawalQueue.ownerOf(requestIds[0]), recipient)
      assert.notEqual(await withdrawalQueue.ownerOf(requestIds[1]), recipient)
      const tx1 = await withdrawalQueue.transferFrom(user, recipient, requestIds[0], {
        from: recipient,
      })
      assert.emits(tx1, 'Transfer', {
        from: user,
        to: recipient,
        tokenId: requestIds[0],
      })

      const tx2 = await withdrawalQueue.transferFrom(user, recipient, requestIds[1], {
        from: recipient,
      })

      assert.emits(tx2, 'Transfer', {
        from: user,
        to: recipient,
        tokenId: requestIds[1],
      })

      assert.equal(await withdrawalQueue.ownerOf(requestIds[0]), recipient)
      assert.equal(await withdrawalQueue.ownerOf(requestIds[1]), recipient)
    })

    it('can claim request after transfer', async () => {
      const tx = await withdrawalQueue.transferFrom(user, recipient, requestIds[0], {
        from: user,
      })
      assert.emits(tx, 'Transfer', {
        from: user,
        to: recipient,
        tokenId: requestIds[0],
      })
      assert.equal(await withdrawalQueue.ownerOf(requestIds[0]), recipient)

      const batch = await withdrawalQueue.prefinalize([2], shareRate(1))
      await withdrawalQueue.finalize(2, shareRate(1), { from: daoAgent, value: batch.ethToLock })

      const claim_tx = await withdrawalQueue.methods['claimWithdrawal(uint256)'](requestIds[0], {
        from: recipient,
      })
      assert.emits(claim_tx, 'Transfer', {
        from: recipient,
        to: ZERO_ADDRESS,
        tokenId: requestIds[0],
      })
    })

    it("doesn't reverts when transfer to contract that not implements IERC721Receiver interface", async () => {
      assert.equal(await withdrawalQueue.ownerOf(requestIds[0]), user)
      const tx = await withdrawalQueue.transferFrom(user, steth.address, requestIds[0], {
        from: user,
      })
      assert.emits(tx, 'Transfer', {
        from: user,
        to: steth.address,
        tokenId: requestIds[0],
      })
      assert.equal(await withdrawalQueue.ownerOf(requestIds[0]), steth.address)
    })
  })

  context('mint', () => {
    it('should mint', async () => {
      const tx = await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
      assert.emits(tx, 'Transfer', {
        from: ZERO_ADDRESS,
        to: user,
        tokenId: 1,
      })
      assert.emits(tx, 'Transfer', {
        from: ZERO_ADDRESS,
        to: user,
        tokenId: 2,
      })
      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.tokenURI(1), '')
    })

    it('should mint with tokenURI', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
      await withdrawalQueue.setBaseURI('https://example.com', { from: tokenUriManager })

      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(
        await withdrawalQueue.tokenURI(1),
        `https://example.com/1?requested=25000000000000000000&created_at=${
          (await withdrawalQueue.getWithdrawalStatus([1]))[0].timestamp
        }`
      )
    })

    it('should mint with nftDescriptor', async () => {
      const tx = await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
      assert.emits(tx, 'Transfer', {
        from: ZERO_ADDRESS,
        to: user,
        tokenId: 1,
      })
      assert.emits(tx, 'Transfer', {
        from: ZERO_ADDRESS,
        to: user,
        tokenId: 2,
      })
      await withdrawalQueue.setNFTDescriptorAddress(nftDescriptor.address, { from: tokenUriManager })
      nftDescriptor.setBaseTokenURI('https://nftDescriptor.com/')

      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.tokenURI(1), 'https://nftDescriptor.com/1')
    })

    it('should mint more after request', async () => {
      const tx1 = await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
      assert.emits(tx1, 'Transfer', {
        from: ZERO_ADDRESS,
        to: user,
        tokenId: 1,
      })
      assert.emits(tx1, 'Transfer', {
        from: ZERO_ADDRESS,
        to: user,
        tokenId: 2,
      })
      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.ownerOf(2), user)

      const tx2 = await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
      assert.emits(tx2, 'Transfer', {
        from: ZERO_ADDRESS,
        to: user,
        tokenId: 3,
      })
      assert.emits(tx2, 'Transfer', {
        from: ZERO_ADDRESS,
        to: user,
        tokenId: 4,
      })
      assert.equals(await withdrawalQueue.balanceOf(user), 4)
      assert.equals(await withdrawalQueue.ownerOf(3), user)
      assert.equals(await withdrawalQueue.ownerOf(4), user)
    })
  })

  context('burn', () => {
    it('should burn', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })

      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.ownerOf(2), user)

      const batch = await withdrawalQueue.prefinalize.call([1], shareRate(1))
      await withdrawalQueue.finalize(1, shareRate(1), { from: daoAgent, value: batch.ethToLock })
      const tx = await withdrawalQueue.claimWithdrawal(1, { from: user })

      assert.emits(tx, 'Transfer', {
        from: user,
        to: ZERO_ADDRESS,
        tokenId: 1,
      })

      assert.equals(await withdrawalQueue.balanceOf(user), 1)
      assert.equals(await withdrawalQueue.ownerOf(2), user)
      await assert.reverts(withdrawalQueue.ownerOf(1), 'RequestAlreadyClaimed(1)')
    })

    it('revert on claim not owner', async () => {
      await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })

      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.ownerOf(2), user)

      const batch = await withdrawalQueue.prefinalize.call([1], shareRate(1))
      await withdrawalQueue.finalize(1, shareRate(1), { from: daoAgent, value: batch.ethToLock })

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

      const batch = await withdrawalQueue.prefinalize.call([2], shareRate(1))
      await withdrawalQueue.finalize(2, shareRate(1), { from: daoAgent, value: batch.ethToLock })
      const tx1 = await withdrawalQueue.claimWithdrawal(1, { from: user })

      assert.emits(tx1, 'Transfer', {
        from: user,
        to: ZERO_ADDRESS,
        tokenId: 1,
      })

      assert.equals(await withdrawalQueue.balanceOf(user), 1)
      assert.equals(await withdrawalQueue.ownerOf(2), user)
      await assert.reverts(withdrawalQueue.ownerOf(1), 'RequestAlreadyClaimed(1)')

      const tx2 = await withdrawalQueue.claimWithdrawal(2, { from: user })

      assert.emits(tx2, 'Transfer', {
        from: user,
        to: ZERO_ADDRESS,
        tokenId: 2,
      })

      assert.equals(await withdrawalQueue.balanceOf(user), 0)
    })

    it('should burn after transfer', async () => {
      const mint_tx = await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25)], user, { from: user })
      assert.emits(mint_tx, 'Transfer', {
        from: ZERO_ADDRESS,
        to: user,
        tokenId: 1,
      })
      assert.emits(mint_tx, 'Transfer', {
        from: ZERO_ADDRESS,
        to: user,
        tokenId: 2,
      })

      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.ownerOf(2), user)

      const tx1 = await withdrawalQueue.transferFrom(user, stranger, 1, { from: user })
      assert.emits(tx1, 'Transfer', {
        from: user,
        to: stranger,
        tokenId: 1,
      })

      assert.equals(await withdrawalQueue.balanceOf(user), 1)
      assert.equals(await withdrawalQueue.ownerOf(2), user)
      assert.equals(await withdrawalQueue.ownerOf(1), stranger)

      const batch = await withdrawalQueue.prefinalize.call([2], shareRate(1))
      await withdrawalQueue.finalize(2, shareRate(1), { from: daoAgent, value: batch.ethToLock })
      const tx2 = await withdrawalQueue.claimWithdrawal(2, { from: user })
      assert.emits(tx2, 'Transfer', {
        from: user,
        to: ZERO_ADDRESS,
        tokenId: 2,
      })

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
      const mint_tx = await withdrawalQueue.requestWithdrawals([ETH(25), ETH(25), ETH(25)], user, { from: user })
      assert.emitsNumberOfEvents(mint_tx, 'Transfer', 3)

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

      const transfer_tx1 = await withdrawalQueue.transferFrom(user, stranger, 3, { from: stranger })
      assert.emitsNumberOfEvents(transfer_tx1, 'Transfer', 1)

      assert.equals(await withdrawalQueue.balanceOf(user), 2)
      assert.equals(await withdrawalQueue.balanceOf(stranger), 1)
      assert.equals(await withdrawalQueue.ownerOf(1), user)
      assert.equals(await withdrawalQueue.ownerOf(2), user)
      assert.equals(await withdrawalQueue.ownerOf(3), stranger)

      const batch = await withdrawalQueue.prefinalize.call([3], shareRate(1))
      await withdrawalQueue.finalize(3, shareRate(1), { from: daoAgent, value: batch.ethToLock })
      const claim_tx1 = await withdrawalQueue.claimWithdrawal(1, { from: user })
      assert.emitsNumberOfEvents(claim_tx1, 'Transfer', 1)

      const claim_tx2 = await withdrawalQueue.claimWithdrawal(3, { from: stranger })
      assert.emitsNumberOfEvents(claim_tx2, 'Transfer', 1)

      assert.equals(await withdrawalQueue.balanceOf(user), 1)
      assert.equals(await withdrawalQueue.balanceOf(stranger), 0)

      await assert.reverts(withdrawalQueue.claimWithdrawal(2, { from: stranger }), `NotOwner("${stranger}", "${user}")`)

      assert.equals(await withdrawalQueue.balanceOf(user), 1)
    })
  })
})
