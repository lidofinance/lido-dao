const hre = require('hardhat')
const { assert } = require('../helpers/assert')
const { EvmSnapshot } = require('../helpers/blockchain')
const { shares, ETH, shareRate } = require('../helpers/utils')
const withdrawals = require('../helpers/withdrawals')

const StETH = hre.artifacts.require('StETHMock')
const WstETH = hre.artifacts.require('WstETHMock')
const ERC721ReceiverMock = hre.artifacts.require('ERC721ReceiverMock')

hre.contract(
  'WithdrawalNFT',
  ([deployer, stEthHolder, wstEthHolder, nftHolderStETH, nftHolderWstETH, recipient, stranger]) => {
    let withdrawalRequestNFT, stETH, wstETH, erc721ReceiverMock
    let nftHolderStETHTokenIds, nftHolderWstETHTokenIds, nonExistedTokenId
    const snapshot = new EvmSnapshot(hre.ethers.provider)

    before(async () => {
      stETH = await StETH.new({ value: ETH(100), from: deployer })
      wstETH = await WstETH.new(stETH.address, { from: deployer })
      erc721ReceiverMock = await ERC721ReceiverMock.new({ from: deployer })
      withdrawalRequestNFT = (await withdrawals.deploy(deployer, wstETH.address)).queue
      await withdrawalRequestNFT.initialize(
        deployer, // owner
        deployer, // pauser
        deployer, // resumer
        deployer, // finalizer
        deployer
      )
      await withdrawalRequestNFT.resume({ from: deployer })

      await stETH.setTotalPooledEther(ETH(100))
      await stETH.mintShares(stEthHolder, shares(50))
      await stETH.mintShares(wstETH.address, shares(50))
      await wstETH.mint(wstEthHolder, ETH(25))

      await stETH.approve(withdrawalRequestNFT.address, ETH(50), { from: stEthHolder })
      await wstETH.approve(withdrawalRequestNFT.address, ETH(25), { from: wstEthHolder })
      await withdrawalRequestNFT.requestWithdrawals([ETH(25), ETH(25)], nftHolderStETH,{ from: stEthHolder })
      nftHolderStETHTokenIds = [1, 2]
      await withdrawalRequestNFT.requestWithdrawalsWstETH([ETH(25)], nftHolderWstETH, { from: wstEthHolder })
      nftHolderWstETHTokenIds = [3]
      nonExistedTokenId = 4
      await snapshot.make()
    })

    afterEach(async () => {
      await snapshot.rollback()
    })

    describe('ERC721Metadata', () => {
      it('Initial properties', async () => {
        assert.equals(await withdrawalRequestNFT.symbol(), "unstETH")
        assert.equals(await withdrawalRequestNFT.name(), "Lido Withdrawal Request")
      })
    })

    describe('supportsInterface()', () => {
      it('returns true for IERC165 interfaceiId (0x01ffc9a7)', async () => {
        assert.isTrue(await withdrawalRequestNFT.supportsInterface('0x01ffc9a7'))
      })
      it('returns true for IERC721 interface id (0x80ac58cd)', async () => {
        assert.isTrue(await withdrawalRequestNFT.supportsInterface('0x80ac58cd'))
      })
      it('returns true for AccessControlEnumerable interface id (0x5a05180f)', async () => {
        assert.isTrue(await withdrawalRequestNFT.supportsInterface('0x5a05180f'))
      })
      it('returns false for unsupported e interface id (0xffffffff)', async () => {
        assert.isFalse(await withdrawalRequestNFT.supportsInterface('0xffffffff'))
      })
      it('returns false for unsupported e interface id (0xdeadbeaf)', async () => {
        assert.isFalse(await withdrawalRequestNFT.supportsInterface('0xdeadbeaf'))
      })
    })

    describe('balanceOf()', () => {
      it('return 0 when user has not withdrawal requests', async () => {
        assert.equals(await withdrawalRequestNFT.balanceOf(recipient), 0)
      })

      it('return correct withdrawal requests count', async () => {
        assert.equals(await withdrawalRequestNFT.balanceOf(nftHolderStETH), 2)
        assert.equals(await withdrawalRequestNFT.balanceOf(nftHolderWstETH), 1)
      })
    })

    describe('ownerOf()', () => {
      it('reverts with error InvalidRequestId() when token id is 0', async () => {
        await assert.reverts(withdrawalRequestNFT.ownerOf(0), `InvalidRequestId(0)`)
      })

      it('reverts with error InvalidRequestId() when called with non existed token id', async () => {
        await assert.reverts(withdrawalRequestNFT.ownerOf(nonExistedTokenId), `InvalidRequestId(${nonExistedTokenId})`)
      })

      it('reverts correct owner', async () => {
        assert.equal(await withdrawalRequestNFT.ownerOf(nftHolderStETHTokenIds[0]), nftHolderStETH)
        assert.equal(await withdrawalRequestNFT.ownerOf(nftHolderStETHTokenIds[1]), nftHolderStETH)
        assert.equal(await withdrawalRequestNFT.ownerOf(nftHolderWstETHTokenIds[0]), nftHolderWstETH)
      })
    })

    describe('approve()', async () => {
      it('reverts with message "ApprovalToOwner()" when approval for owner address', async () => {
        await assert.reverts(
          withdrawalRequestNFT.approve(nftHolderStETH, nftHolderStETHTokenIds[0], { from: nftHolderStETH }),
          'ApprovalToOwner()'
        )
      })

      it('reverts with message "NotOwnerOrApprovedForAll()" when called noy by owner', async () => {
        await assert.reverts(
          withdrawalRequestNFT.approve(recipient, nftHolderStETHTokenIds[0], { from: stranger }),
          `NotOwnerOrApprovedForAll("${stranger}")`
        )
      })

      it('sets approval for address', async () => {
        await withdrawalRequestNFT.approve(recipient, nftHolderStETHTokenIds[0], { from: nftHolderStETH })
        assert.equal(await withdrawalRequestNFT.getApproved(nftHolderStETHTokenIds[0]), recipient)
      })
    })

    describe('getApproved()', async () => {
      it('reverts with message "InvalidRequestId()" when called with non existed token id', async () => {
        await assert.reverts(
          withdrawalRequestNFT.getApproved(nonExistedTokenId),
          `InvalidRequestId(${nonExistedTokenId})`
        )
      })
    })

    describe('setApprovalForAll()', async () => {
      it('reverts with message "ApproveToCaller()" when owner equal to operator', async () => {
        await assert.reverts(
          withdrawalRequestNFT.setApprovalForAll(nftHolderStETH, true, { from: nftHolderStETH }),
          'ApproveToCaller()'
        )
      })
    })

    describe('safeTransferFrom(address,address,uint256)', async () => {
      it('reverts with message "NotOwnerOrApproved()" when approvalNotSet and not owner', async () => {
        await assert.reverts(
          withdrawalRequestNFT.safeTransferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], {
            from: stranger
          }),
          `NotOwnerOrApproved("${stranger}")`
        )
      })

      it('transfers if called by owner', async () => {
        assert.notEqual(await withdrawalRequestNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        await withdrawalRequestNFT.safeTransferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], {
          from: nftHolderStETH
        })
        assert.equal(await withdrawalRequestNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
      })

      it('transfers if token approval set', async () => {
        await withdrawalRequestNFT.approve(recipient, nftHolderStETHTokenIds[0], { from: nftHolderStETH })
        assert.notEqual(await withdrawalRequestNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        await withdrawalRequestNFT.safeTransferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], {
          from: recipient
        })
        assert.equal(await withdrawalRequestNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
      })

      it('transfers if operator approval set', async () => {
        await withdrawalRequestNFT.setApprovalForAll(recipient, true, { from: nftHolderStETH })
        assert.notEqual(await withdrawalRequestNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        assert.notEqual(await withdrawalRequestNFT.ownerOf(nftHolderStETHTokenIds[1]), recipient)
        await withdrawalRequestNFT.safeTransferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], {
          from: recipient
        })
        await withdrawalRequestNFT.safeTransferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[1], {
          from: recipient
        })
        assert.equal(await withdrawalRequestNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        assert.equal(await withdrawalRequestNFT.ownerOf(nftHolderStETHTokenIds[1]), recipient)
      })

      it('reverts with message "TransferToNonIERC721Receiver()" when transfer to contract that not implements IERC721Receiver interface', async () => {
        await assert.reverts(
          withdrawalRequestNFT.safeTransferFrom(nftHolderWstETH, stETH.address, nftHolderWstETHTokenIds[0], {
            from: nftHolderWstETH
          }),
          `TransferToNonIERC721Receiver("${stETH.address}")`
        )
      })

      it('reverts with propagated error message when recipient contract implements ERC721Receiver and reverts on onERC721Received call', async () => {
        await erc721ReceiverMock.setDoesAcceptTokens(false, { from: deployer })
        await assert.reverts(
          withdrawalRequestNFT.safeTransferFrom(nftHolderStETH, erc721ReceiverMock.address, nftHolderStETHTokenIds[0], {
            from: nftHolderStETH
          }),
          'ERC721_NOT_ACCEPT_TOKENS'
        )
      })

      it("doesn't revert when recipient contract implements ERC721Receiver interface and accepts tokens", async () => {
        await erc721ReceiverMock.setDoesAcceptTokens(true, { from: deployer })
        assert.notEqual(await withdrawalRequestNFT.ownerOf(nftHolderStETHTokenIds[0]), erc721ReceiverMock.address)
        await withdrawalRequestNFT.safeTransferFrom(
          nftHolderStETH,
          erc721ReceiverMock.address,
          nftHolderStETHTokenIds[0],
          {
            from: nftHolderStETH
          }
        )
        assert.equal(await withdrawalRequestNFT.ownerOf(nftHolderStETHTokenIds[0]), erc721ReceiverMock.address)
      })
    })

    describe('transferFrom()', async () => {
      it('reverts with message "NotOwnerOrApproved()" when approvalNotSet and not owner', async () => {
        await assert.reverts(
          withdrawalRequestNFT.transferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], { from: stranger }),
          `NotOwnerOrApproved("${stranger}")`
        )
      })

      it('reverts with error "RequestAlreadyClaimed()" when called on claimed request', async () => {
        const batch = await withdrawalRequestNFT.finalizationBatch(3, shareRate(1))
        await withdrawalRequestNFT.finalize(3, { from: deployer, value: batch.ethToLock })
        const ownerETHBefore = await hre.ethers.provider.getBalance(nftHolderStETH)
        const tx = await withdrawalRequestNFT.methods['claimWithdrawal(uint256)'](nftHolderStETHTokenIds[0], {
          from: nftHolderStETH
        })
        const ownerETHAfter = await hre.ethers.provider.getBalance(nftHolderStETH)
        // adhoc fix for solidity-coverage that ignores gasPrice = 0
        assert.almostEqual(ownerETHAfter, ownerETHBefore.add(ETH(25)), tx.receipt.gasUsed)

        await assert.reverts(
          withdrawalRequestNFT.transferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], {
            from: nftHolderStETH
          }),
          `RequestAlreadyClaimed(${nftHolderStETHTokenIds[0]})`
        )
      })

      it('transfers if called by owner', async () => {
        assert.notEqual(await withdrawalRequestNFT.ownerOf(nftHolderWstETHTokenIds[0]), recipient)
        await withdrawalRequestNFT.transferFrom(nftHolderWstETH, recipient, nftHolderWstETHTokenIds[0], {
          from: nftHolderWstETH
        })
        assert.equal(await withdrawalRequestNFT.ownerOf(nftHolderWstETHTokenIds[0]), recipient)
      })

      it('transfers if token approval set', async () => {
        await withdrawalRequestNFT.approve(recipient, nftHolderStETHTokenIds[0], { from: nftHolderStETH })
        assert.notEqual(await withdrawalRequestNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        await withdrawalRequestNFT.transferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], {
          from: recipient
        })
        assert.equal(await withdrawalRequestNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
      })

      it('transfers if operator approval set', async () => {
        await withdrawalRequestNFT.setApprovalForAll(recipient, true, { from: nftHolderStETH })
        assert.notEqual(await withdrawalRequestNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        assert.notEqual(await withdrawalRequestNFT.ownerOf(nftHolderStETHTokenIds[1]), recipient)
        await withdrawalRequestNFT.transferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], {
          from: recipient
        })
        await withdrawalRequestNFT.transferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[1], {
          from: recipient
        })
        assert.equal(await withdrawalRequestNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        assert.equal(await withdrawalRequestNFT.ownerOf(nftHolderStETHTokenIds[1]), recipient)
      })

      it('can claim request after transfer', async () => {
        await withdrawalRequestNFT.transferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], {
          from: nftHolderStETH
        })
        assert.equal(await withdrawalRequestNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)

        const batch = await withdrawalRequestNFT.finalizationBatch(3, shareRate(1))
        await withdrawalRequestNFT.finalize(3, { from: deployer, value: batch.ethToLock })

        const recipientETHBefore = await hre.ethers.provider.getBalance(recipient)
        const tx = await withdrawalRequestNFT.methods['claimWithdrawal(uint256)'](nftHolderStETHTokenIds[0], {
          from: recipient
        })
        const recipientETHAfter = await hre.ethers.provider.getBalance(recipient)
        // adhoc fix for solidity-coverage that ignores gasPrice = 0
        assert.almostEqual(recipientETHAfter, recipientETHBefore.add(ETH(25)), tx.receipt.gasUsed)
      })

      it("doesn't reverts when transfer to contract that not implements IERC721Receiver interface", async () => {
        assert.equal(await withdrawalRequestNFT.ownerOf(nftHolderWstETHTokenIds[0]), nftHolderWstETH)
        await withdrawalRequestNFT.transferFrom(nftHolderWstETH, stETH.address, nftHolderWstETHTokenIds[0], {
          from: nftHolderWstETH
        })
        assert.equal(await withdrawalRequestNFT.ownerOf(nftHolderWstETHTokenIds[0]), stETH.address)
      })
    })
  }
)
