const hre = require('hardhat')
const { assert } = require('../helpers/assert')
const { EvmSnapshot } = require('../helpers/blockchain')
const { shares, ETH, shareRate, setBalance } = require('../helpers/utils')

const ERC721ReceiverMock = hre.artifacts.require('ERC721ReceiverMock')

const { deployWithdrawalQueue } = require('./withdrawal-queue-deploy.test')

hre.contract(
  'WithdrawalNFT',
  ([deployer, stEthHolder, wstEthHolder, nftHolderStETH, nftHolderWstETH, recipient, stranger]) => {
    let withdrawalQueueERC721, stETH, wstETH, erc721ReceiverMock
    let nftHolderStETHTokenIds, nftHolderWstETHTokenIds, nonExistedTokenId
    const snapshot = new EvmSnapshot(hre.ethers.provider)

    before(async () => {
      erc721ReceiverMock = await ERC721ReceiverMock.new({ from: deployer })

      const deployed = await deployWithdrawalQueue({
        stethOwner: deployer,
        queueOwner: deployer,
        queuePauser: deployer,
        queueResumer: deployer,
        queueFinalizer: deployer,
        queueBunkerReporter: deployer,
        queueName: 'Lido TEST Request',
        symbol: 'unstEsT'
      })

      stETH = deployed.steth
      wstETH = deployed.wsteth
      withdrawalQueueERC721 = deployed.withdrawalQueue

      await setBalance(stETH.address, ETH(100))

      await stETH.setTotalPooledEther(ETH(101))
      await stETH.mintShares(stEthHolder, shares(50))
      await stETH.mintShares(wstETH.address, shares(50))
      await wstETH.mint(wstEthHolder, ETH(25))

      await stETH.approve(withdrawalQueueERC721.address, ETH(50), { from: stEthHolder })
      await wstETH.approve(withdrawalQueueERC721.address, ETH(25), { from: wstEthHolder })
      await withdrawalQueueERC721.requestWithdrawals([ETH(25), ETH(25)], nftHolderStETH, { from: stEthHolder })
      nftHolderStETHTokenIds = [1, 2]
      await withdrawalQueueERC721.requestWithdrawalsWstETH([ETH(25)], nftHolderWstETH, { from: wstEthHolder })
      nftHolderWstETHTokenIds = [3]
      nonExistedTokenId = 4
      await snapshot.make()
    })

    afterEach(async () => {
      await snapshot.rollback()
    })

    describe('ERC721Metadata', () => {
      it('Initial properties', async () => {
        assert.equals(await withdrawalQueueERC721.symbol(), "unstEsT")
        assert.equals(await withdrawalQueueERC721.name(), "Lido TEST Request")
      })
    })

    describe('supportsInterface()', () => {
      it('returns true for IERC165 interfaceiId (0x01ffc9a7)', async () => {
        assert.isTrue(await withdrawalQueueERC721.supportsInterface('0x01ffc9a7'))
      })
      it('returns true for IERC721 interface id (0x80ac58cd)', async () => {
        assert.isTrue(await withdrawalQueueERC721.supportsInterface('0x80ac58cd'))
      })
      it('returns true for AccessControlEnumerable interface id (0x5a05180f)', async () => {
        assert.isTrue(await withdrawalQueueERC721.supportsInterface('0x5a05180f'))
      })
      it('returns false for unsupported e interface id (0xffffffff)', async () => {
        assert.isFalse(await withdrawalQueueERC721.supportsInterface('0xffffffff'))
      })
      it('returns false for unsupported e interface id (0xdeadbeaf)', async () => {
        assert.isFalse(await withdrawalQueueERC721.supportsInterface('0xdeadbeaf'))
      })
    })

    describe('balanceOf()', () => {
      it('return 0 when user has not withdrawal requests', async () => {
        assert.equals(await withdrawalQueueERC721.balanceOf(recipient), 0)
      })

      it('return correct withdrawal requests count', async () => {
        assert.equals(await withdrawalQueueERC721.balanceOf(nftHolderStETH), 2)
        assert.equals(await withdrawalQueueERC721.balanceOf(nftHolderWstETH), 1)
      })
    })

    describe('ownerOf()', () => {
      it('reverts with error InvalidRequestId() when token id is 0', async () => {
        await assert.reverts(withdrawalQueueERC721.ownerOf(0), `InvalidRequestId(0)`)
      })

      it('reverts with error InvalidRequestId() when called with non existed token id', async () => {
        await assert.reverts(withdrawalQueueERC721.ownerOf(nonExistedTokenId), `InvalidRequestId(${nonExistedTokenId})`)
      })

      it('reverts correct owner', async () => {
        assert.equal(await withdrawalQueueERC721.ownerOf(nftHolderStETHTokenIds[0]), nftHolderStETH)
        assert.equal(await withdrawalQueueERC721.ownerOf(nftHolderStETHTokenIds[1]), nftHolderStETH)
        assert.equal(await withdrawalQueueERC721.ownerOf(nftHolderWstETHTokenIds[0]), nftHolderWstETH)
      })
    })

    describe('approve()', async () => {
      it('reverts with message "ApprovalToOwner()" when approval for owner address', async () => {
        await assert.reverts(
          withdrawalQueueERC721.approve(nftHolderStETH, nftHolderStETHTokenIds[0], { from: nftHolderStETH }),
          'ApprovalToOwner()'
        )
      })

      it('reverts with message "NotOwnerOrApprovedForAll()" when called noy by owner', async () => {
        await assert.reverts(
          withdrawalQueueERC721.approve(recipient, nftHolderStETHTokenIds[0], { from: stranger }),
          `NotOwnerOrApprovedForAll("${stranger}")`
        )
      })

      it('sets approval for address', async () => {
        await withdrawalQueueERC721.approve(recipient, nftHolderStETHTokenIds[0], { from: nftHolderStETH })
        assert.equal(await withdrawalQueueERC721.getApproved(nftHolderStETHTokenIds[0]), recipient)
      })
    })

    describe('getApproved()', async () => {
      it('reverts with message "InvalidRequestId()" when called with non existed token id', async () => {
        await assert.reverts(
          withdrawalQueueERC721.getApproved(nonExistedTokenId),
          `InvalidRequestId(${nonExistedTokenId})`
        )
      })
    })

    describe('setApprovalForAll()', async () => {
      it('reverts with message "ApproveToCaller()" when owner equal to operator', async () => {
        await assert.reverts(
          withdrawalQueueERC721.setApprovalForAll(nftHolderStETH, true, { from: nftHolderStETH }),
          'ApproveToCaller()'
        )
      })
    })

    describe('safeTransferFrom(address,address,uint256)', async () => {
      it('reverts with message "NotOwnerOrApproved()" when approvalNotSet and not owner', async () => {
        await assert.reverts(
          withdrawalQueueERC721.safeTransferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], {
            from: stranger
          }),
          `NotOwnerOrApproved("${stranger}")`
        )
      })

      it('transfers if called by owner', async () => {
        assert.notEqual(await withdrawalQueueERC721.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        await withdrawalQueueERC721.safeTransferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], {
          from: nftHolderStETH
        })
        assert.equal(await withdrawalQueueERC721.ownerOf(nftHolderStETHTokenIds[0]), recipient)
      })

      it('transfers if token approval set', async () => {
        await withdrawalQueueERC721.approve(recipient, nftHolderStETHTokenIds[0], { from: nftHolderStETH })
        assert.notEqual(await withdrawalQueueERC721.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        await withdrawalQueueERC721.safeTransferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], {
          from: recipient
        })
        assert.equal(await withdrawalQueueERC721.ownerOf(nftHolderStETHTokenIds[0]), recipient)
      })

      it('transfers if operator approval set', async () => {
        await withdrawalQueueERC721.setApprovalForAll(recipient, true, { from: nftHolderStETH })
        assert.notEqual(await withdrawalQueueERC721.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        assert.notEqual(await withdrawalQueueERC721.ownerOf(nftHolderStETHTokenIds[1]), recipient)
        await withdrawalQueueERC721.safeTransferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], {
          from: recipient
        })
        await withdrawalQueueERC721.safeTransferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[1], {
          from: recipient
        })
        assert.equal(await withdrawalQueueERC721.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        assert.equal(await withdrawalQueueERC721.ownerOf(nftHolderStETHTokenIds[1]), recipient)
      })

      it('reverts with message "TransferToNonIERC721Receiver()" when transfer to contract that not implements IERC721Receiver interface', async () => {
        await assert.reverts(
          withdrawalQueueERC721.safeTransferFrom(nftHolderWstETH, stETH.address, nftHolderWstETHTokenIds[0], {
            from: nftHolderWstETH
          }),
          `TransferToNonIERC721Receiver("${stETH.address}")`
        )
      })

      it('reverts with propagated error message when recipient contract implements ERC721Receiver and reverts on onERC721Received call', async () => {
        await erc721ReceiverMock.setDoesAcceptTokens(false, { from: deployer })
        await assert.reverts(
          withdrawalQueueERC721.safeTransferFrom(nftHolderStETH, erc721ReceiverMock.address, nftHolderStETHTokenIds[0], {
            from: nftHolderStETH
          }),
          'ERC721_NOT_ACCEPT_TOKENS'
        )
      })

      it("doesn't revert when recipient contract implements ERC721Receiver interface and accepts tokens", async () => {
        await erc721ReceiverMock.setDoesAcceptTokens(true, { from: deployer })
        assert.notEqual(await withdrawalQueueERC721.ownerOf(nftHolderStETHTokenIds[0]), erc721ReceiverMock.address)
        await withdrawalQueueERC721.safeTransferFrom(
          nftHolderStETH,
          erc721ReceiverMock.address,
          nftHolderStETHTokenIds[0],
          {
            from: nftHolderStETH
          }
        )
        assert.equal(await withdrawalQueueERC721.ownerOf(nftHolderStETHTokenIds[0]), erc721ReceiverMock.address)
      })
    })

    describe('transferFrom()', async () => {
      it('reverts with message "NotOwnerOrApproved()" when approvalNotSet and not owner', async () => {
        await assert.reverts(
          withdrawalQueueERC721.transferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], { from: stranger }),
          `NotOwnerOrApproved("${stranger}")`
        )
      })

      it('reverts when transfer to the same address', async () => {
        await assert.reverts(
          withdrawalQueueERC721.transferFrom(
            nftHolderWstETH, nftHolderWstETH, nftHolderWstETHTokenIds[0],
            {from: nftHolderWstETH }
          ),
          'TransferToThemselves()'
        )
      })

      it('reverts with error "RequestAlreadyClaimed()" when called on claimed request', async () => {
        const batch = await withdrawalQueueERC721.finalizationBatch(3, shareRate(1))
        await withdrawalQueueERC721.finalize(3, { from: deployer, value: batch.ethToLock })
        const ownerETHBefore = await hre.ethers.provider.getBalance(nftHolderStETH)
        const tx = await withdrawalQueueERC721.methods['claimWithdrawal(uint256)'](nftHolderStETHTokenIds[0], {
          from: nftHolderStETH
        })
        const ownerETHAfter = await hre.ethers.provider.getBalance(nftHolderStETH)
        // adhoc fix for solidity-coverage that ignores gasPrice = 0
        assert.almostEqual(ownerETHAfter, ownerETHBefore.add(ETH(25)), tx.receipt.gasUsed)

        await assert.reverts(
          withdrawalQueueERC721.transferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], {
            from: nftHolderStETH
          }),
          `RequestAlreadyClaimed(${nftHolderStETHTokenIds[0]})`
        )
      })

      it('transfers if called by owner', async () => {
        assert.notEqual(await withdrawalQueueERC721.ownerOf(nftHolderWstETHTokenIds[0]), recipient)
        await withdrawalQueueERC721.transferFrom(nftHolderWstETH, recipient, nftHolderWstETHTokenIds[0], {
          from: nftHolderWstETH
        })
        assert.equal(await withdrawalQueueERC721.ownerOf(nftHolderWstETHTokenIds[0]), recipient)
      })

      it('transfers if token approval set', async () => {
        await withdrawalQueueERC721.approve(recipient, nftHolderStETHTokenIds[0], { from: nftHolderStETH })
        assert.notEqual(await withdrawalQueueERC721.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        await withdrawalQueueERC721.transferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], {
          from: recipient
        })
        assert.equal(await withdrawalQueueERC721.ownerOf(nftHolderStETHTokenIds[0]), recipient)
      })

      it('transfers if operator approval set', async () => {
        await withdrawalQueueERC721.setApprovalForAll(recipient, true, { from: nftHolderStETH })
        assert.notEqual(await withdrawalQueueERC721.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        assert.notEqual(await withdrawalQueueERC721.ownerOf(nftHolderStETHTokenIds[1]), recipient)
        await withdrawalQueueERC721.transferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], {
          from: recipient
        })
        await withdrawalQueueERC721.transferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[1], {
          from: recipient
        })
        assert.equal(await withdrawalQueueERC721.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        assert.equal(await withdrawalQueueERC721.ownerOf(nftHolderStETHTokenIds[1]), recipient)
      })

      it('can claim request after transfer', async () => {
        await withdrawalQueueERC721.transferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], {
          from: nftHolderStETH
        })
        assert.equal(await withdrawalQueueERC721.ownerOf(nftHolderStETHTokenIds[0]), recipient)

        const batch = await withdrawalQueueERC721.finalizationBatch(3, shareRate(1))
        await withdrawalQueueERC721.finalize(3, { from: deployer, value: batch.ethToLock })

        const recipientETHBefore = await hre.ethers.provider.getBalance(recipient)
        const tx = await withdrawalQueueERC721.methods['claimWithdrawal(uint256)'](nftHolderStETHTokenIds[0], {
          from: recipient
        })
        const recipientETHAfter = await hre.ethers.provider.getBalance(recipient)
        // adhoc fix for solidity-coverage that ignores gasPrice = 0
        assert.almostEqual(recipientETHAfter, recipientETHBefore.add(ETH(25)), tx.receipt.gasUsed)
      })

      it("doesn't reverts when transfer to contract that not implements IERC721Receiver interface", async () => {
        assert.equal(await withdrawalQueueERC721.ownerOf(nftHolderWstETHTokenIds[0]), nftHolderWstETH)
        await withdrawalQueueERC721.transferFrom(nftHolderWstETH, stETH.address, nftHolderWstETHTokenIds[0], {
          from: nftHolderWstETH
        })
        assert.equal(await withdrawalQueueERC721.ownerOf(nftHolderWstETHTokenIds[0]), stETH.address)
      })
    })

    describe('Burn', () => {
      it('balanceOf decreases after claim', async () => {
        const balanceBefore = await withdrawalQueueERC721.balanceOf(nftHolderStETH);

        const batch = await withdrawalQueueERC721.finalizationBatch(3, shareRate(1))
        await withdrawalQueueERC721.finalize(3, { from: deployer, value: batch.ethToLock })

        await withdrawalQueueERC721.methods['claimWithdrawal(uint256)'](nftHolderStETHTokenIds[0], {
          from: nftHolderStETH
        })

        assert.equals(balanceBefore - await withdrawalQueueERC721.balanceOf(nftHolderStETH), 1)
      })
    })
  }
)
