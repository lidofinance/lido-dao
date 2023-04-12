const { artifacts, contract, ethers, web3 } = require('hardhat')

const { bn } = require('@aragon/contract-helpers-test')
const { EvmSnapshot } = require('../helpers/blockchain')
const { ETH, StETH } = require('../helpers/utils')
const { assert } = require('../helpers/assert')
const { deployProtocol } = require('../helpers/protocol')
const { INITIAL_HOLDER, ZERO_ADDRESS } = require('../helpers/constants')

const Burner = artifacts.require('Burner.sol')

const ERC20OZMock = artifacts.require('ERC20OZMock.sol')
const ERC721OZMock = artifacts.require('ERC721OZMock.sol')

// semantic aliases
const stETHShares = ETH

contract('Burner', ([deployer, _, anotherAccount]) => {
  let lido, burner, appManager, voting, treasury
  let snapshot

  before('deploy lido with dao', async () => {
    const deployed = await deployProtocol()

    lido = deployed.pool
    burner = deployed.burner
    voting = deployed.voting.address
    appManager = deployed.appManager.address
    treasury = deployed.treasury.address

    // allow tx `handleOracleReport` from the Lido contract addr
    await ethers.provider.send('hardhat_impersonateAccount', [lido.address])
    await ethers.provider.send('hardhat_impersonateAccount', [burner.address])

    snapshot = new EvmSnapshot(ethers.provider)
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  describe('Burner ACL correctness', () => {
    it(`REQUEST_BURN_MY_STETH_ROLE works`, async () => {
      await web3.eth.sendTransaction({ from: anotherAccount, to: lido.address, value: ETH(2) })
      await lido.approve(burner.address, StETH(2), { from: anotherAccount })

      assert.isFalse(await burner.hasRole(await burner.REQUEST_BURN_MY_STETH_ROLE(), anotherAccount))

      await assert.revertsOZAccessControl(
        burner.requestBurnMyStETH(StETH(1), { from: anotherAccount }),
        anotherAccount,
        `REQUEST_BURN_MY_STETH_ROLE`
      )

      await assert.revertsOZAccessControl(
        burner.requestBurnMyStETHForCover(StETH(1), { from: anotherAccount }),
        anotherAccount,
        `REQUEST_BURN_MY_STETH_ROLE`
      )

      await burner.grantRole(await burner.REQUEST_BURN_MY_STETH_ROLE(), anotherAccount, { from: appManager })
      assert.isTrue(await burner.hasRole(await burner.REQUEST_BURN_MY_STETH_ROLE(), anotherAccount))

      await burner.requestBurnMyStETH(StETH(1), { from: anotherAccount })
      await burner.requestBurnMyStETHForCover(StETH(1), { from: anotherAccount })
    })

    it(`REQUEST_BURN_SHARES_ROLE works`, async () => {
      await web3.eth.sendTransaction({ from: anotherAccount, to: lido.address, value: ETH(2) })
      await lido.approve(burner.address, StETH(2), { from: anotherAccount })

      assert.isFalse(await burner.hasRole(await burner.REQUEST_BURN_SHARES_ROLE(), anotherAccount))

      await assert.revertsOZAccessControl(
        burner.requestBurnSharesForCover(anotherAccount, stETHShares(1), { from: anotherAccount }),
        anotherAccount,
        `REQUEST_BURN_SHARES_ROLE`
      )

      await assert.revertsOZAccessControl(
        burner.requestBurnShares(anotherAccount, stETHShares(1), { from: anotherAccount }),
        anotherAccount,
        `REQUEST_BURN_SHARES_ROLE`
      )

      await burner.grantRole(await burner.REQUEST_BURN_SHARES_ROLE(), anotherAccount, { from: appManager })
      assert.isTrue(await burner.hasRole(await burner.REQUEST_BURN_SHARES_ROLE(), anotherAccount))

      await burner.requestBurnSharesForCover(anotherAccount, stETHShares(1), { from: anotherAccount })
      await burner.requestBurnShares(anotherAccount, stETHShares(1), { from: anotherAccount })
    })

    it(`only Lido can commit shares to burn`, async () => {
      assert.revertsWithCustomError(burner.commitSharesToBurn(0, { from: anotherAccount }), `AppAuthLidoFailed()`)

      await burner.commitSharesToBurn(0, { from: lido.address })
    })

    it(`permissionless view functions are available for anyone`, async () => {
      await burner.getSharesRequestedToBurn({ from: anotherAccount })
      await burner.getCoverSharesBurnt({ from: anotherAccount })
      await burner.getNonCoverSharesBurnt({ from: anotherAccount })
      await burner.getExcessStETH({ from: anotherAccount })
    })
  })

  describe('Requests and burn invocation', () => {
    const bnRound10 = (value) => bn(value).add(bn(5)).div(bn(10)).mul(bn(10))

    beforeEach(async () => {
      // initial balance is zero
      assert.equals(await lido.balanceOf(anotherAccount), StETH(0))

      // stake ether to get an stETH in exchange
      await web3.eth.sendTransaction({ from: anotherAccount, to: lido.address, value: ETH(20) })
      await web3.eth.sendTransaction({ from: deployer, to: lido.address, value: ETH(30) })
      await web3.eth.sendTransaction({ from: voting, to: lido.address, value: ETH(24) })

      // check stETH balances 1 + 20 + 30 + 24 = 75
      assert.equals(await lido.balanceOf(INITIAL_HOLDER), StETH(1))
      assert.equals(await lido.balanceOf(anotherAccount), StETH(20))
      assert.equals(await lido.balanceOf(deployer), StETH(30))
      assert.equals(await lido.balanceOf(voting), StETH(24))
    })

    it(`init with already burnt counters works`, async () => {
      let newBurner = await Burner.new(voting, treasury, lido.address, bn(0), bn(0), { from: deployer })

      assert.equals(await newBurner.getCoverSharesBurnt(), bn(0))
      assert.equals(await newBurner.getNonCoverSharesBurnt(), bn(0))

      newBurner = await Burner.new(voting, treasury, lido.address, bn(123), bn(456), { from: deployer })

      assert.equals(await newBurner.getCoverSharesBurnt(), bn(123))
      assert.equals(await newBurner.getNonCoverSharesBurnt(), bn(456))
    })

    it(`can't use zero init addresses`, async () => {
      await assert.revertsWithCustomError(
        Burner.new(ZERO_ADDRESS, treasury, lido.address, bn(0), bn(0), { from: deployer }),
        `ZeroAddress("_admin")`
      )

      await assert.revertsWithCustomError(
        Burner.new(voting, ZERO_ADDRESS, lido.address, bn(0), bn(0), { from: deployer }),
        `ZeroAddress("_treasury")`
      )

      await assert.revertsWithCustomError(
        Burner.new(voting, treasury, ZERO_ADDRESS, bn(0), bn(0), { from: deployer }),
        `ZeroAddress("_stETH")`
      )
    })

    it(`reverts on zero stETH amount cover/non-cover request`, async () => {
      // provide non-zero allowance
      await lido.approve(burner.address, StETH(1), { from: voting })

      // but zero request on cover
      await assert.revertsWithCustomError(
        burner.requestBurnMyStETHForCover(StETH(0), { from: voting }),
        `ZeroBurnAmount()`
      )

      // and zero request on non-cover
      await assert.revertsWithCustomError(burner.requestBurnMyStETH(StETH(0), { from: voting }), `ZeroBurnAmount()`)
    })

    it(`reverts on burn request without assigned role`, async () => {
      // provide allowance and request burn for cover
      await lido.approve(burner.address, StETH(8), { from: anotherAccount })

      // anotherAccount can't place burn request, only voting can
      await assert.revertsOZAccessControl(
        burner.requestBurnMyStETHForCover(StETH(8), { from: anotherAccount }),
        anotherAccount,
        'REQUEST_BURN_MY_STETH_ROLE'
      )

      await lido.approve(burner.address, StETH(8), { from: deployer })

      // even deployer can't place burn request
      await assert.revertsOZAccessControl(
        burner.requestBurnMyStETH(StETH(8), { from: deployer }),
        deployer,
        `REQUEST_BURN_MY_STETH_ROLE`
      )

      await burner.grantRole(web3.utils.keccak256(`REQUEST_BURN_MY_STETH_ROLE`), deployer, { from: appManager })
      await burner.requestBurnMyStETH(StETH(8), { from: deployer }) // doesn't revert anymore

      // event deployer can't place burn request
      await assert.revertsOZAccessControl(
        burner.requestBurnShares(deployer, StETH(8), { from: deployer }),
        deployer,
        `REQUEST_BURN_SHARES_ROLE`
      )

      assert.equals(await lido.balanceOf(deployer), StETH(22))
    })

    it(`reverts on attempt to burn more then requested`, async () => {
      // provide allowance and request burn for cover
      const sharesAmount8StETH = await lido.getSharesByPooledEth(StETH(8))
      await lido.approve(burner.address, StETH(8), { from: voting })
      let receipt = await burner.requestBurnMyStETHForCover(StETH(8), { from: voting })

      assert.emits(receipt, `StETHBurnRequested`, {
        isCover: true,
        requestedBy: voting,
        amountOfStETH: StETH(8),
        amountOfShares: sharesAmount8StETH,
      })

      // check stETH balances
      assert.equals(await lido.balanceOf(burner.address), StETH(8))
      assert.equals(await lido.balanceOf(voting), StETH(16))

      const sharesAmount12 = sharesAmount8StETH.mul(bn(3)).div(bn(2))
      await lido.approve(burner.address, StETH(13), { from: voting })
      receipt = await burner.requestBurnMyStETH(StETH(12), { from: voting })

      assert.emits(receipt, `StETHBurnRequested`, {
        isCover: false,
        requestedBy: voting,
        amountOfStETH: StETH(12),
        amountOfShares: sharesAmount12,
      })

      // check stETH balances again, we didn't execute the actual burn
      assert.equals(await lido.balanceOf(burner.address), StETH(20))
      assert.equals(await lido.balanceOf(voting), StETH(4))

      await assert.revertsWithCustomError(
        burner.commitSharesToBurn(StETH(100), { from: lido.address }),
        `BurnAmountExceedsActual(${StETH(100)}, ${StETH(20)})`
      )
    })

    it(`request shares burn for cover works`, async () => {
      // allowance should be set explicitly to request burning
      await assert.reverts(burner.requestBurnMyStETHForCover(StETH(8), { from: voting }), `ALLOWANCE_EXCEEDED`)

      // provide allowance and request burn for cover
      const sharesAmount8StETH = await lido.getSharesByPooledEth(StETH(8))
      await lido.approve(burner.address, StETH(8), { from: voting })
      let receipt = await burner.requestBurnMyStETHForCover(StETH(8), { from: voting })

      assert.emits(receipt, `StETHBurnRequested`, {
        isCover: true,
        requestedBy: voting,
        amountOfStETH: StETH(8),
        amountOfShares: sharesAmount8StETH,
      })

      // check stETH balances
      assert.equals(await lido.balanceOf(burner.address), StETH(8))
      assert.equals(await lido.balanceOf(voting), StETH(16))

      const sharesAmount12 = sharesAmount8StETH.mul(bn(3)).div(bn(2))
      await lido.approve(burner.address, StETH(13), { from: voting })
      receipt = await burner.requestBurnMyStETH(StETH(12), { from: voting })

      assert.emits(receipt, `StETHBurnRequested`, {
        isCover: false,
        requestedBy: voting,
        amountOfStETH: StETH(12),
        amountOfShares: sharesAmount12,
      })

      // check stETH balances again, we didn't execute the actual burn
      assert.equals(await lido.balanceOf(burner.address), StETH(20))
      assert.equals(await lido.balanceOf(voting), StETH(4))
    })

    it(`invoke commitSharesToBurn without requested burn works`, async () => {
      // someone accidentally transferred stETH
      await lido.transfer(burner.address, StETH(5.6), { from: deployer })
      await lido.transfer(burner.address, StETH(4.1), { from: anotherAccount })

      assert.equals(await lido.balanceOf(burner.address), StETH(9.7))

      await assert.revertsWithCustomError(burner.commitSharesToBurn(ETH(10)), `AppAuthLidoFailed()`)

      // mimic the Lido for the callback invocation
      const receipt = await burner.commitSharesToBurn(ETH(0), { from: lido.address })

      // no burn requests => zero events
      assert.emitsNumberOfEvents(receipt, `StETHBurnt`, 0)

      // the balance should be the same
      assert.equals(await lido.balanceOf(burner.address), StETH(9.7))
    })

    it(`invoke commitSharesToBurn with the one type (cover/non-cover) pending requests works`, async () => {
      // someone accidentally transferred stETH
      await lido.transfer(burner.address, StETH(3.1), { from: deployer })
      await lido.transfer(burner.address, StETH(4.0), { from: anotherAccount })

      // request non-cover burn (accidentally approved more than needed)
      await lido.approve(burner.address, StETH(7), { from: voting })
      await burner.requestBurnMyStETH(StETH(6), { from: voting })

      const burnerShares = await lido.sharesOf(burner.address)
      const sharesToBurn = await lido.getSharesByPooledEth(StETH(6))

      assert.equals(await lido.balanceOf(burner.address), StETH(6 + 3.1 + 4.0))

      await assert.revertsWithCustomError(
        // should revert
        burner.commitSharesToBurn(ETH(10), { from: deployer }),
        `AppAuthLidoFailed()`
      )

      await assert.revertsWithCustomError(
        burner.commitSharesToBurn(ETH(10), { from: anotherAccount }),
        `AppAuthLidoFailed()`
      )

      const receipt = await burner.commitSharesToBurn(ETH(6), { from: lido.address })

      assert.emits(receipt, `StETHBurnt`, { isCover: false, amountOfStETH: StETH(6), amountOfShares: sharesToBurn })

      assert.emitsNumberOfEvents(receipt, `StETHBurnt`, 1)
      await lido.burnShares(burner.address, sharesToBurn)

      // the balance should be lowered by requested to burn
      assert.equals(await lido.sharesOf(burner.address), burnerShares.sub(sharesToBurn))
    })

    it(`invoke an oracle with requested cover AND non-cover burn works`, async () => {
      // someone accidentally transferred stETH
      await lido.transfer(burner.address, StETH(2.1), { from: deployer })
      await lido.transfer(burner.address, StETH(3.1), { from: anotherAccount })

      await lido.approve(burner.address, StETH(3), { from: voting })

      const sharesAmount0_5StETH = await lido.getSharesByPooledEth(StETH(0.5))
      const sharesAmount1_5StETH = sharesAmount0_5StETH.mul(bn(3))

      const receiptCover = await burner.requestBurnMyStETHForCover(StETH(1.5), { from: voting })

      assert.emits(receiptCover, `StETHBurnRequested`, {
        isCover: true,
        requestedBy: voting,
        amountOfStETH: StETH(1.5),
        amountOfShares: sharesAmount1_5StETH,
      })

      const receiptNonCover = await burner.requestBurnMyStETH(StETH(0.5), { from: voting })

      assert.emits(receiptNonCover, `StETHBurnRequested`, {
        isCover: false,
        requestedBy: voting,
        amountOfStETH: StETH(0.5),
        amountOfShares: sharesAmount0_5StETH,
      })

      const burnerShares = await lido.sharesOf(burner.address)
      const sharesToBurn = sharesAmount0_5StETH.add(sharesAmount1_5StETH)

      assert.equals(await lido.balanceOf(burner.address), StETH(7.2))

      await assert.revertsWithCustomError(burner.commitSharesToBurn(bn(500), { from: deployer }), `AppAuthLidoFailed()`)

      await assert.revertsWithCustomError(
        // even
        burner.commitSharesToBurn(ETH(6), { from: appManager }),
        `AppAuthLidoFailed()`
      )

      const receipt = await burner.commitSharesToBurn(ETH(2), { from: lido.address })

      assert.emits(receipt, `StETHBurnt`, {
        isCover: true,
        amountOfStETH: StETH(1.5),
        amountOfShares: sharesAmount1_5StETH,
      })

      assert.emits(receipt, `StETHBurnt`, 1, {
        isCover: false,
        amountOfStETH: StETH(0.5),
        amountOfShares: sharesAmount0_5StETH,
      })

      // cover + non-cover events
      assert.emitsNumberOfEvents(receipt, `StETHBurnt`, 2)

      await lido.burnShares(burner.address, bn(sharesAmount1_5StETH).add(sharesAmount0_5StETH))

      // the balance should be lowered by requested to burn
      assert.equals(await lido.sharesOf(burner.address), burnerShares.sub(sharesToBurn))
    })

    it(`the burnt shares counters works`, async () => {
      const coverSharesAmount = [bn(10000000), bn(200000000), bn(30500000000)]
      const nonCoverSharesAmount = [bn(500000000), bn(370000000), bn(4210000000)]

      const reduceF = (a, b) => a.add(b)

      const allowance = await lido.getPooledEthByShares(
        coverSharesAmount.reduce(reduceF, bn(0)) + nonCoverSharesAmount.reduce(reduceF, bn(0))
      )

      let expectedCoverSharesBurnt = bn(0)
      let expectedNonCoverSharesBurnt = bn(0)

      assert.equals(await burner.getCoverSharesBurnt(), expectedCoverSharesBurnt)
      assert.equals(await burner.getNonCoverSharesBurnt(), expectedNonCoverSharesBurnt)

      await lido.approve(burner.address, allowance, { from: voting })

      // going through the defined arrays to check the burnt counters
      while (coverSharesAmount.length > 0) {
        const currentCoverSharesAmount = coverSharesAmount.pop()
        const currentNonCoverSharesAmount = nonCoverSharesAmount.pop()

        // we should re-estimate share to eth due to happened token rebase
        const coverStETHAmountToBurn = await lido.getPooledEthByShares(currentCoverSharesAmount)
        const nonCoverStETHAmountToBurn = await lido.getPooledEthByShares(currentNonCoverSharesAmount)

        await burner.requestBurnMyStETHForCover(coverStETHAmountToBurn, { from: voting })
        await burner.requestBurnMyStETH(nonCoverStETHAmountToBurn, { from: voting })

        const { coverShares, nonCoverShares } = await burner.getSharesRequestedToBurn()
        await burner.commitSharesToBurn(coverShares.add(nonCoverShares), { from: lido.address })

        // accumulate burnt shares
        expectedCoverSharesBurnt = expectedCoverSharesBurnt.add(currentCoverSharesAmount)
        expectedNonCoverSharesBurnt = expectedNonCoverSharesBurnt.add(currentNonCoverSharesAmount)

        // to address finite precision issues we remove least significant digit
        assert.equals(bnRound10(await burner.getCoverSharesBurnt()), bnRound10(expectedCoverSharesBurnt))
        assert.equals(bnRound10(await burner.getNonCoverSharesBurnt()), bnRound10(expectedNonCoverSharesBurnt))
      }
    })

    it(`a positive rebase happens after the burn application`, async () => {
      await lido.approve(burner.address, StETH(24), { from: voting })
      await burner.requestBurnMyStETHForCover(StETH(24), { from: voting })

      assert.equals(await lido.balanceOf(burner.address), StETH(24))
      assert.equals(await lido.balanceOf(voting), StETH(0))
      assert.equals(await lido.balanceOf(anotherAccount), StETH(20))
      assert.equals(await lido.balanceOf(deployer), StETH(30))

      await burner.commitSharesToBurn(ETH(24), { from: lido.address })

      await lido.burnShares(burner.address, await lido.getPooledEthByShares(StETH(24)))

      assert.equals(await lido.balanceOf(burner.address), StETH(0))
      assert.equals(await lido.balanceOf(voting), StETH(0))

      // 24/75 of the shares amount was burnt, so remaining stETH becomes more 'expensive'
      // totalShares become 51/75 of the previous value
      // so the new share price increases by 75/51

      assert.equals(await lido.balanceOf(deployer), bn(StETH(30 * 75)).divn(51))
      assert.equals(await lido.balanceOf(anotherAccount), bn(StETH(20 * 75)).divn(51))
    })

    it(`limit burn shares per run works (cover)`, async () => {
      assert.equals(await lido.getTotalShares(), stETHShares(75))

      // so the max amount to burn per single run is 75*10^18 * 0.012 = 0.9*10^18
      await lido.approve(burner.address, StETH(25), { from: voting })
      await burner.requestBurnMyStETHForCover(StETH(0.9), { from: voting })

      assert.equals(await lido.sharesOf(burner.address), stETHShares(0.9))
      const receipt = await burner.commitSharesToBurn(StETH(0.9), { from: lido.address })

      assert.emits(receipt, `StETHBurnt`, {
        isCover: true,
        amountOfStETH: StETH(0.9),
        amountOfShares: stETHShares(0.9),
      })
      assert.emitsNumberOfEvents(receipt, `StETHBurnt`, 1)
      await lido.burnShares(burner.address, stETHShares(0.9))

      assert.equals(await lido.sharesOf(burner.address), stETHShares(0))

      await burner.requestBurnMyStETHForCover(await lido.getPooledEthByShares(stETHShares(0.1)), { from: voting })
      assert.equals(bnRound10(await lido.sharesOf(burner.address)), bnRound10(stETHShares(0.1)))

      const { coverShares, nonCoverShares } = await burner.getSharesRequestedToBurn()
      await burner.commitSharesToBurn(coverShares.add(nonCoverShares), { from: lido.address })
      await lido.burnShares(burner.address, await lido.sharesOf(burner.address))

      assert.equals(await lido.sharesOf(burner.address), stETHShares(0))

      assert.equals(bnRound10(await burner.getCoverSharesBurnt()), bnRound10(stETHShares(1)))
      assert.equals(await burner.getNonCoverSharesBurnt(), stETHShares(0))

      assert.equals(bnRound10(await lido.getTotalShares()), stETHShares(74))
      await burner.requestBurnMyStETHForCover(await lido.getPooledEthByShares(stETHShares(1)), { from: voting })

      assert.equals(bnRound10(await lido.sharesOf(burner.address)), bnRound10(stETHShares(1)))

      const beforeCoverSharesBurnt = await burner.getCoverSharesBurnt()
      const receiptN = await burner.commitSharesToBurn(stETHShares(0.1), { from: lido.address })
      const afterCoverSharesBurnt = await burner.getCoverSharesBurnt()
      const burnt = bn(afterCoverSharesBurnt).sub(beforeCoverSharesBurnt)

      assert.emits(receiptN, `StETHBurnt`, {
        isCover: true,
        amountOfStETH: await lido.getPooledEthByShares(burnt),
        amountOfShares: burnt,
      })

      await lido.burnShares(burner.address, burnt)

      assert.equals(bnRound10(await lido.sharesOf(burner.address)), bnRound10(stETHShares(0.9)))
      await burner.commitSharesToBurn(bn(1), { from: lido.address })
      assert.equals(await lido.sharesOf(burner.address), bn(stETHShares(0.9)).sub(bn(1)))

      assert.equals(bnRound10(await burner.getCoverSharesBurnt()), bnRound10(stETHShares(1.1)))
      assert.equals(await burner.getNonCoverSharesBurnt(), stETHShares(0))
    })

    it(`limit burn shares per run works (noncover)`, async () => {
      assert.equals(await lido.getTotalShares(), stETHShares(75))

      // so the max amount to burn per single run is 75*10^18 * 0.012 = 0.9*10^18
      await lido.approve(burner.address, StETH(25), { from: voting })
      await burner.requestBurnMyStETH(StETH(0.9), { from: voting })

      assert.equals(await lido.sharesOf(burner.address), stETHShares(0.9))
      const receipt = await burner.commitSharesToBurn(ETH(0.9), { from: lido.address })

      assert.emits(receipt, `StETHBurnt`, {
        isCover: false,
        amountOfStETH: StETH(0.9),
        amountOfShares: stETHShares(0.9),
      })
      assert.emitsNumberOfEvents(receipt, `StETHBurnt`, 1)
      await lido.burnShares(burner.address, stETHShares(0.9))
      assert.equals(await lido.sharesOf(burner.address), stETHShares(0))

      await burner.requestBurnMyStETH(await lido.getPooledEthByShares(stETHShares(0.1)), { from: voting })
      assert.equals(bnRound10(await lido.sharesOf(burner.address)), bnRound10(stETHShares(0.1)))

      const sharesBurntBefore = await burner.getNonCoverSharesBurnt()
      await burner.commitSharesToBurn(stETHShares(0.0125), { from: lido.address })
      const sharesBurntAfter = await burner.getNonCoverSharesBurnt()

      assert.equals(bn(sharesBurntAfter).sub(bn(sharesBurntBefore)), stETHShares(0.0125))
      assert.equals(await burner.getCoverSharesBurnt(), stETHShares(0))
    })

    it(`limit burn shares per run works (cover/noncover mix)`, async () => {
      assert.equals(await lido.getTotalShares(), StETH(75))

      // so the max amount to burn per single run is 75*10^18 * 0.012 = 0.9*10^18
      await lido.approve(burner.address, StETH(25), { from: voting })
      await burner.requestBurnMyStETH(StETH(0.8), { from: voting })
      await burner.requestBurnMyStETHForCover(StETH(0.1), { from: voting })

      assert.equals(await lido.sharesOf(burner.address), stETHShares(0.9))
      const receipt = await burner.commitSharesToBurn(ETH(0.5), { from: lido.address })

      assert.emits(receipt, `StETHBurnt`, {
        isCover: true,
        amountOfStETH: StETH(0.1),
        amountOfShares: stETHShares(0.1),
      })
      assert.emits(receipt, `StETHBurnt`, {
        isCover: false,
        amountOfStETH: StETH(0.4),
        amountOfShares: stETHShares(0.4),
      })

      assert.emitsNumberOfEvents(receipt, `StETHBurnt`, 2)
      assert.equals(await burner.getCoverSharesBurnt(), stETHShares(0.1))
      assert.equals(await burner.getNonCoverSharesBurnt(), stETHShares(0.4))

      const receipt2 = await burner.commitSharesToBurn(ETH(0.4), { from: lido.address })

      assert.emits(receipt2, `StETHBurnt`, {
        isCover: false,
        amountOfStETH: StETH(0.4),
        amountOfShares: stETHShares(0.4),
      })

      assert.emitsNumberOfEvents(receipt2, `StETHBurnt`, 1)
      assert.equals(await burner.getCoverSharesBurnt(), stETHShares(0.1))
      assert.equals(await burner.getNonCoverSharesBurnt(), stETHShares(0.8))
    })

    it(`limit burn shares per run works (cover/noncover mix) via requestBurnMyShares`, async () => {
      await burner.grantRole(web3.utils.keccak256(`REQUEST_BURN_SHARES_ROLE`), voting, { from: appManager })

      assert.equals(await lido.getTotalShares(), StETH(75))

      await lido.approve(burner.address, StETH(25), { from: voting })
      await burner.requestBurnShares(voting, StETH(0.8), { from: voting })
      await burner.requestBurnSharesForCover(voting, StETH(0.1), { from: voting })

      assert.equals(await lido.sharesOf(burner.address), stETHShares(0.9))
      const receipt = await burner.commitSharesToBurn(ETH(0.5), { from: lido.address })

      assert.emits(receipt, `StETHBurnt`, {
        isCover: true,
        amountOfStETH: StETH(0.1),
        amountOfShares: stETHShares(0.1),
      })
      assert.emits(receipt, `StETHBurnt`, {
        isCover: false,
        amountOfStETH: StETH(0.4),
        amountOfShares: stETHShares(0.4),
      })

      assert.emitsNumberOfEvents(receipt, `StETHBurnt`, 2)
      assert.equals(await burner.getCoverSharesBurnt(), stETHShares(0.1))
      assert.equals(await burner.getNonCoverSharesBurnt(), stETHShares(0.4))

      const receipt2 = await burner.commitSharesToBurn(ETH(0.4), { from: lido.address })

      assert.emits(receipt2, `StETHBurnt`, {
        isCover: false,
        amountOfStETH: StETH(0.4),
        amountOfShares: stETHShares(0.4),
      })

      assert.emitsNumberOfEvents(receipt2, `StETHBurnt`, 1)
      assert.equals(await burner.getCoverSharesBurnt(), stETHShares(0.1))
      assert.equals(await burner.getNonCoverSharesBurnt(), stETHShares(0.8))
    })
  })

  describe('Recover excess stETH', () => {
    beforeEach(async () => {
      // initial stETH balance is zero
      assert.equals(await lido.balanceOf(voting), StETH(0))
      // submit 10 ETH to mint 10 stETH
      await web3.eth.sendTransaction({ from: voting, to: lido.address, value: ETH(10) })
      // check 10 stETH minted on balance
      assert.equals(await lido.balanceOf(voting), StETH(10))
    })

    it(`can't recover requested for burn stETH`, async () => {
      // request to burn 7.1 stETH
      await lido.approve(burner.address, StETH(8), { from: voting })
      await burner.requestBurnMyStETHForCover(StETH(7.1), { from: voting })

      // excess stETH amount should be zero
      assert.equals(await burner.getExcessStETH(), StETH(0))
      assert.equals(await lido.balanceOf(treasury), StETH(0))
      assert.equals(await lido.balanceOf(burner.address), StETH(7.1))

      // should change nothing
      const receipt = await burner.recoverExcessStETH({ from: anotherAccount })
      assert.emitsNumberOfEvents(receipt, `ExcessStETHRecovered`, 0)

      // excess stETH amount didn't changed
      assert.equals(await burner.getExcessStETH(), StETH(0))

      // treasury and burner stETH balances are same
      assert.equals(await lido.balanceOf(treasury), StETH(0))
      assert.equals(await lido.balanceOf(burner.address), StETH(7.1))
    })

    it('recover some accidentally sent stETH', async () => {
      // 'accidentally' sent stETH from voting
      await lido.transfer(burner.address, StETH(2.3), { from: voting })

      // check burner and treasury balances before recovery
      assert.equals(await lido.balanceOf(burner.address), StETH(2.3))
      assert.equals(await lido.balanceOf(treasury), StETH(0))

      const sharesAmount2_3StETH = await lido.sharesOf(burner.address)
      const receipt = await burner.recoverExcessStETH({ from: anotherAccount })
      assert.emits(receipt, `ExcessStETHRecovered`, {
        requestedBy: anotherAccount,
        amountOfStETH: StETH(2.3),
        amountOfShares: sharesAmount2_3StETH,
      })

      // check burner and treasury balances after recovery
      assert.equals(await lido.balanceOf(burner.address), StETH(0))
      assert.equals(await lido.balanceOf(treasury), StETH(2.3))
    })

    it(`recover some accidentally sent stETH, while burning requests happened in the middle`, async () => {
      // 'accidentally' sent stETH from voting
      await lido.transfer(burner.address, StETH(5), { from: voting })

      // check balances
      assert.equals(await lido.balanceOf(voting), StETH(5))
      assert.equals(await lido.balanceOf(burner.address), StETH(5))

      // all of the burner's current stETH amount (5) can be recovered
      assert.equals(await lido.balanceOf(burner.address), StETH(5))
      assert.equals(await burner.getExcessStETH(), StETH(5))

      // approve burn request and check actual transferred amount
      await lido.approve(burner.address, StETH(3), { from: voting })
      await burner.requestBurnMyStETHForCover(StETH(3), { from: voting })
      assert.equals(await lido.balanceOf(voting), StETH(2))

      // excess stETH amount preserved
      assert.equals(await burner.getExcessStETH(), StETH(5))

      // approve another burn request and check actual transferred amount
      await lido.approve(burner.address, StETH(1), { from: voting })
      await burner.requestBurnMyStETH(StETH(1), { from: voting })
      assert.equals(await lido.balanceOf(voting), StETH(1))

      // excess stETH amount preserved
      assert.equals(await burner.getExcessStETH(), StETH(5))

      // finally burner balance is 5 stETH
      assert.equals(await lido.balanceOf(burner.address), StETH(9))
      assert.equals(await lido.balanceOf(treasury), StETH(0))

      // run recovery process, excess stETH amount (5)
      // should be transferred to the treasury
      const sharesAmount5stETH = await lido.getSharesByPooledEth(StETH(5))
      const receipt = await burner.recoverExcessStETH({ from: anotherAccount })
      assert.emits(receipt, `ExcessStETHRecovered`, {
        requestedBy: anotherAccount,
        amountOfStETH: StETH(5),
        amountOfShares: sharesAmount5stETH,
      })

      assert.equals(await burner.getExcessStETH(), StETH(0))

      assert.equals(await lido.balanceOf(treasury), StETH(5))
      assert.equals(await lido.balanceOf(burner.address), StETH(4))
    })
  })

  describe('Recover ERC20 / ERC721', () => {
    let mockERC20Token, mockNFT
    let nft1, nft2
    let totalERC20Supply

    beforeEach(async () => {
      // setup ERC20 token with total supply 100,000 units
      // mint two NFTs
      // the deployer solely holds newly created ERC20 and ERC721 items on setup

      nft1 = bn(666)
      nft2 = bn(777)
      totalERC20Supply = bn(1000000)

      mockERC20Token = await ERC20OZMock.new(totalERC20Supply, { from: deployer })

      assert.equals(await mockERC20Token.totalSupply(), totalERC20Supply)
      assert.equals(await mockERC20Token.balanceOf(deployer), totalERC20Supply)

      await mockERC20Token.balanceOf(deployer)

      mockNFT = await ERC721OZMock.new({ from: deployer })

      await mockNFT.mintToken(nft1, { from: deployer })
      await mockNFT.mintToken(nft2, { from: deployer })

      assert.equals(await mockNFT.balanceOf(deployer), bn(2))
      assert.equal(await mockNFT.ownerOf(nft1), deployer)
      assert.equal(await mockNFT.ownerOf(nft2), deployer)
    })

    it(`can't recover zero ERC20 amount`, async () => {
      await assert.revertsWithCustomError(
        burner.recoverERC20(mockERC20Token.address, bn(0), { from: voting }),
        `ZeroRecoveryAmount()`
      )
    })

    it(`can't recover zero-address ERC20`, async () => {
      await assert.reverts(burner.recoverERC20(ZERO_ADDRESS, bn(10), { from: anotherAccount }))
    })

    it(`can't recover stETH by recoverERC20`, async () => {
      // initial stETH balance is zero
      assert.equals(await lido.balanceOf(anotherAccount), StETH(0))
      // submit 10 ETH to mint 10 stETH
      await web3.eth.sendTransaction({ from: anotherAccount, to: lido.address, value: ETH(10) })
      // check 10 stETH minted on balance
      assert.equals(await lido.balanceOf(anotherAccount), StETH(10))
      // transfer 5 stETH to the burner account
      await lido.transfer(burner.address, StETH(5), { from: anotherAccount })

      assert.equals(await lido.balanceOf(anotherAccount), StETH(5))
      assert.equals(await lido.balanceOf(burner.address), StETH(5))

      // revert from anotherAccount
      // need to use recoverExcessStETH
      await assert.revertsWithCustomError(
        burner.recoverERC20(lido.address, StETH(1), { from: anotherAccount }),
        `StETHRecoveryWrongFunc()`
      )
    })

    it(`recover some accidentally sent ERC20`, async () => {
      // distribute deployer's balance among anotherAccount and burner
      await mockERC20Token.transfer(burner.address, bn(600000), { from: deployer })

      // check the resulted state
      assert.equals(await mockERC20Token.balanceOf(deployer), bn(400000))
      assert.equals(await mockERC20Token.balanceOf(voting), bn(0))
      assert.equals(await mockERC20Token.balanceOf(burner.address), bn(600000))

      // recover ERC20
      const firstReceipt = await burner.recoverERC20(mockERC20Token.address, bn(100000), { from: anotherAccount })
      assert.emits(firstReceipt, `ERC20Recovered`, {
        requestedBy: anotherAccount,
        token: mockERC20Token.address,
        amount: bn(100000),
      })

      // check balances again
      assert.equals(await mockERC20Token.balanceOf(burner.address), bn(500000))
      assert.equals(await mockERC20Token.balanceOf(treasury), bn(100000))
      assert.equals(await mockERC20Token.balanceOf(voting), bn(0))

      // recover last portion
      const lastReceipt = await burner.recoverERC20(mockERC20Token.address, bn(500000), { from: anotherAccount })
      assert.emits(lastReceipt, `ERC20Recovered`, {
        requestedBy: anotherAccount,
        token: mockERC20Token.address,
        amount: bn(500000),
      })

      // balance is zero already, have to be reverted
      await assert.reverts(
        burner.recoverERC20(mockERC20Token.address, bn(1), { from: anotherAccount }),
        `ERC20: transfer amount exceeds balance`
      )
    })

    it(`can't recover stETH via ERC721(NFT)`, async () => {
      // initial stETH balance is zero
      assert.equals(await lido.balanceOf(anotherAccount), StETH(0))
      // submit 10 ETH to mint 10 stETH
      await web3.eth.sendTransaction({ from: anotherAccount, to: lido.address, value: ETH(10) })
      // check 10 stETH minted on balance
      assert.equals(await lido.balanceOf(anotherAccount), StETH(10))
      // transfer 1 StETH to the burner account "accidentally"
      await lido.transfer(burner.address, StETH(1), { from: anotherAccount })
      // transfer 9 StETH to voting (only voting is allowed to request actual burning)
      await lido.transfer(voting, StETH(9), { from: anotherAccount })

      // request 9 StETH to be burned later
      await lido.approve(burner.address, StETH(9), { from: voting })
      await burner.requestBurnMyStETH(StETH(9), { from: voting })

      // check balances one last time
      assert.equals(await lido.balanceOf(anotherAccount), StETH(0))
      assert.equals(await lido.balanceOf(voting), StETH(0))
      assert.equals(await lido.balanceOf(burner.address), StETH(10))

      // ensure that excess amount is exactly 1 StETH
      assert.equals(await burner.getExcessStETH(), StETH(1))

      // can't abuse recoverERC721 API to perform griefing-like attack
      await assert.revertsWithCustomError(
        burner.recoverERC721(lido.address, StETH(1), { from: anotherAccount }),
        `StETHRecoveryWrongFunc()`
      )

      const receipt = await burner.recoverExcessStETH({ from: anotherAccount })
      assert.emits(receipt, `ExcessStETHRecovered`, { requestedBy: anotherAccount, amountOfStETH: StETH(1) })

      // ensure that excess amount is zero
      assert.equals(await burner.getExcessStETH(), StETH(0))
    })

    it(`can't recover zero-address ERC721(NFT)`, async () => {
      await assert.reverts(burner.recoverERC721(ZERO_ADDRESS, 0, { from: anotherAccount }))
    })

    it(`recover some accidentally sent NFTs`, async () => {
      // send nft1 to anotherAccount and nft2 to the burner address
      await mockNFT.transferFrom(deployer, anotherAccount, nft1, { from: deployer })
      await mockNFT.transferFrom(deployer, burner.address, nft2, { from: deployer })

      // check the new holders' rights
      assert.equals(await mockNFT.balanceOf(deployer), bn(0))
      assert.equals(await mockNFT.balanceOf(anotherAccount), bn(1))
      assert.equals(await mockNFT.balanceOf(burner.address), bn(1))

      // recover nft2 should work
      const receiptNfc2 = await burner.recoverERC721(mockNFT.address, nft2, { from: voting })
      assert.emits(receiptNfc2, `ERC721Recovered`, { requestedBy: voting, token: mockNFT.address, tokenId: nft2 })

      // but nft1 recovery should revert
      await assert.reverts(
        burner.recoverERC721(mockNFT.address, nft1, { from: voting }),
        `ERC721: transfer caller is not owner nor approved`
      )

      // send nft1 to burner and recover it
      await mockNFT.transferFrom(anotherAccount, burner.address, nft1, { from: anotherAccount })
      const receiptNft1 = await burner.recoverERC721(mockNFT.address, nft1, { from: voting })

      assert.emits(receiptNft1, `ERC721Recovered`, { requestedBy: voting, token: mockNFT.address, tokenId: nft1 })

      // check final NFT ownership state
      assert.equals(await mockNFT.balanceOf(treasury), bn(2))
      assert.equals(await mockNFT.ownerOf(nft1), treasury)
      assert.equals(await mockNFT.ownerOf(nft2), treasury)
    })
  })

  it(`Don't accept accidentally or intentionally sent ETH`, async () => {
    const burner_addr = burner.address

    // try to send 1 ETH, should be reverted with fallback defined reason
    await assert.revertsWithCustomError(
      web3.eth.sendTransaction({ from: anotherAccount, to: burner_addr, value: ETH(1) }),
      `DirectETHTransfer()`
    )
  })
})
