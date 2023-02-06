const hre = require('hardhat')
const { assert } = require('../helpers/assert')
const { EvmSnapshot } = require('../helpers/blockchain')
const { shares, ETH } = require('../helpers/utils')

const StETH = hre.artifacts.require('StETHMock')
const WstETH = hre.artifacts.require('WstETHMock')
const WithdrawalNFT = hre.artifacts.require('WithdrawalRequestNFT')
const OssifiableProxy = hre.artifacts.require('OssifiableProxy')

hre.contract(
  'WithdrawalRequestNFT',
  ([deployer, stEthHolder, wstEthHolder, nftHolderStETH, nftHolderWstETH, recipient, stranger]) => {
    let withdrawalNFT, stETH, wstETH
    let nftHolderStETHTokenIds, nftHolderWstETHTokenIds, nonExistedTokenId
    const snapshot = new EvmSnapshot(hre.ethers.provider)

    before(async () => {
      stETH = await StETH.new({ value: ETH(100), from: deployer })
      wstETH = await WstETH.new(stETH.address, { from: deployer })
      const withdrawalNFTImpl = await WithdrawalNFT.new(wstETH.address, { from: deployer })
      const withdrawalNFTProxy = await OssifiableProxy.new(withdrawalNFTImpl.address, deployer, '0x')
      withdrawalNFT = await WithdrawalNFT.at(withdrawalNFTProxy.address)
      await withdrawalNFT.initialize(
        deployer, // owner
        deployer, // pauser
        deployer, // resumer
        deployer // finalizer
      )
      await withdrawalNFT.resume({ from: deployer })

      await stETH.setTotalPooledEther(ETH(100))
      await stETH.mintShares(stEthHolder, shares(50))
      await stETH.mintShares(wstETH.address, shares(50))
      await wstETH.mint(wstEthHolder, ETH(25))

      await stETH.approve(withdrawalNFT.address, ETH(50), { from: stEthHolder })
      await wstETH.approve(withdrawalNFT.address, ETH(25), { from: wstEthHolder })
      await withdrawalNFT.requestWithdrawals(
        [
          [ETH(25), nftHolderStETH],
          [ETH(25), nftHolderStETH]
        ],
        { from: stEthHolder }
      )
      nftHolderStETHTokenIds = [1, 2]
      await withdrawalNFT.requestWithdrawalsWstETH([[ETH(25), nftHolderWstETH]], { from: wstEthHolder })
      nftHolderWstETHTokenIds = [3]
      nonExistedTokenId = 4
      await snapshot.make()
    })

    afterEach(async () => {
      await snapshot.rollback()
    })

    describe('balanceOf()', () => {
      it('return 0 when user has not withdrawal requests', async () => {
        assert.equals(await withdrawalNFT.balanceOf(recipient), 0)
      })

      it('return correct withdrawal requests count', async () => {
        assert.equals(await withdrawalNFT.balanceOf(nftHolderStETH), 2)
        assert.equals(await withdrawalNFT.balanceOf(nftHolderWstETH), 1)
      })
    })

    describe('ownerOf()', () => {
      it('reverts with error InvalidRequestId() when token id is 0', async () => {
        await assert.revertsWithCustomError(withdrawalNFT.ownerOf(0), `InvalidRequestId(0)`)
      })

      it('reverts with error InvalidRequestId() when called with non existed token id', async () => {
        await assert.revertsWithCustomError(
          withdrawalNFT.ownerOf(nonExistedTokenId),
          `InvalidRequestId(${nonExistedTokenId})`
        )
      })

      it('reverts correct owner', async () => {
        assert.equal(await withdrawalNFT.ownerOf(nftHolderStETHTokenIds[0]), nftHolderStETH)
        assert.equal(await withdrawalNFT.ownerOf(nftHolderStETHTokenIds[1]), nftHolderStETH)
        assert.equal(await withdrawalNFT.ownerOf(nftHolderWstETHTokenIds[0]), nftHolderWstETH)
      })
    })

    describe('approve()', async () => {
      it('reverts with message "ERC721: approval to current owner" when approval for owner address', async () => {
        await assert.reverts(
          withdrawalNFT.approve(nftHolderStETH, nftHolderStETHTokenIds[0], { from: nftHolderStETH }),
          'ERC721: approval to current owner'
        )
      })

      it('reverts with message "ERC721: approve caller is not owner nor approved for all" when called noy by owner', async () => {
        await assert.reverts(
          withdrawalNFT.approve(stranger, nftHolderStETHTokenIds[0], { from: stranger }),
          'ERC721: approve caller is not owner nor approved for all'
        )
      })

      it('sets approval for address', async () => {
        await withdrawalNFT.approve(recipient, nftHolderStETHTokenIds[0], { from: nftHolderStETH })
        assert.equal(await withdrawalNFT.getApproved(nftHolderStETHTokenIds[0]), recipient)
      })
    })

    describe('getApproved()', async () => {
      it('reverts with message "ERC721: approved query for nonexistent or claimed token" when called with non existed token id', async () => {
        await assert.reverts(
          withdrawalNFT.getApproved(nonExistedTokenId),
          'ERC721: approved query for nonexistent or claimed token'
        )
      })
    })

    describe('setApprovalForAll()', async () => {
      it('reverts with message "ERC721: approve to caller" when owner equal to operator', async () => {
        await assert.reverts(
          withdrawalNFT.setApprovalForAll(nftHolderStETH, true, { from: nftHolderStETH }),
          'ERC721: approve to caller'
        )
      })
    })

    describe('safeTransferFrom(address,address,uint256)', async () => {
      it('reverts with message "ERC721: caller is not token owner or approved" when approvalNotSet and not owner', async () => {
        await assert.reverts(
          withdrawalNFT.safeTransferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], { from: stranger }),
          'ERC721: caller is not token owner or approved'
        )
      })

      it('transfers if called by owner', async () => {
        assert.notEqual(await withdrawalNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        await withdrawalNFT.safeTransferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], {
          from: nftHolderStETH
        })
        assert.equal(await withdrawalNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
      })

      it('transfers if token approval set', async () => {
        await withdrawalNFT.approve(recipient, nftHolderStETHTokenIds[0], { from: nftHolderStETH })
        assert.notEqual(await withdrawalNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        await withdrawalNFT.safeTransferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], { from: recipient })
        assert.equal(await withdrawalNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
      })

      it('transfers if operator approval set', async () => {
        await withdrawalNFT.setApprovalForAll(recipient, true, { from: nftHolderStETH })
        assert.notEqual(await withdrawalNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        assert.notEqual(await withdrawalNFT.ownerOf(nftHolderStETHTokenIds[1]), recipient)
        await withdrawalNFT.safeTransferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], { from: recipient })
        await withdrawalNFT.safeTransferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[1], { from: recipient })
        assert.equal(await withdrawalNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        assert.equal(await withdrawalNFT.ownerOf(nftHolderStETHTokenIds[1]), recipient)
      })
    })

    describe('transferFrom()', async () => {
      it('reverts with message "ERC721: caller is not token owner or approved" when approvalNotSet and not owner', async () => {
        await assert.reverts(
          withdrawalNFT.transferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], { from: stranger }),
          'ERC721: caller is not token owner or approved'
        )
      })

      it('reverts with error "RequestAlreadyClaimed()" when called on claimed request', async () => {
        await withdrawalNFT.finalize(3, { from: deployer, value: ETH(100) })
        const ownerETHBefore = await hre.ethers.provider.getBalance(nftHolderStETH)
        await withdrawalNFT.methods['claimWithdrawal(uint256)'](nftHolderStETHTokenIds[0], { from: nftHolderStETH })
        const ownerETHAfter = await hre.ethers.provider.getBalance(nftHolderStETH)
        assert.equals(ownerETHAfter, ownerETHBefore.add(ETH(25)))

        await assert.revertsWithCustomError(
          withdrawalNFT.transferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], {
            from: nftHolderStETH
          }),
          `RequestAlreadyClaimed(${nftHolderStETHTokenIds[0]})`
        )
      })

      it('transfers if called by owner', async () => {
        assert.notEqual(await withdrawalNFT.ownerOf(nftHolderWstETHTokenIds[0]), recipient)
        await withdrawalNFT.transferFrom(nftHolderWstETH, recipient, nftHolderWstETHTokenIds[0], {
          from: nftHolderWstETH
        })
        assert.equal(await withdrawalNFT.ownerOf(nftHolderWstETHTokenIds[0]), recipient)
      })

      it('transfers if token approval set', async () => {
        await withdrawalNFT.approve(recipient, nftHolderStETHTokenIds[0], { from: nftHolderStETH })
        assert.notEqual(await withdrawalNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        await withdrawalNFT.transferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], { from: recipient })
        assert.equal(await withdrawalNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
      })

      it('transfers if operator approval set', async () => {
        await withdrawalNFT.setApprovalForAll(recipient, true, { from: nftHolderStETH })
        assert.notEqual(await withdrawalNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        assert.notEqual(await withdrawalNFT.ownerOf(nftHolderStETHTokenIds[1]), recipient)
        await withdrawalNFT.transferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], { from: recipient })
        await withdrawalNFT.transferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[1], { from: recipient })
        assert.equal(await withdrawalNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)
        assert.equal(await withdrawalNFT.ownerOf(nftHolderStETHTokenIds[1]), recipient)
      })

      it('can claim request after transfer', async () => {
        await withdrawalNFT.transferFrom(nftHolderStETH, recipient, nftHolderStETHTokenIds[0], {
          from: nftHolderStETH
        })
        assert.equal(await withdrawalNFT.ownerOf(nftHolderStETHTokenIds[0]), recipient)

        await withdrawalNFT.finalize(3, { from: deployer, value: ETH(100) })

        const recipientETHBefore = await hre.ethers.provider.getBalance(recipient)
        await withdrawalNFT.methods['claimWithdrawal(uint256)'](nftHolderStETHTokenIds[0], { from: recipient })
        const recipientETHAfter = await hre.ethers.provider.getBalance(recipient)
        assert.equals(recipientETHAfter, recipientETHBefore.add(ETH(25)))
      })
    })
  }
)
