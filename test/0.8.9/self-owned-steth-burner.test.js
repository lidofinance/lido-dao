const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')
const { newDao, newApp } = require('../0.4.24/helpers/dao')

const { assert } = require('chai')

const SelfOwnerStETHBurner = artifacts.require('SelfOwnedStETHBurner.sol')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

const LidoMock = artifacts.require('LidoMock.sol')
const LidoOracleMock = artifacts.require('OracleMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')
const RewardEmulatorMock = artifacts.require('RewardEmulatorMock.sol')
const CompositePostRebaseBeaconReceiver = artifacts.require('CompositePostRebaseBeaconReceiver.sol')

const ERC20OZMock = artifacts.require('ERC20OZMock.sol')
const ERC721OZMock = artifacts.require('ERC721OZMock.sol')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')
// semantic aliases
const stETH = ETH
const stETHShares = ETH

contract('SelfOwnedStETHBurner', ([appManager, voting, deployer, depositor, anotherAccount, ...otherAccounts]) => {
  let oracle, lido, burner
  let treasuryAddr
  let dao, acl, operators
  let compositeBeaconReceiver

  beforeEach('deploy lido with dao', async () => {
    const lidoBase = await LidoMock.new({ from: deployer })
    oracle = await LidoOracleMock.new({ from: deployer })
    const depositContract = await DepositContractMock.new({ from: deployer })
    const nodeOperatorsRegistryBase = await NodeOperatorsRegistry.new({ from: deployer })

    const daoAclObj = await newDao(appManager)
    dao = daoAclObj.dao
    acl = daoAclObj.acl

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    let proxyAddress = await newApp(dao, 'lido', lidoBase.address, appManager)
    lido = await LidoMock.at(proxyAddress)
    await lido.resumeProtocolAndStaking()

    // NodeOperatorsRegistry
    proxyAddress = await newApp(dao, 'node-operators-registry', nodeOperatorsRegistryBase.address, appManager)
    operators = await NodeOperatorsRegistry.at(proxyAddress)
    await operators.initialize(lido.address)

    // Init the BURN_ROLE role and assign in to voting
    await acl.createPermission(voting, lido.address, await lido.BURN_ROLE(), appManager, { from: appManager })

    // Initialize the app's proxy.
    await lido.initialize(depositContract.address, oracle.address, operators.address)
    treasuryAddr = await lido.getInsuranceFund()

    await oracle.setPool(lido.address)
    await depositContract.reset()

    burner = await SelfOwnerStETHBurner.new(treasuryAddr, lido.address, voting, bn(0), bn(0), bn(4), { from: deployer })

    compositeBeaconReceiver = await CompositePostRebaseBeaconReceiver.new(voting, oracle.address, { from: deployer })
    compositeBeaconReceiver.addCallback(burner.address, { from: voting })

    await oracle.setBeaconReportReceiver(compositeBeaconReceiver.address)
  })

  describe('Requests and burn invocation', () => {
    const bnRound10 = (value) => bn(value).add(bn(5)).div(bn(10)).mul(bn(10))

    beforeEach(async () => {
      // initial balance is zero
      assertBn(await lido.balanceOf(anotherAccount), stETH(0))

      // stake ether to get an stETH in exchange
      await web3.eth.sendTransaction({ from: anotherAccount, to: lido.address, value: ETH(20) })
      await web3.eth.sendTransaction({ from: deployer, to: lido.address, value: ETH(30) })
      await web3.eth.sendTransaction({ from: voting, to: lido.address, value: ETH(25) })

      // check stETH balances
      assertBn(await lido.balanceOf(anotherAccount), stETH(20))
      assertBn(await lido.balanceOf(deployer), stETH(30))
      assertBn(await lido.balanceOf(voting), stETH(25))

      // unlock oracle account (allow transactions originated from oracle.address)
      await ethers.provider.send('hardhat_impersonateAccount', [oracle.address])

      // TRICK: send ether to oracle.address without fallback func invocation
      // the positive balance needed to pass github CI checks when starting transactions from oracle.address
      // P.S. `hardhat_setBalance` doesn't exist for the our HardHat version
      const rewarder = await RewardEmulatorMock.new(oracle.address, { from: anotherAccount })
      await rewarder.reward({ from: anotherAccount, value: ETH(1) })

      assertBn(await web3.eth.getBalance(oracle.address), ETH(1))
      assertBn(await burner.getBurnAmountPerRunQuota(), bn(4))

      // maximize burn amount per single run
      await burner.setBurnAmountPerRunQuota(bn(10000), { from: voting })
      assertBn(await burner.getBurnAmountPerRunQuota(), bn(10000))
    })

    it(`init counters and burn amount per run works`, async () => {
      let newBurner = await SelfOwnerStETHBurner.new(treasuryAddr, lido.address, voting, bn(0), bn(0), bn(5), { from: deployer })

      assertBn(await newBurner.getCoverSharesBurnt(), bn(0))
      assertBn(await newBurner.getNonCoverSharesBurnt(), bn(0))
      assertBn(await newBurner.getBurnAmountPerRunQuota(), bn(5))

      newBurner = await SelfOwnerStETHBurner.new(treasuryAddr, lido.address, voting, bn(123), bn(456), bn(777), { from: deployer })

      assertBn(await newBurner.getCoverSharesBurnt(), bn(123))
      assertBn(await newBurner.getNonCoverSharesBurnt(), bn(456))
      assertBn(await newBurner.getBurnAmountPerRunQuota(), bn(777))
    })

    it(`can't use zero init addresses or bad burn amount per run`, async () => {
      assertRevert(
        SelfOwnerStETHBurner.new(treasuryAddr, lido.address, ZERO_ADDRESS, bn(0), bn(0), bn(4), { from: deployer }),
        `VOTING_ZERO_ADDRESS`
      )

      assertRevert(
        SelfOwnerStETHBurner.new(treasuryAddr, ZERO_ADDRESS, voting, bn(0), bn(0), bn(4), { from: deployer }),
        `LIDO_ZERO_ADDRESS`
      )

      assertRevert(
        SelfOwnerStETHBurner.new(ZERO_ADDRESS, lido.address, voting, bn(0), bn(0), bn(4), { from: deployer }),
        `TREASURY_ZERO_ADDRESS`
      )

      assertRevert(
        SelfOwnerStETHBurner.new(treasuryAddr, lido.address, voting, bn(0), bn(0), bn(0), { from: deployer }),
        `ZERO_BURN_AMOUNT_PER_RUN`
      )

      assertRevert(
        SelfOwnerStETHBurner.new(treasuryAddr, lido.address, voting, bn(0), bn(0), bn(10001), { from: deployer }),
        `TOO_LARGE_BURN_AMOUNT_PER_RUN`
      )
    })

    it(`reverts on zero stETH amount cover/non-cover request`, async () => {
      // provide non-zero allowance
      await lido.approve(burner.address, stETH(1), { from: voting })

      // but zero request on cover
      assertRevert(burner.requestBurnMyStETHForCover(stETH(0), { from: voting }), `ZERO_BURN_AMOUNT`)
      // and zero request on non-cover
      assertRevert(burner.requestBurnMyStETH(stETH(0), { from: voting }), `ZERO_BURN_AMOUNT`)
    })

    it(`reverts on burn request from non-voting address`, async () => {
      // provide allowance and request burn for cover
      await lido.approve(burner.address, stETH(8), { from: anotherAccount })

      // anotherAccount can't place burn request, only voting can
      assertRevert(burner.requestBurnMyStETHForCover(stETH(8), { from: anotherAccount }), `MSG_SENDER_MUST_BE_VOTING`)

      await lido.approve(burner.address, stETH(8), { from: deployer })

      // event deployer can't place burn request
      assertRevert(burner.requestBurnMyStETH(stETH(8), { from: deployer }), `MSG_SENDER_MUST_BE_VOTING`)
    })

    it(`request shares burn for cover works`, async () => {
      // allowance should be set explicitly to request burning
      assertRevert(burner.requestBurnMyStETHForCover(stETH(8), { from: voting }), `TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE`)

      // provide allowance and request burn for cover
      const sharesAmount8StETH = await lido.getSharesByPooledEth(stETH(8))
      await lido.approve(burner.address, stETH(8), { from: voting })
      let receipt = await burner.requestBurnMyStETHForCover(stETH(8), { from: voting })

      assertEvent(receipt, `StETHBurnRequested`, {
        expectedArgs: { isCover: true, requestedBy: voting, amount: stETH(8), sharesAmount: sharesAmount8StETH }
      })

      // check stETH balances
      assertBn(await lido.balanceOf(burner.address), stETH(8))
      assertBn(await lido.balanceOf(voting), stETH(17))

      const sharesAmount12 = sharesAmount8StETH.mul(bn(3)).div(bn(2))
      await lido.approve(burner.address, stETH(13), { from: voting })
      receipt = await burner.requestBurnMyStETH(stETH(12), { from: voting })

      assertEvent(receipt, `StETHBurnRequested`, {
        expectedArgs: { isCover: false, requestedBy: voting, amount: stETH(12), sharesAmount: sharesAmount12 }
      })

      // check stETH balances again, we didn't execute the actual burn
      assertBn(await lido.balanceOf(burner.address), stETH(20))
      assertBn(await lido.balanceOf(voting), stETH(5))
    })

    it(`invoke an oracle without requested burn works`, async () => {
      // someone accidentally transferred stETH
      await lido.transfer(burner.address, stETH(5.6), { from: deployer })
      await lido.transfer(burner.address, stETH(4.1), { from: anotherAccount })

      assertBn(await lido.balanceOf(burner.address), stETH(9.7))

      // only the Lido oracle can call this func, but there is nothing to burn
      await burner.processLidoOracleReport(ETH(10), ETH(12), bn(1000), { from: deployer })

      // mimic the Lido oracle for the callback invocation
      const receipt = await burner.processLidoOracleReport(ETH(10), ETH(12), bn(1000), { from: oracle.address })

      // no burn requests => zero events
      assertAmountOfEvents(receipt, `StETHBurnt`, { expectedAmount: 0 })

      // the balance should be the same
      assertBn(await lido.balanceOf(burner.address), stETH(9.7))
    })

    it(`invoke an oracle with the one type (cover/non-cover) pending requests works`, async () => {
      // someone accidentally transferred stETH
      await lido.transfer(burner.address, stETH(3.1), { from: deployer })
      await lido.transfer(burner.address, stETH(4.0), { from: anotherAccount })

      // request non-cover burn (accidentally approved more than needed)
      await lido.approve(burner.address, stETH(7), { from: voting })
      await burner.requestBurnMyStETH(stETH(6), { from: voting })

      const burnerShares = await lido.sharesOf(burner.address)
      const sharesToBurn = await lido.getSharesByPooledEth(stETH(6))

      assertBn(await lido.balanceOf(burner.address), stETH(6 + 3.1 + 4.0))

      assertRevert(
        // should revert
        burner.processLidoOracleReport(ETH(10), ETH(12), bn(1000), { from: deployer }),
        `APP_AUTH_FAILED`
      )

      assertRevert(
        // should revert even from oracle.address cause burner don't have BURN_ROLE yet
        burner.processLidoOracleReport(ETH(10), ETH(12), bn(1000), { from: oracle.address }),
        `APP_AUTH_FAILED`
      )

      // grant permissions to the Lido.burnShares method
      await acl.grantPermission(burner.address, lido.address, await lido.BURN_ROLE(), { from: appManager })
      const receipt = await burner.processLidoOracleReport(ETH(10), ETH(12), bn(1000), { from: oracle.address })

      assertEvent(receipt, `StETHBurnt`, { expectedArgs: { isCover: false, amount: stETH(6), sharesAmount: sharesToBurn } })

      assertAmountOfEvents(receipt, `StETHBurnt`, { expectedAmount: 1 })

      // the balance should be lowered by requested to burn
      assertBn(await lido.sharesOf(burner.address), burnerShares.sub(sharesToBurn))
    })

    it(`invoke an oracle with requested cover AND non-cover burn works`, async () => {
      // someone accidentally transferred stETH
      await lido.transfer(burner.address, stETH(2.1), { from: deployer })
      await lido.transfer(burner.address, stETH(3.1), { from: anotherAccount })

      await lido.approve(burner.address, stETH(3), { from: voting })

      const sharesAmount0_5StETH = await lido.getSharesByPooledEth(stETH(0.5))
      const sharesAmount1_5StETH = sharesAmount0_5StETH.mul(bn(3))

      const receiptCover = await burner.requestBurnMyStETHForCover(stETH(1.5), { from: voting })

      assertEvent(receiptCover, `StETHBurnRequested`, {
        expectedArgs: { isCover: true, requestedBy: voting, amount: stETH(1.5), sharesAmount: sharesAmount1_5StETH }
      })

      const receiptNonCover = await burner.requestBurnMyStETH(stETH(0.5), { from: voting })

      assertEvent(receiptNonCover, `StETHBurnRequested`, {
        expectedArgs: { isCover: false, requestedBy: voting, amount: stETH(0.5), sharesAmount: sharesAmount0_5StETH }
      })

      const burnerShares = await lido.sharesOf(burner.address)
      const sharesToBurn = sharesAmount0_5StETH.add(sharesAmount1_5StETH)

      assertBn(await lido.balanceOf(burner.address), stETH(7.2))

      assertRevert(burner.processLidoOracleReport(ETH(9), ETH(10), bn(500), { from: deployer }), `APP_AUTH_FAILED`)

      assertRevert(
        // even
        burner.processLidoOracleReport(ETH(6), ETH(7), bn(100), { from: oracle.address }),
        `APP_AUTH_FAILED`
      )

      await acl.grantPermission(burner.address, lido.address, await lido.BURN_ROLE(), { from: appManager })
      const receipt = await burner.processLidoOracleReport(ETH(3), ETH(4), bn(100), { from: oracle.address })

      assertEvent(receipt, `StETHBurnt`, {
        index: 0,
        expectedArgs: { isCover: true, amount: stETH(1.5), sharesAmount: sharesAmount1_5StETH }
      })

      assertEvent(receipt, `StETHBurnt`, {
        index: 1,
        expectedArgs: { isCover: false, amount: stETH(0.5), sharesAmount: sharesAmount0_5StETH }
      })

      // cover + non-cover events
      assertAmountOfEvents(receipt, `StETHBurnt`, { expectedAmount: 2 })

      // the balance should be lowered by requested to burn
      assertBn(await lido.sharesOf(burner.address), burnerShares.sub(sharesToBurn))
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

      assertBn(await burner.getCoverSharesBurnt(), expectedCoverSharesBurnt)
      assertBn(await burner.getNonCoverSharesBurnt(), expectedNonCoverSharesBurnt)

      await lido.approve(burner.address, allowance, { from: voting })
      await acl.grantPermission(burner.address, lido.address, await lido.BURN_ROLE(), { from: appManager })

      // going through the defined arrays to check the burnt counters
      while (coverSharesAmount.length > 0) {
        const currentCoverSharesAmount = coverSharesAmount.pop()
        const currentNonCoverSharesAmount = nonCoverSharesAmount.pop()

        // we should re-estimate share to eth due to happened token rebase
        const coverStETHAmountToBurn = await lido.getPooledEthByShares(currentCoverSharesAmount)
        const nonCoverStETHAmountToBurn = await lido.getPooledEthByShares(currentNonCoverSharesAmount)

        await burner.requestBurnMyStETHForCover(coverStETHAmountToBurn, { from: voting })
        await burner.requestBurnMyStETH(nonCoverStETHAmountToBurn, { from: voting })

        await burner.processLidoOracleReport(ETH(1), ETH(1), bn(100), { from: oracle.address })

        // accumulate burnt shares
        expectedCoverSharesBurnt = expectedCoverSharesBurnt.add(currentCoverSharesAmount)
        expectedNonCoverSharesBurnt = expectedNonCoverSharesBurnt.add(currentNonCoverSharesAmount)

        // to address finite precision issues we remove least significant digit
        assertBn(bnRound10(await burner.getCoverSharesBurnt()), bnRound10(expectedCoverSharesBurnt))
        assertBn(bnRound10(await burner.getNonCoverSharesBurnt()), bnRound10(expectedNonCoverSharesBurnt))
      }
    })

    it(`a positive rebase happens after the burn application`, async () => {
      await lido.approve(burner.address, stETH(25), { from: voting })
      await burner.requestBurnMyStETHForCover(stETH(25), { from: voting })

      assertBn(await lido.balanceOf(burner.address), stETH(25))
      assertBn(await lido.balanceOf(voting), stETH(0))
      assertBn(await lido.balanceOf(anotherAccount), stETH(20))
      assertBn(await lido.balanceOf(deployer), stETH(30))

      await acl.grantPermission(burner.address, lido.address, await lido.BURN_ROLE(), { from: appManager })
      await burner.processLidoOracleReport(ETH(1), ETH(1), bn(100), { from: oracle.address })

      assertBn(await lido.balanceOf(burner.address), stETH(0))
      assertBn(await lido.balanceOf(voting), stETH(0))

      // 1/3 of the shares amount was burnt, so remaining stETH becomes more expensive
      // totalShares become 2/3 of the previous value
      // so the new share price increases by 3/2
      assertBn(await lido.balanceOf(deployer), bn(stETH(30)).mul(bn(3)).div(bn(2)))
      assertBn(await lido.balanceOf(anotherAccount), bn(stETH(20)).mul(bn(3)).div(bn(2)))
    })

    it(`revert on illegal attempts to set the max burn amount per run`, async () => {
      assertRevert(burner.setBurnAmountPerRunQuota(bn(10000), { from: deployer }), `MSG_SENDER_MUST_BE_VOTING`)

      assertRevert(burner.setBurnAmountPerRunQuota(bn(0), { from: voting }), `ZERO_BURN_AMOUNT_PER_RUN`)

      assertRevert(burner.setBurnAmountPerRunQuota(bn(10001), { from: voting }), `TOO_LARGE_BURN_AMOUNT_PER_RUN`)
    })

    it(`set max burn amount per run works (cover)`, async () => {
      // let the single burn be limited to a 120 basis points (1.2%)
      const setBurnAmountQuotaReceipt = await burner.setBurnAmountPerRunQuota(bn(120), { from: voting })
      assertEvent(setBurnAmountQuotaReceipt, `BurnAmountPerRunQuotaChanged`, { expectedArgs: { maxBurnAmountPerRunBasisPoints: bn(120) } })
      assertAmountOfEvents(setBurnAmountQuotaReceipt, `BurnAmountPerRunQuotaChanged`, { expectedAmount: 1 })

      // grant permissions to the Lido.burnShares method
      await acl.grantPermission(burner.address, lido.address, await lido.BURN_ROLE(), { from: appManager })

      assertBn(await lido.getTotalShares(), stETHShares(75))

      // so the max amount to burn per single run is 75*10^18 * 0.012 = 0.9*10^18
      await lido.approve(burner.address, stETH(25), { from: voting })
      await burner.requestBurnMyStETHForCover(stETH(0.9), { from: voting })

      assertBn(await lido.sharesOf(burner.address), stETHShares(0.9))
      const receipt = await burner.processLidoOracleReport(bn(1), bn(2), bn(3), { from: oracle.address })
      assertBn(await lido.sharesOf(burner.address), stETHShares(0))
      assertEvent(receipt, `StETHBurnt`, { expectedArgs: { isCover: true, amount: stETH(0.9), sharesAmount: stETHShares(0.9) } })
      assertAmountOfEvents(receipt, `StETHBurnt`, { expectedAmount: 1 })

      await burner.requestBurnMyStETHForCover(await lido.getPooledEthByShares(stETHShares(0.1)), { from: voting })
      assertBn(bnRound10(await lido.sharesOf(burner.address)), bnRound10(stETHShares(0.1)))
      await burner.processLidoOracleReport(bn(1), bn(2), bn(3), { from: oracle.address })
      assertBn(await lido.sharesOf(burner.address), stETHShares(0))

      assertBn(bnRound10(await burner.getCoverSharesBurnt()), bnRound10(stETHShares(1)))
      assertBn(await burner.getNonCoverSharesBurnt(), stETHShares(0))

      assertBn(bnRound10(await lido.getTotalShares()), stETHShares(74))
      await burner.requestBurnMyStETHForCover(await lido.getPooledEthByShares(stETHShares(1)), { from: voting })

      assertBn(bnRound10(await lido.sharesOf(burner.address)), bnRound10(stETHShares(1)))
      await burner.processLidoOracleReport(bn(1), bn(2), bn(3), { from: oracle.address })

      // 1 - 74*10^18 * 0.012 = 0.112*10^18
      assertBn(bnRound10(await lido.sharesOf(burner.address)), bnRound10(stETHShares(0.112)))
      await burner.processLidoOracleReport(bn(1), bn(2), bn(3), { from: oracle.address })
      assertBn(await lido.sharesOf(burner.address), stETHShares(0))

      assertBn(bnRound10(await burner.getCoverSharesBurnt()), bnRound10(stETHShares(2)))
      assertBn(await burner.getNonCoverSharesBurnt(), stETHShares(0))
    })

    it(`set max burn amount per run works (noncover)`, async () => {
      // let the single burn be limited to a 120 basis points (1.2%)
      await burner.setBurnAmountPerRunQuota(bn(120), { from: voting })
      // grant permissions to the Lido.burnShares method
      await acl.grantPermission(burner.address, lido.address, await lido.BURN_ROLE(), { from: appManager })

      assertBn(await lido.getTotalShares(), stETHShares(75))

      // so the max amount to burn per single run is 75*10^18 * 0.012 = 0.9*10^18
      await lido.approve(burner.address, stETH(25), { from: voting })
      await burner.requestBurnMyStETH(stETH(0.9), { from: voting })

      assertBn(await lido.sharesOf(burner.address), stETHShares(0.9))
      const receipt = await burner.processLidoOracleReport(bn(1), bn(2), bn(3), { from: oracle.address })
      assertEvent(receipt, `StETHBurnt`, { expectedArgs: { isCover: false, amount: stETH(0.9), sharesAmount: stETHShares(0.9) } })
      assertAmountOfEvents(receipt, `StETHBurnt`, { expectedAmount: 1 })
      assertBn(await lido.sharesOf(burner.address), stETHShares(0))

      await burner.requestBurnMyStETH(await lido.getPooledEthByShares(stETHShares(0.1)), { from: voting })
      assertBn(bnRound10(await lido.sharesOf(burner.address)), bnRound10(stETHShares(0.1)))
      await burner.processLidoOracleReport(bn(1), bn(2), bn(3), { from: oracle.address })
      assertBn(await lido.sharesOf(burner.address), stETHShares(0))

      assertBn(bnRound10(await lido.getTotalShares()), stETHShares(74))
      await burner.requestBurnMyStETH(await lido.getPooledEthByShares(stETHShares(1)), { from: voting })

      assertBn(bnRound10(await lido.sharesOf(burner.address)), bnRound10(stETHShares(1)))
      await burner.processLidoOracleReport(bn(1), bn(2), bn(3), { from: oracle.address })

      assertBn(bnRound10(await burner.getCoverSharesBurnt()), stETHShares(0))
      assertBn(bnRound10(await burner.getNonCoverSharesBurnt()), bnRound10(stETHShares(1.888)))

      assertBn(bnRound10(await lido.sharesOf(burner.address)), bnRound10(stETHShares(0.112)))
      await burner.processLidoOracleReport(bn(1), bn(2), bn(3), { from: oracle.address })
      assertBn(await lido.sharesOf(burner.address), stETHShares(0))

      assertBn(await burner.getCoverSharesBurnt(), bnRound10(stETHShares(0)))
      assertBn(bnRound10(await burner.getNonCoverSharesBurnt()), bnRound10(stETHShares(2)))
    })

    it(`set max burn amount per run works (mix cover/noncover)`, async () => {
      // let the single burn be limited to a 120 basis points (1.2%)
      await burner.setBurnAmountPerRunQuota(bn(120), { from: voting })
      // grant permissions to the Lido.burnShares method
      await acl.grantPermission(burner.address, lido.address, await lido.BURN_ROLE(), { from: appManager })

      assertBn(await lido.getTotalShares(), stETH(75))

      // so the max amount to burn per single run is 75*10^18 * 0.012 = 0.9*10^18
      await lido.approve(burner.address, stETH(25), { from: voting })
      await burner.requestBurnMyStETH(stETH(0.8), { from: voting })
      await burner.requestBurnMyStETHForCover(stETH(0.1), { from: voting })

      assertBn(await lido.sharesOf(burner.address), stETHShares(0.9))
      const receipt = await burner.processLidoOracleReport(bn(1), bn(2), bn(3), { from: oracle.address })
      assertBn(await lido.sharesOf(burner.address), stETHShares(0))
      assertEvent(receipt, `StETHBurnt`, { index: 0, expectedArgs: { isCover: true, amount: stETH(0.1), sharesAmount: stETHShares(0.1) } })
      assertEvent(receipt, `StETHBurnt`, { index: 1, expectedArgs: { isCover: false, amount: stETH(0.8), sharesAmount: stETHShares(0.8) } })
      assertAmountOfEvents(receipt, `StETHBurnt`, { expectedAmount: 2 })
      assertBn(await burner.getCoverSharesBurnt(), stETHShares(0.1))
      assertBn(await burner.getNonCoverSharesBurnt(), stETHShares(0.8))

      await burner.requestBurnMyStETHForCover(await lido.getPooledEthByShares(stETHShares(0.03)), { from: voting })
      await burner.requestBurnMyStETH(await lido.getPooledEthByShares(stETHShares(0.07)), { from: voting })
      assertBn(bnRound10(await lido.sharesOf(burner.address)), bnRound10(stETHShares(0.1)))
      await burner.processLidoOracleReport(bn(1), bn(2), bn(3), { from: oracle.address })
      assertBn(await lido.sharesOf(burner.address), stETHShares(0))
      assertBn(bnRound10(await burner.getCoverSharesBurnt()), bnRound10(stETHShares(0.13)))
      assertBn(bnRound10(await burner.getNonCoverSharesBurnt()), bnRound10(stETHShares(0.87)))

      assertBn(bnRound10(await lido.getTotalShares()), stETHShares(74))
      await burner.requestBurnMyStETHForCover(await lido.getPooledEthByShares(stETHShares(0.99)), { from: voting })
      await burner.requestBurnMyStETH(await lido.getPooledEthByShares(stETHShares(0.01)), { from: voting })

      assertBn(bnRound10(await lido.sharesOf(burner.address)), bnRound10(stETHShares(1)))
      const middleReceipt = await burner.processLidoOracleReport(bn(1), bn(2), bn(3), { from: oracle.address })
      assertAmountOfEvents(middleReceipt, `StETHBurnt`, { expectedAmount: 1 })
      assertEvent(middleReceipt, `StETHBurnt`, { expectedArgs: { isCover: true } })
      assertBn(bnRound10(await burner.getCoverSharesBurnt()), bnRound10(stETHShares(1.018)))
      assertBn(bnRound10(await burner.getNonCoverSharesBurnt()), bnRound10(stETHShares(0.87)))

      assertBn(bnRound10(await lido.sharesOf(burner.address)), bnRound10(stETHShares(0.112)))
      const lastReceipt = await burner.processLidoOracleReport(bn(1), bn(2), bn(3), { from: oracle.address })
      assertBn(await lido.sharesOf(burner.address), stETHShares(0))
      assertAmountOfEvents(lastReceipt, `StETHBurnt`, { expectedAmount: 2 })
      assertEvent(lastReceipt, `StETHBurnt`, { index: 0, expectedArgs: { isCover: true } })
      assertEvent(lastReceipt, `StETHBurnt`, { index: 1, expectedArgs: { isCover: false } })

      assertBn(bnRound10(await burner.getCoverSharesBurnt()), bnRound10(stETHShares(1.12)))
      assertBn(bnRound10(await burner.getNonCoverSharesBurnt()), bnRound10(stETHShares(0.88)))
    })
  })

  describe('Granular permissions setup works', () => {
    let sharesToBurn = 0

    const padWithoutPrefix = (hex, bytesLength) => {
      const absentZeroes = bytesLength * 2 + 2 - hex.length
      if (absentZeroes > 0) hex = '0'.repeat(absentZeroes) + hex.substr(2)
      return hex
    }

    beforeEach('Setup permissions', async () => {
      assertBn(await lido.balanceOf(voting), stETH(0))
      await web3.eth.sendTransaction({ from: voting, to: lido.address, value: ETH(21) })
      assertBn(await lido.balanceOf(voting), stETH(21))

      await ethers.provider.send('hardhat_impersonateAccount', [oracle.address])
      await ethers.provider.send('hardhat_impersonateAccount', [burner.address])

      // TRICK: send ether to oracle.address and burner.address without fallback func invocation
      // the positive balance needed to pass github CI checks when starting transactions from oracle.address and burner.address
      // P.S. `hardhat_setBalance` doesn't exist for the our HardHat version
      const oracleRewarder = await RewardEmulatorMock.new(oracle.address, { from: voting })
      await oracleRewarder.reward({ from: voting, value: ETH(1) })

      const burnerRewarder = await RewardEmulatorMock.new(burner.address, { from: voting })
      await burnerRewarder.reward({ from: voting, value: ETH(1) })

      await lido.approve(burner.address, stETH(10), { from: voting })
      await burner.requestBurnMyStETHForCover(stETH(10), { from: voting })

      assertBn(await lido.balanceOf(voting), stETH(11))
      assertBn(await lido.balanceOf(burner.address), stETH(10))

      sharesToBurn = await lido.getSharesByPooledEth(stETH(10))

      await acl.revokePermission(voting, lido.address, await lido.BURN_ROLE())

      /*
       * Granular permissions setup.
       * Depends on Aragon OS ACL parameters interpretation.
       *
       * See: https://hack.aragon.org/docs/aragonos-ref#parameter-interpretation
       *
       * See also one the most relevant examples:
       * https://github.com/aragon/aragonOS/blob/4bbe3e96fc5a3aa6340b11ec67e6550029da7af9/test/contracts/apps/app_acl.js#L123
       *
       * We need to allow burn if and only if the `_account` param equals to `burner.address`
       * function burnShares(address _account, uint256 _sharesAmount)
       *
       * `_account` is the arg0 (uint8)
       * 'equals' means Op.Eq (uint8)
       * burner.address should be extended from uint160 to uint240
       *
       * So the composed permission param is just a uint256 (uint8 + uint8 + uint240) value
       */

      const composePermissionParam = (addr) => {
        const argId = '0x00' // arg 0
        const op = '01' // operation eq (Op.Eq == 1)
        const value = padWithoutPrefix(burner.address, 240 / 8) // pad 160bit -> 240bit, remove '0x'
        assert.equal(value.length, (240 / 8) * 2) // check the value length explicitly

        const paramStr = `${argId}${op}${value}`
        assert.equal(paramStr.length, (256 / 8) * 2 + 2)

        return bn(paramStr)
      }

      const param = composePermissionParam(burner.address)

      await acl.grantPermissionP(burner.address, lido.address, await lido.BURN_ROLE(), [param], { from: appManager })
    })

    it(`the burner can burn self-owned stETH`, async () => {
      assertBn(await lido.sharesOf(burner.address), sharesToBurn)
      await lido.burnShares(burner.address, sharesToBurn, { from: burner.address })
      assertBn(await lido.sharesOf(burner.address), bn(0))
    })

    it(`no one can burn non-owned by themselves stETH`, async () => {
      assertRevert(lido.burnShares(anotherAccount, sharesToBurn, { from: burner.address }), `APP_AUTH_FAILED`)
    })

    it(`no one can burn even self-owned stETH`, async () => {
      assertRevert(lido.burnShares(anotherAccount, sharesToBurn, { from: anotherAccount }), `APP_AUTH_FAILED`)
    })

    it(`voting also can't burn stETH since new permissions setup`, async () => {
      assertRevert(lido.burnShares(burner.address, sharesToBurn, { from: voting }), `APP_AUTH_FAILED`)
    })
  })

  describe('Recover excess stETH', () => {
    beforeEach(async () => {
      // initial stETH balance is zero
      assertBn(await lido.balanceOf(voting), stETH(0))
      // submit 10 ETH to mint 10 stETH
      await web3.eth.sendTransaction({ from: voting, to: lido.address, value: ETH(10) })
      // check 10 stETH minted on balance
      assertBn(await lido.balanceOf(voting), stETH(10))
    })

    it(`can't recover requested for burn stETH`, async () => {
      // request to burn 7.1 stETH
      await lido.approve(burner.address, stETH(8), { from: voting })
      await burner.requestBurnMyStETHForCover(stETH(7.1), { from: voting })

      // excess stETH amount should be zero
      assertBn(await burner.getExcessStETH(), stETH(0))
      assertBn(await lido.balanceOf(treasuryAddr), stETH(0))
      assertBn(await lido.balanceOf(burner.address), stETH(7.1))

      // should change nothing
      const receipt = await burner.recoverExcessStETH()
      assertAmountOfEvents(receipt, `ExcessStETHRecovered`, { expectedAmount: 0 })

      // excess stETH amount didn't changed
      assertBn(await burner.getExcessStETH(), stETH(0))

      // treasury and burner stETH balances are same
      assertBn(await lido.balanceOf(treasuryAddr), stETH(0))
      assertBn(await lido.balanceOf(burner.address), stETH(7.1))
    })

    it('recover some accidentally sent stETH', async () => {
      // 'accidentally' sent stETH from voting
      await lido.transfer(burner.address, stETH(2.3), { from: voting })

      // check burner and treasury balances before recovery
      assertBn(await lido.balanceOf(burner.address), stETH(2.3))
      assertBn(await lido.balanceOf(treasuryAddr), stETH(0))

      const sharesAmount2_3StETH = await lido.sharesOf(burner.address)
      const receipt = await burner.recoverExcessStETH({ from: deployer })
      assertEvent(receipt, `ExcessStETHRecovered`, {
        expectedArgs: { requestedBy: deployer, amount: stETH(2.3), sharesAmount: sharesAmount2_3StETH }
      })

      // check burner and treasury balances after recovery
      assertBn(await lido.balanceOf(burner.address), stETH(0))
      assertBn(await lido.balanceOf(treasuryAddr), stETH(2.3))
    })

    it(`recover some accidentally sent stETH, while burning requests happened in the middle`, async () => {
      // 'accidentally' sent stETH from voting
      await lido.transfer(burner.address, stETH(5), { from: voting })

      // check balances
      assertBn(await lido.balanceOf(voting), stETH(5))
      assertBn(await lido.balanceOf(burner.address), stETH(5))

      // all of the burner's current stETH amount (5) can be recovered
      assertBn(await lido.balanceOf(burner.address), stETH(5))
      assertBn(await burner.getExcessStETH(), stETH(5))

      // approve burn request and check actual transferred amount
      await lido.approve(burner.address, stETH(3), { from: voting })
      await burner.requestBurnMyStETHForCover(stETH(3), { from: voting })
      assertBn(await lido.balanceOf(voting), stETH(2))

      // excess stETH amount preserved
      assertBn(await burner.getExcessStETH(), stETH(5))

      // approve another burn request and check actual transferred amount
      await lido.approve(burner.address, stETH(1), { from: voting })
      await burner.requestBurnMyStETH(stETH(1), { from: voting })
      assertBn(await lido.balanceOf(voting), stETH(1))

      // excess stETH amount preserved
      assertBn(await burner.getExcessStETH(), stETH(5))

      // finally burner balance is 5 stETH
      assertBn(await lido.balanceOf(burner.address), stETH(9))
      assertBn(await lido.balanceOf(treasuryAddr), stETH(0))

      // run recovery process, excess stETH amount (5)
      // should be transferred to the treasury
      const sharesAmount5stETH = await lido.getSharesByPooledEth(stETH(5))
      const receipt = await burner.recoverExcessStETH({ from: anotherAccount })
      assertEvent(receipt, `ExcessStETHRecovered`, {
        expectedArgs: { requestedBy: anotherAccount, amount: stETH(5), sharesAmount: sharesAmount5stETH }
      })

      assertBn(await burner.getExcessStETH(), stETH(0))

      assertBn(await lido.balanceOf(treasuryAddr), stETH(5))
      assertBn(await lido.balanceOf(burner.address), stETH(4))
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

      assertBn(await mockERC20Token.totalSupply(), totalERC20Supply)
      assertBn(await mockERC20Token.balanceOf(deployer), totalERC20Supply)

      await mockERC20Token.balanceOf(deployer)

      mockNFT = await ERC721OZMock.new({ from: deployer })

      await mockNFT.mintToken(nft1, { from: deployer })
      await mockNFT.mintToken(nft2, { from: deployer })

      assertBn(await mockNFT.balanceOf(deployer), bn(2))
      assert.equal(await mockNFT.ownerOf(nft1), deployer)
      assert.equal(await mockNFT.ownerOf(nft2), deployer)
    })

    it(`can't recover zero ERC20 amount`, async () => {
      assertRevert(burner.recoverERC20(mockERC20Token.address, bn(0)), `ZERO_RECOVERY_AMOUNT`)
    })

    it(`can't recover zero-address ERC20`, async () => {
      assertRevert(burner.recoverERC20(ZERO_ADDRESS, bn(10)))
    })

    it(`can't recover stETH by recoverERC20`, async () => {
      // initial stETH balance is zero
      assertBn(await lido.balanceOf(anotherAccount), stETH(0))
      // submit 10 ETH to mint 10 stETH
      await web3.eth.sendTransaction({ from: anotherAccount, to: lido.address, value: ETH(10) })
      // check 10 stETH minted on balance
      assertBn(await lido.balanceOf(anotherAccount), stETH(10))
      // transfer 5 stETH to the burner account
      await lido.transfer(burner.address, stETH(5), { from: anotherAccount })

      assertBn(await lido.balanceOf(anotherAccount), stETH(5))
      assertBn(await lido.balanceOf(burner.address), stETH(5))

      // revert from anotherAccount
      // need to use recoverExcessStETH
      assertRevert(burner.recoverERC20(lido.address, stETH(1), { from: anotherAccount }), `STETH_RECOVER_WRONG_FUNC`)

      // revert from deployer
      // same reason
      assertRevert(burner.recoverERC20(lido.address, stETH(1), { from: deployer }), `STETH_RECOVER_WRONG_FUNC`)
    })

    it(`recover some accidentally sent ERC20`, async () => {
      // distribute deployer's balance among anotherAccount and burner
      await mockERC20Token.transfer(anotherAccount, bn(400000), { from: deployer })
      await mockERC20Token.transfer(burner.address, bn(600000), { from: deployer })

      // check the resulted state
      assertBn(await mockERC20Token.balanceOf(deployer), bn(0))
      assertBn(await mockERC20Token.balanceOf(anotherAccount), bn(400000))
      assertBn(await mockERC20Token.balanceOf(burner.address), bn(600000))

      // recover ERC20
      const firstReceipt = await burner.recoverERC20(mockERC20Token.address, bn(100000), { from: deployer })
      assertEvent(firstReceipt, `ERC20Recovered`, {
        expectedArgs: { requestedBy: deployer, token: mockERC20Token.address, amount: bn(100000) }
      })

      const secondReceipt = await burner.recoverERC20(mockERC20Token.address, bn(400000), { from: anotherAccount })
      assertEvent(secondReceipt, `ERC20Recovered`, {
        expectedArgs: { requestedBy: anotherAccount, token: mockERC20Token.address, amount: bn(400000) }
      })

      // check balances again
      assertBn(await mockERC20Token.balanceOf(burner.address), bn(100000))
      assertBn(await mockERC20Token.balanceOf(treasuryAddr), bn(500000))
      assertBn(await mockERC20Token.balanceOf(deployer), bn(0))
      assertBn(await mockERC20Token.balanceOf(anotherAccount), bn(400000))

      // recover last portion
      const lastReceipt = await burner.recoverERC20(mockERC20Token.address, bn(100000), { from: anotherAccount })
      assertEvent(lastReceipt, `ERC20Recovered`, {
        expectedArgs: { requestedBy: anotherAccount, token: mockERC20Token.address, amount: bn(100000) }
      })

      // balance is zero already, have to be reverted
      assertRevert(burner.recoverERC20(mockERC20Token.address, bn(1), { from: deployer }), `ERC20: transfer amount exceeds balance`)
    })

    it(`can't recover zero-address ERC721(NFT)`, async () => {
      assertRevert(burner.recoverERC721(ZERO_ADDRESS, 0))
    })

    it(`recover some accidentally sent NFTs`, async () => {
      // send nft1 to anotherAccount and nft2 to the burner address
      await mockNFT.transferFrom(deployer, anotherAccount, nft1, { from: deployer })
      await mockNFT.transferFrom(deployer, burner.address, nft2, { from: deployer })

      // check the new holders' rights
      assertBn(await mockNFT.balanceOf(deployer), bn(0))
      assertBn(await mockNFT.balanceOf(anotherAccount), bn(1))
      assertBn(await mockNFT.balanceOf(burner.address), bn(1))

      // recover nft2 should work
      const receiptNfc2 = await burner.recoverERC721(mockNFT.address, nft2, { from: anotherAccount })
      assertEvent(receiptNfc2, `ERC721Recovered`, { expectedArgs: { requestedBy: anotherAccount, token: mockNFT.address, tokenId: nft2 } })

      // but nft1 recovery should revert
      assertRevert(burner.recoverERC721(mockNFT.address, nft1), `ERC721: transfer caller is not owner nor approved`)

      // send nft1 to burner and recover it
      await mockNFT.transferFrom(anotherAccount, burner.address, nft1, { from: anotherAccount })
      const receiptNft1 = await burner.recoverERC721(mockNFT.address, nft1, { from: deployer })

      assertEvent(receiptNft1, `ERC721Recovered`, { expectedArgs: { requestedBy: deployer, token: mockNFT.address, tokenId: nft1 } })

      // check final NFT ownership state
      assertBn(await mockNFT.balanceOf(treasuryAddr), bn(2))
      assertBn(await mockNFT.ownerOf(nft1), treasuryAddr)
      assertBn(await mockNFT.ownerOf(nft2), treasuryAddr)
    })
  })

  it(`Don't accept accidentally or intentionally sent ETH`, async () => {
    const burner_addr = burner.address

    // try to send 1 ETH, should be reverted with fallback defined reason
    assertRevert(web3.eth.sendTransaction({ from: anotherAccount, to: burner_addr, value: ETH(1) }), `INCOMING_ETH_IS_FORBIDDEN`)
  })
})
