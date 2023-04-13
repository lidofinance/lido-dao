const { contract, ethers, web3, artifacts } = require('hardhat')
const { bn, getEventArgument, ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

const { ETH, StETH, shareRate, shares } = require('../helpers/utils')
const { assert } = require('../helpers/assert')
const { MAX_UINT256, ACCOUNTS_AND_KEYS } = require('../helpers/constants')
const { signPermit, makeDomainSeparator } = require('../0.6.12/helpers/permit_helpers')
const { impersonate, EvmSnapshot, getCurrentBlockTimestamp, setBalance } = require('../helpers/blockchain')

const ERC721ReceiverMock = artifacts.require('ERC721ReceiverMock')

const { deployWithdrawalQueue } = require('./withdrawal-queue-deploy.test')

contract('WithdrawalQueue', ([owner, stranger, daoAgent, user, pauser, resumer, oracle]) => {
  let withdrawalQueue, steth, wsteth, defaultShareRate
  const ALLOWED_ERROR_WEI = 100
  const snapshot = new EvmSnapshot(ethers.provider)

  const currentRate = async () =>
    bn(await steth.getTotalPooledEther())
      .mul(bn(10).pow(bn(27)))
      .div(await steth.getTotalShares())

  before('Deploy', async () => {
    const deployed = await deployWithdrawalQueue({
      stethOwner: owner,
      queueAdmin: daoAgent,
      queuePauser: daoAgent,
      queueResumer: daoAgent,
    })

    steth = deployed.steth
    wsteth = deployed.wsteth
    withdrawalQueue = deployed.withdrawalQueue

    await steth.setTotalPooledEther(ETH(600))
    // we need 1 ETH additionally to pay gas on finalization because solidity-coverage ignores gasPrice=0
    await setBalance(steth.address, ETH(600 + 1))
    await steth.mintShares(user, shares(1))
    await steth.approve(withdrawalQueue.address, StETH(300), { from: user })

    defaultShareRate = (await currentRate()).toString(10)

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

  context('Pause/Resume', () => {
    it('only correct roles can alter pause state', async () => {
      const [PAUSE_ROLE, RESUME_ROLE] = await Promise.all([withdrawalQueue.PAUSE_ROLE(), withdrawalQueue.RESUME_ROLE()])
      await withdrawalQueue.grantRole(PAUSE_ROLE, pauser, { from: daoAgent })
      await withdrawalQueue.grantRole(RESUME_ROLE, resumer, { from: daoAgent })
      await withdrawalQueue.pauseFor(100000000, { from: pauser })
      assert(await withdrawalQueue.isPaused())
      await withdrawalQueue.resume({ from: resumer })
      assert(!(await withdrawalQueue.isPaused()))
      await assert.revertsOZAccessControl(withdrawalQueue.pauseFor(100000000, { from: resumer }), resumer, 'PAUSE_ROLE')
      await assert.revertsOZAccessControl(
        withdrawalQueue.pauseFor(100000000, { from: stranger }),
        stranger,
        'PAUSE_ROLE'
      )
      await withdrawalQueue.pauseFor(100000000, { from: pauser })
      await assert.revertsOZAccessControl(withdrawalQueue.resume({ from: pauser }), pauser, 'RESUME_ROLE')
      await assert.revertsOZAccessControl(withdrawalQueue.resume({ from: stranger }), stranger, 'RESUME_ROLE')
    })

    it('withdraw/finalize only allowed when at resumed state', async () => {
      await withdrawalQueue.pauseFor(100000000, { from: daoAgent })
      assert(await withdrawalQueue.isPaused())
      await assert.reverts(withdrawalQueue.requestWithdrawals([ETH(1)], owner, { from: user }), 'ResumedExpected()')

      await assert.reverts(
        withdrawalQueue.requestWithdrawalsWstETH([ETH(1)], owner, { from: user }),
        'ResumedExpected()'
      )

      const [alice] = ACCOUNTS_AND_KEYS
      const amount = ETH(1)
      const deadline = MAX_UINT256
      await setBalance(alice, ETH(10))
      await impersonate(ethers.provider, alice.address)
      const stETHDomainSeparator = await steth.DOMAIN_SEPARATOR()
      const wstETHDomainSeparator = await wsteth.DOMAIN_SEPARATOR()

      let { v, r, s } = signPermit(
        alice.address,
        withdrawalQueue.address,
        amount, // amount
        0, // nonce
        deadline,
        wstETHDomainSeparator,
        alice.key
      )

      const wstETHPermission = {
        value: amount,
        deadline, // deadline
        v,
        r,
        s,
      }

      await assert.reverts(
        withdrawalQueue.requestWithdrawalsWstETHWithPermit([ETH(1)], owner, wstETHPermission, { from: alice.address }),
        'ResumedExpected()'
      )
      ;({ v, r, s } = signPermit(
        alice.address,
        withdrawalQueue.address,
        amount, // amount
        0, // nonce
        deadline,
        stETHDomainSeparator,
        alice.key
      ))

      const stETHPermission = {
        value: amount,
        deadline, // deadline
        v,
        r,
        s,
      }

      await assert.reverts(
        withdrawalQueue.requestWithdrawalsWithPermit([ETH(1)], owner, stETHPermission, { from: alice.address }),
        'ResumedExpected()'
      )
      await assert.reverts(withdrawalQueue.finalize(1, 0, { from: owner }), 'ResumedExpected()')
    })

    it('cant resume without resume role', async () => {
      await assert.revertsOZAccessControl(withdrawalQueue.resume({ from: pauser }), pauser, 'RESUME_ROLE')
    })

    it('cant resume if not paused', async () => {
      const RESUME_ROLE = await withdrawalQueue.RESUME_ROLE()
      await withdrawalQueue.grantRole(RESUME_ROLE, resumer, { from: daoAgent })
      await assert.reverts(withdrawalQueue.resume({ from: resumer }), 'PausedExpected()')
    })
  })

  context('BunkerMode', () => {
    it('init config', async () => {
      assert(!(await withdrawalQueue.isBunkerModeActive()))
      assert.equals(ethers.constants.MaxUint256, await withdrawalQueue.bunkerModeSinceTimestamp())
    })

    it('access control', async () => {
      assert(!(await withdrawalQueue.isBunkerModeActive()))
      const ORACLE_ROLE = await withdrawalQueue.ORACLE_ROLE()
      await withdrawalQueue.grantRole(ORACLE_ROLE, oracle, { from: daoAgent })
      await assert.revertsOZAccessControl(
        withdrawalQueue.onOracleReport(true, 0, 0, { from: stranger }),
        stranger,
        'ORACLE_ROLE'
      )
      await withdrawalQueue.onOracleReport(true, 0, 0, { from: oracle })
    })

    it('state and events', async () => {
      assert(!(await withdrawalQueue.isBunkerModeActive()))
      assert.equals(ethers.constants.MaxUint256, await withdrawalQueue.bunkerModeSinceTimestamp())
      let timestamp = await getCurrentBlockTimestamp()
      await assert.reverts(
        withdrawalQueue.onOracleReport(true, +timestamp + 1000000, +timestamp + 1100000, { from: steth.address }),
        'InvalidReportTimestamp()'
      )
      await assert.reverts(
        withdrawalQueue.onOracleReport(true, +timestamp - 100, +timestamp + 1100000, { from: steth.address }),
        'InvalidReportTimestamp()'
      )
      // enable
      timestamp = await getCurrentBlockTimestamp()
      const tx1 = await withdrawalQueue.onOracleReport(true, timestamp, timestamp, { from: steth.address })
      assert.emits(tx1, 'BunkerModeEnabled', { _sinceTimestamp: timestamp })
      assert(await withdrawalQueue.isBunkerModeActive())
      assert.equals(timestamp, await withdrawalQueue.bunkerModeSinceTimestamp())
      // disable
      timestamp = await getCurrentBlockTimestamp()
      const tx2 = await withdrawalQueue.onOracleReport(false, timestamp, timestamp, { from: steth.address })
      assert.emits(tx2, 'BunkerModeDisabled')
      assert(!(await withdrawalQueue.isBunkerModeActive()))
      assert.equals(ethers.constants.MaxUint256, await withdrawalQueue.bunkerModeSinceTimestamp())
    })
  })

  context('Request', () => {
    it('One can request a withdrawal', async () => {
      const receipt = await withdrawalQueue.requestWithdrawals([StETH(300)], owner, { from: user })
      const requestId = getEventArgument(receipt, 'WithdrawalRequested', 'requestId')

      assert.emits(receipt, 'WithdrawalRequested', {
        requestId: 1,
        requestor: user.toLowerCase(),
        owner: owner.toLowerCase(),
        amountOfStETH: StETH(300),
        amountOfShares: shares(1),
      })

      assert.equals(await withdrawalQueue.getLastRequestId(), requestId)
      assert.equals(await withdrawalQueue.getLastFinalizedRequestId(), 0)
      assert.equals(await withdrawalQueue.unfinalizedRequestNumber(), 1)
      assert.equals(await withdrawalQueue.unfinalizedStETH(), StETH(300))
      assert.equals(await withdrawalQueue.getWithdrawalRequests(owner), [1])

      const requests = await withdrawalQueue.getWithdrawalStatus([requestId])
      assert.equals(requests.length, 1)

      const request = requests[0]

      assert.equals(request.owner, owner)
      assert.equals(request.amountOfStETH, StETH(300))
      assert.equals(request.amountOfShares, shares(1))
      assert.equals(request.isFinalized, false)
      assert.equals(request.isClaimed, false)
    })

    it('One cant request less than MIN', async () => {
      const min = bn(await withdrawalQueue.MIN_STETH_WITHDRAWAL_AMOUNT())
      assert.equals(min, 100)

      const amount = min.sub(bn(1))

      await assert.reverts(
        withdrawalQueue.requestWithdrawals([amount], owner, { from: user }),
        `RequestAmountTooSmall(${amount})`
      )
    })

    it('One can request MIN', async () => {
      const min = await withdrawalQueue.MIN_STETH_WITHDRAWAL_AMOUNT()
      const shares = await steth.getSharesByPooledEth(min)

      const receipt = await withdrawalQueue.requestWithdrawals([min], owner, { from: user })
      const requestId = getEventArgument(receipt, 'WithdrawalRequested', 'requestId')

      assert.emits(receipt, 'WithdrawalRequested', {
        requestId: 1,
        requestor: user.toLowerCase(),
        owner: owner.toLowerCase(),
        amountOfStETH: min,
        amountOfShares: shares,
      })

      assert.equals(await withdrawalQueue.getLastRequestId(), requestId)
      assert.equals(await withdrawalQueue.getLastFinalizedRequestId(), 0)

      const request = (await withdrawalQueue.getWithdrawalStatus([requestId]))[0]

      assert.equals(request.owner, owner)
      assert.equals(request.amountOfStETH, min)
      assert.equals(request.amountOfShares, shares)
      assert.equals(request.isFinalized, false)
      assert.equals(request.isClaimed, false)
    })

    it('One cant request more than MAX', async () => {
      const max = bn(await withdrawalQueue.MAX_STETH_WITHDRAWAL_AMOUNT())
      const amount = max.add(bn(1))
      await steth.setTotalPooledEther(amount)
      await steth.approve(withdrawalQueue.address, amount, { from: user })

      await assert.reverts(
        withdrawalQueue.requestWithdrawals([amount], owner, { from: user }),
        `RequestAmountTooLarge(${amount})`
      )
    })

    it('One can request MAX', async () => {
      const max = await withdrawalQueue.MAX_STETH_WITHDRAWAL_AMOUNT()
      await steth.setTotalPooledEther(max.muln(2))
      await steth.approve(withdrawalQueue.address, max, { from: user })

      const receipt = await withdrawalQueue.requestWithdrawals([max], owner, { from: user })
      const requestId = getEventArgument(receipt, 'WithdrawalRequested', 'requestId')

      assert.emits(receipt, 'WithdrawalRequested', {
        requestId: 1,
        requestor: user.toLowerCase(),
        owner: owner.toLowerCase(),
        amountOfStETH: max,
        amountOfShares: shares(1),
      })

      assert.equals(await withdrawalQueue.getLastRequestId(), requestId)
      assert.equals(await withdrawalQueue.getLastFinalizedRequestId(), 0)

      const request = (await withdrawalQueue.getWithdrawalStatus([requestId]))[0]

      assert.equals(request.owner, owner)
      assert.equals(request.amountOfStETH, max)
      assert.equals(request.amountOfShares, shares(1))
      assert.equals(request.isFinalized, false)
      assert.equals(request.isClaimed, false)
    })

    it('One cant request more than they have', async () => {
      await assert.reverts(
        withdrawalQueue.requestWithdrawals([StETH(400)], owner, { from: user }),
        'ALLOWANCE_EXCEEDED'
      )
    })

    it('One cant request more than allowed', async () => {
      await steth.approve(withdrawalQueue.address, StETH(200), { from: user })

      await assert.reverts(
        withdrawalQueue.requestWithdrawals([StETH(300)], owner, { from: user }),
        'ALLOWANCE_EXCEEDED'
      )
    })

    it('One cant request while is paused', async () => {
      const PAUSE_INFINITELY = await withdrawalQueue.PAUSE_INFINITELY()
      await withdrawalQueue.pauseFor(PAUSE_INFINITELY, { from: daoAgent })
      await assert.reverts(withdrawalQueue.requestWithdrawals([StETH(300)], owner, { from: user }), 'ResumedExpected()')
      await assert.reverts(
        withdrawalQueue.requestWithdrawalsWstETH([ETH(300)], owner, { from: user }),
        'ResumedExpected()'
      )
    })

    it('data is being accumulated properly', async () => {
      const queueItemStep0 = await withdrawalQueue.getQueueItem(await withdrawalQueue.getLastRequestId())

      const amountStep1 = StETH(50)
      const sharesStep1 = await steth.getSharesByPooledEth(amountStep1)
      await withdrawalQueue.requestWithdrawals([amountStep1], owner, { from: user })
      const queueItemStep1 = await withdrawalQueue.getQueueItem(await withdrawalQueue.getLastRequestId())

      assert.equals(+queueItemStep1.cumulativeStETH, +amountStep1 + +queueItemStep0.cumulativeStETH)
      assert.equals(+queueItemStep1.cumulativeShares, +sharesStep1 + +queueItemStep0.cumulativeShares)
      assert.equals(queueItemStep1.owner, owner)
      assert.equals(queueItemStep1.claimed, false)

      const amountStep2 = StETH(100)
      const sharesStep2 = await steth.getSharesByPooledEth(amountStep2)
      await withdrawalQueue.requestWithdrawals([amountStep2], owner, { from: user })
      const queueItemStep2 = await withdrawalQueue.getQueueItem(await withdrawalQueue.getLastRequestId())

      assert.equals(
        +queueItemStep2.cumulativeStETH,
        +amountStep2 + +queueItemStep1.cumulativeStETH + +queueItemStep0.cumulativeStETH
      )
      assert.equals(
        +queueItemStep2.cumulativeShares,
        +sharesStep2 + +queueItemStep1.cumulativeShares + +queueItemStep0.cumulativeShares
      )
      assert.equals(queueItemStep2.owner, owner)
      assert.equals(queueItemStep2.claimed, false)
    })
  })

  context('Finalization', () => {
    const amount = bn(ETH(300))

    beforeEach('Enqueue a request', async () => {
      await withdrawalQueue.requestWithdrawals([amount], owner, { from: user })
    })

    it('Finalizer can finalize a request', async () => {
      await assert.revertsOZAccessControl(withdrawalQueue.finalize(1, 0, { from: stranger }), stranger, 'FINALIZE_ROLE')
      await withdrawalQueue.finalize(1, 1, { from: steth.address, value: amount })

      assert.equals(await withdrawalQueue.getLockedEtherAmount(), amount)
      assert.equals(
        await withdrawalQueue.getLockedEtherAmount(),
        await ethers.provider.getBalance(withdrawalQueue.address)
      )
    })

    it('One can finalize requests with discount', async () => {
      await withdrawalQueue.finalize(1, shareRate(150), { from: steth.address, value: ETH(150) })

      assert.equals(await withdrawalQueue.getLockedEtherAmount(), ETH(150))
      assert.equals(
        await withdrawalQueue.getLockedEtherAmount(),
        await ethers.provider.getBalance(withdrawalQueue.address)
      )
    })

    it('One can finalize a batch of requests at once', async () => {
      await steth.setTotalPooledEther(ETH(900))
      await steth.mintShares(user, shares(1))
      await steth.approve(withdrawalQueue.address, StETH(300), { from: user })

      await withdrawalQueue.requestWithdrawals([amount], owner, { from: user })
      const batch = await withdrawalQueue.prefinalize.call([2], defaultShareRate)
      await withdrawalQueue.finalize(2, defaultShareRate, { from: steth.address, value: batch.ethToLock })

      assert.equals(batch.sharesToBurn, shares(2))
      assert.equals(await withdrawalQueue.getLastRequestId(), 2)
      assert.equals(await withdrawalQueue.getLastFinalizedRequestId(), 2)
      assert.equals(await withdrawalQueue.getLockedEtherAmount(), ETH(600))
      assert.equals(
        await withdrawalQueue.getLockedEtherAmount(),
        await ethers.provider.getBalance(withdrawalQueue.address)
      )
    })

    it('One can finalize part of the queue', async () => {
      await steth.setTotalPooledEther(ETH(900))
      await steth.mintShares(user, shares(1))
      await steth.approve(withdrawalQueue.address, StETH(600), { from: user })

      await withdrawalQueue.requestWithdrawals([amount], owner, { from: user })

      await withdrawalQueue.finalize(1, defaultShareRate, { from: steth.address, value: amount })

      assert.equals(await withdrawalQueue.getLastRequestId(), 2)
      assert.equals(await withdrawalQueue.getLastFinalizedRequestId(), 1)
      assert.equals(await withdrawalQueue.getLockedEtherAmount(), ETH(300))
      assert.equals(
        await withdrawalQueue.getLockedEtherAmount(),
        await ethers.provider.getBalance(withdrawalQueue.address)
      )

      await withdrawalQueue.finalize(2, defaultShareRate, { from: steth.address, value: amount })

      assert.equals(await withdrawalQueue.getLastRequestId(), 2)
      assert.equals(await withdrawalQueue.getLastFinalizedRequestId(), 2)
      assert.equals(await withdrawalQueue.getLockedEtherAmount(), ETH(600))
      assert.equals(
        await withdrawalQueue.getLockedEtherAmount(),
        await ethers.provider.getBalance(withdrawalQueue.address)
      )
    })

    it('batch reverts if share rate is zero', async () => {
      await assert.reverts(withdrawalQueue.prefinalize([1], shareRate(0)), 'ZeroShareRate()')
    })

    it('batch reverts if share rate is zero', async () => {
      await steth.setTotalPooledEther(ETH(900))
      await steth.mintShares(user, shares(1))
      await steth.approve(withdrawalQueue.address, StETH(600), { from: user })

      await withdrawalQueue.requestWithdrawals([amount], owner, { from: user })
      await assert.reverts(withdrawalQueue.prefinalize([2, 1], shareRate(1)), 'BatchesAreNotSorted()')
    })

    it('reverts if request with given id did not even created', async () => {
      const idAhead = +(await withdrawalQueue.getLastRequestId()) + 1

      await assert.reverts(
        withdrawalQueue.finalize(idAhead, defaultShareRate, { from: steth.address, value: amount }),
        `InvalidRequestId(${idAhead})`
      )

      await assert.reverts(withdrawalQueue.prefinalize([idAhead], defaultShareRate), `InvalidRequestId(${idAhead})`)
    })

    it('reverts if request with given id was finalized already', async () => {
      const id = +(await withdrawalQueue.getLastRequestId())
      await withdrawalQueue.finalize(id, defaultShareRate, { from: steth.address, value: amount })

      await assert.reverts(
        withdrawalQueue.finalize(id, defaultShareRate, { from: steth.address, value: amount }),
        `InvalidRequestId(${id})`
      )

      await assert.reverts(withdrawalQueue.prefinalize([id], defaultShareRate), `InvalidRequestId(${id})`)
    })

    it('reverts if given amount to finalize exceeds requested', async () => {
      const id = +(await withdrawalQueue.getLastRequestId())
      const amountExceeded = bn(ETH(400))

      await assert.reverts(
        withdrawalQueue.finalize(id, defaultShareRate, { from: steth.address, value: amountExceeded }),
        `TooMuchEtherToFinalize(${+amountExceeded}, ${+amount})`
      )
    })
  })

  context('getClaimableEth()', () => {
    beforeEach(async () => {
      await withdrawalQueue.requestWithdrawals([ETH(1)], owner, { from: user })
    })

    it('works', async () => {
      await withdrawalQueue.finalize(1, defaultShareRate, { from: steth.address, value: ETH(1) })
      assert.almostEqual(await withdrawalQueue.getClaimableEther([1], [1]), ETH(1), 100)
    })

    it('reverts if last hint checkpoint is ahead of requestId', async () => {
      await withdrawalQueue.finalize(1, shareRate(0.5), { from: steth.address, value: ETH(0.5) })

      await withdrawalQueue.requestWithdrawals([ETH(2)], owner, { from: user })
      await withdrawalQueue.finalize(2, shareRate(0.5), { from: steth.address, value: ETH(0.5) })

      await assert.reverts(withdrawalQueue.getClaimableEther([1], [2]), 'InvalidHint(2)')
    })

    it('return 0 for non-finalized request', async () => {
      assert.equals(await withdrawalQueue.getClaimableEther([1], [1]), ETH(0))
      assert.equals(await withdrawalQueue.getClaimableEther([1], [51]), ETH(0))
    })

    it('return 0 for claimed request', async () => {
      await withdrawalQueue.finalize(1, shareRate(1), { from: steth.address, value: ETH(1) })
      const amountOfETH = (await withdrawalQueue.getClaimableEther([1], [1]))[0]
      const tx = await withdrawalQueue.claimWithdrawals([1], [1], { from: owner })
      assert.emits(tx, 'WithdrawalClaimed', {
        requestId: 1,
        owner,
        receiver: owner,
        amountOfETH,
      })
      assert.equals(await withdrawalQueue.getClaimableEther([1], [1]), ETH(0))
      assert.equals(await withdrawalQueue.getClaimableEther([1], [51]), ETH(0))
    })

    it('reverts on invalid params', async () => {
      await assert.reverts(withdrawalQueue.getClaimableEther([0], [1]), 'InvalidRequestId(0)')
      await assert.reverts(withdrawalQueue.getClaimableEther([2], [1]), 'InvalidRequestId(2)')

      await withdrawalQueue.finalize(1, shareRate(1), { from: steth.address, value: ETH(1) })
      await assert.reverts(withdrawalQueue.getClaimableEther([1], [2]), 'InvalidHint(2)')
      await assert.reverts(withdrawalQueue.getClaimableEther([1], [0]), 'InvalidHint(0)')

      await withdrawalQueue.requestWithdrawals([ETH(1)], owner, { from: user })
      await assert.reverts(withdrawalQueue.getClaimableEther([1], [2]), 'InvalidHint(2)')

      await withdrawalQueue.requestWithdrawals([ETH(1), ETH(1)], owner, { from: user })
      await withdrawalQueue.finalize(2, shareRate(0.99), { from: steth.address, value: ETH(0.99) })
      await withdrawalQueue.finalize(3, shareRate(0.98), { from: steth.address, value: ETH(0.98) })

      await assert.reverts(withdrawalQueue.getClaimableEther([3], [1]), 'InvalidHint(1)')
    })

    it('works on multiple checkpoints, no discount', async () => {
      const requestCount = 5
      const shareRate = await currentRate()
      await withdrawalQueue.finalize(1, shareRate, { from: steth.address, value: ETH(1) })
      for (let index = 0; index < requestCount; index++) {
        await withdrawalQueue.requestWithdrawals([ETH(1)], owner, { from: user })
        await withdrawalQueue.finalize(index + 2, shareRate, { from: steth.address, value: ETH(1) })
      }
      const requestIds = Array(requestCount + 1)
        .fill(0)
        .map((_, i) => i + 1)

      const hints = await withdrawalQueue.findCheckpointHints(
        requestIds,
        1,
        await withdrawalQueue.getLastCheckpointIndex()
      )
      const claimableEth = await withdrawalQueue.getClaimableEther(requestIds, hints)
      claimableEth.forEach((eth) => assert.almostEqual(eth, ETH(1), 100))
    })
  })

  context('claimWithdrawal()', () => {
    const amount = ETH(300)
    beforeEach('Enqueue a request', async () => {
      await withdrawalQueue.requestWithdrawals([amount], owner, { from: user })
    })

    it('Owner can claim a finalized request to recipient address', async () => {
      await withdrawalQueue.finalize(1, defaultShareRate, { from: steth.address, value: amount })

      const balanceBefore = bn(await ethers.provider.getBalance(user))

      const tx = await withdrawalQueue.claimWithdrawalsTo([1], [1], user, { from: owner })
      assert.emits(tx, 'WithdrawalClaimed', {
        requestId: 1,
        owner,
        receiver: user,
        amountOfETH: amount,
      })

      assert.equals(await ethers.provider.getBalance(user), balanceBefore.add(bn(amount)))
    })

    context('claimWithdrawalsTo', () => {
      it('reverts for zero recipient', async () => {
        await assert.reverts(
          withdrawalQueue.claimWithdrawalsTo([1], [1], ZERO_ADDRESS, { from: owner }),
          'ZeroRecipient()'
        )
      })

      it('reverts when requestIds and hints arrays length mismatch', async () => {
        await assert.reverts(
          withdrawalQueue.claimWithdrawalsTo([0], [1, 2], user, { from: owner }),
          'ArraysLengthMismatch(1, 2)'
        )
      })

      it('reverts with zero _requestId', async () => {
        await assert.reverts(withdrawalQueue.claimWithdrawalsTo([0], [1], user, { from: owner }), 'InvalidRequestId(0)')
      })

      it('reverts if sender is not owner', async () => {
        await withdrawalQueue.finalize(1, defaultShareRate, { from: steth.address, value: amount })
        await assert.reverts(
          withdrawalQueue.claimWithdrawalsTo([1], [1], owner, { from: stranger }),
          `NotOwner("${stranger}", "${owner}")`
        )
      })

      it('reverts if there is not enough balance', async () => {
        await withdrawalQueue.finalize(1, defaultShareRate, { from: steth.address, value: amount })
        await setBalance(withdrawalQueue.address, ETH(200))
        await assert.reverts(withdrawalQueue.claimWithdrawalsTo([1], [1], owner, { from: owner }), 'NotEnoughEther()')
      })

      it('reverts if receiver declines', async () => {
        const receiver = await ERC721ReceiverMock.new({ from: owner })
        await receiver.setDoesAcceptTokens(false, { from: owner })
        await withdrawalQueue.finalize(1, defaultShareRate, { from: steth.address, value: amount })
        await assert.reverts(
          withdrawalQueue.claimWithdrawalsTo([1], [1], receiver.address, { from: owner }),
          'CantSendValueRecipientMayHaveReverted()'
        )
      })
    })

    it('Owner can claim a finalized request without hint', async () => {
      await withdrawalQueue.finalize(1, defaultShareRate, { from: steth.address, value: amount })

      const balanceBefore = bn(await ethers.provider.getBalance(owner))

      const tx = await withdrawalQueue.claimWithdrawal(1, { from: owner, gasPrice: 0 })
      assert.emits(tx, 'WithdrawalClaimed', {
        requestId: 1,
        owner,
        receiver: owner,
        amountOfETH: amount,
      })

      assert.equals(await ethers.provider.getBalance(owner), balanceBefore.add(bn(amount)))
    })

    it('One cant claim not finalized or not existed request', async () => {
      await assert.reverts(
        withdrawalQueue.claimWithdrawals([1], [1], { from: owner }),
        `RequestNotFoundOrNotFinalized(1)`
      )
      await assert.reverts(
        withdrawalQueue.claimWithdrawals([2], [1], { from: owner }),
        `RequestNotFoundOrNotFinalized(2)`
      )
    })

    it('Cant claim request with a wrong hint', async () => {
      await steth.setTotalPooledEther(ETH(900))
      await steth.mintShares(user, shares(1))
      await steth.approve(withdrawalQueue.address, StETH(600), { from: user })

      await withdrawalQueue.requestWithdrawals([amount], owner, { from: user })

      await withdrawalQueue.finalize(2, defaultShareRate, { from: steth.address, value: amount })
      await assert.reverts(withdrawalQueue.claimWithdrawals([1], [0], { from: owner }), 'InvalidHint(0)')
      await assert.reverts(withdrawalQueue.claimWithdrawals([1], [2], { from: owner }), 'InvalidHint(2)')
    })

    it('Cant withdraw token two times', async () => {
      await withdrawalQueue.finalize(1, defaultShareRate, { from: steth.address, value: amount })
      await withdrawalQueue.claimWithdrawal(1, { from: owner })

      await assert.reverts(withdrawalQueue.claimWithdrawal(1, { from: owner }), 'RequestAlreadyClaimed(1)')
    })

    it('Discounted withdrawals produce less eth', async () => {
      const batch = await withdrawalQueue.prefinalize([1], shareRate(150))
      await withdrawalQueue.finalize(1, shareRate(150), { from: steth.address, value: batch.ethToLock })

      const balanceBefore = bn(await ethers.provider.getBalance(owner))
      assert.equals(await withdrawalQueue.getLockedEtherAmount(), batch.ethToLock)

      await withdrawalQueue.claimWithdrawal(1, { from: owner, gasPrice: 0 })

      assert.equals(await withdrawalQueue.getLockedEtherAmount(), ETH(0))

      assert.almostEqual(bn(await ethers.provider.getBalance(owner)).sub(balanceBefore), ETH(150), ALLOWED_ERROR_WEI)
    })

    it('One can claim a lot of withdrawals with different discounts', async () => {
      await steth.setTotalPooledEther(ETH(22))
      await steth.mintShares(user, shares(21))
      await steth.approve(withdrawalQueue.address, StETH(21), { from: user })
      assert.equals(await withdrawalQueue.getLastCheckpointIndex(), 0)
      const batch = await withdrawalQueue.prefinalize([1], shareRate(1))
      await withdrawalQueue.finalize(1, shareRate(1), { from: steth.address, value: batch.ethToLock })
      for (let i = 1; i <= 20; i++) {
        assert.equals(await withdrawalQueue.getLastCheckpointIndex(), i)
        await withdrawalQueue.requestWithdrawals([StETH(1)], ZERO_ADDRESS, { from: user })
        const batch = await withdrawalQueue.prefinalize([i + 1], shareRate(i + 1))
        await withdrawalQueue.finalize(i + 1, shareRate(i + 1), {
          from: steth.address,
          value: batch.ethToLock,
        })
      }

      assert.equals(await withdrawalQueue.getLastCheckpointIndex(), 21)

      for (let i = 21; i > 1; i--) {
        await withdrawalQueue.claimWithdrawal(i, { from: user })
      }

      await withdrawalQueue.claimWithdrawal(1, { from: owner })

      assert.equals(await withdrawalQueue.getLockedEtherAmount(), ETH(0))
    })
  })

  context('claimWithdrawals()', () => {
    const amount = ETH(20)

    beforeEach('Enqueue a request', async () => {
      await withdrawalQueue.requestWithdrawals([amount], owner, { from: user })
    })

    it('reverts when requestIds and hints arrays length mismatch', async () => {
      await assert.reverts(withdrawalQueue.claimWithdrawals([1, 2], [1], { from: owner }), 'ArraysLengthMismatch(2, 1)')
    })

    it('claims correct requests', async () => {
      await steth.mintShares(owner, shares(300)) // 1 share to user and 299 shares to owner total = 300 ETH
      await steth.approve(withdrawalQueue.address, StETH(300), { from: owner })

      const secondRequestAmount = ETH(10)
      await withdrawalQueue.requestWithdrawals([secondRequestAmount], owner, { from: owner })
      const secondRequestId = await withdrawalQueue.getLastRequestId()
      await withdrawalQueue.finalize(secondRequestId, defaultShareRate, { from: steth.address, value: ETH(30) })

      const balanceBefore = bn(await ethers.provider.getBalance(owner))
      const tx = await withdrawalQueue.claimWithdrawals([1, 2], [1, 1], { from: owner, gasPrice: 0 })
      assert.emits(tx, 'WithdrawalClaimed', {
        requestId: 1,
        owner,
        receiver: owner,
      })
      assert.emits(tx, 'WithdrawalClaimed', {
        requestId: 2,
        owner,
        receiver: owner,
      })
      assert.almostEqual(await ethers.provider.getBalance(owner), balanceBefore.add(bn(ETH(30))), ALLOWED_ERROR_WEI * 2)
    })
  })

  context('claim scenarios', () => {
    const requestCount = 5
    const requestsAmounts = Array(requestCount).fill(StETH(1))

    let requestIds

    beforeEach(async () => {
      await withdrawalQueue.requestWithdrawals(requestsAmounts, user, { from: user })
      requestIds = await withdrawalQueue.getWithdrawalRequests(user, { from: user })
    })

    it('direct', async () => {
      const normalizedShareRate = await currentRate()
      const balanceBefore = bn(await ethers.provider.getBalance(user))
      const id = await withdrawalQueue.getLastRequestId()
      const batch = await withdrawalQueue.prefinalize([id], normalizedShareRate)

      withdrawalQueue.finalize(id, normalizedShareRate, { from: steth.address, value: batch.ethToLock })
      for (let index = 0; index < requestIds.length; index++) {
        const requestId = requestIds[index]
        await withdrawalQueue.claimWithdrawal(requestId, { from: user, gasPrice: 0 })
      }
      const balanceAfter = bn(await ethers.provider.getBalance(user))
      assert.equals(balanceAfter, balanceBefore.add(bn(batch.ethToLock)))
    })

    it('reverse', async () => {
      const normalizedShareRate = await currentRate()
      const balanceBefore = bn(await ethers.provider.getBalance(user))
      const id = await withdrawalQueue.getLastRequestId()
      const batch = await withdrawalQueue.prefinalize([id], normalizedShareRate)
      withdrawalQueue.finalize(id, normalizedShareRate, { from: steth.address, value: batch.ethToLock })
      for (let index = requestIds.length - 1; index >= 0; index--) {
        const requestId = requestIds[index]
        await withdrawalQueue.claimWithdrawal(requestId, { from: user, gasPrice: 0 })
      }
      const balanceAfter = bn(await ethers.provider.getBalance(user))
      assert.equals(balanceAfter, balanceBefore.add(bn(batch.ethToLock)))
    })

    it('random', async () => {
      const normalizedShareRate = await currentRate()
      const randomIds = [...requestIds].sort(() => 0.5 - Math.random())
      const balanceBefore = bn(await ethers.provider.getBalance(user))
      const id = await withdrawalQueue.getLastRequestId()
      const batch = await withdrawalQueue.prefinalize([id], normalizedShareRate)
      withdrawalQueue.finalize(id, normalizedShareRate, { from: steth.address, value: batch.ethToLock })
      for (let index = 0; index < randomIds.length; index++) {
        const requestId = randomIds[index]
        await withdrawalQueue.claimWithdrawal(requestId, { from: user, gasPrice: 0 })
      }
      const balanceAfter = bn(await ethers.provider.getBalance(user))
      assert.equals(balanceAfter, balanceBefore.add(bn(batch.ethToLock)))
    })

    it('different rates', async () => {
      const balanceBefore = bn(await ethers.provider.getBalance(user))
      const totalDistributedEth = bn(0)
      for (let index = 0; index < requestIds.length; index++) {
        const requestId = requestIds[index]
        const batch = await withdrawalQueue.prefinalize([requestId], shareRate(300 / (index + 1)))
        await withdrawalQueue.finalize(requestId, shareRate(300 / (index + 1)), {
          from: steth.address,
          value: batch.ethToLock,
        })
        totalDistributedEth.iadd(bn(batch.ethToLock))
      }
      for (let index = 0; index < requestIds.length; index++) {
        const requestId = requestIds[index]
        await withdrawalQueue.claimWithdrawal(requestId, { from: user, gasPrice: 0 })
      }
      const balanceAfter = bn(await ethers.provider.getBalance(user))
      assert.equals(balanceAfter, balanceBefore.add(totalDistributedEth))
    })

    it('100% discount', async () => {
      const balanceBefore = bn(await ethers.provider.getBalance(user))
      const id = await withdrawalQueue.getLastRequestId()
      const batches = await withdrawalQueue.prefinalize([id], 1)
      assert.equals(batches.ethToLock, 0)
      withdrawalQueue.finalize(id, 1, { from: steth.address, value: batches.ethToLock })
      for (let index = 0; index < requestIds.length; index++) {
        const requestId = requestIds[index]
        const tx = await withdrawalQueue.claimWithdrawal(requestId, { from: user, gasPrice: 0 })
        assert.emits(tx, 'WithdrawalClaimed', { requestId, owner: user, receiver: user, amountOfETH: 0 })
      }
      const balanceAfter = bn(await ethers.provider.getBalance(user))
      assert.equals(balanceAfter, balanceBefore)
    })
  })

  context('findCheckpointHints', () => {
    const NOT_FOUND = 0
    context('unit tests', () => {
      let requestId
      const amount = ETH(20)

      beforeEach('Enqueue a request', async () => {
        await withdrawalQueue.requestWithdrawals([amount], owner, { from: user })
        requestId = await withdrawalQueue.getLastRequestId()
      })

      it('correctly works before first finalization', async () => {
        const lastCheckpointIndex = await withdrawalQueue.getLastCheckpointIndex()
        assert.equals(lastCheckpointIndex, 0)
        const result = await withdrawalQueue.findCheckpointHints([requestId], 1, lastCheckpointIndex)
        assert.isTrue(result.length === 1)
        assert.equals(result[0], NOT_FOUND)

        const claimableEthResult = await withdrawalQueue.getClaimableEther([requestId], result)
        assert.isTrue(claimableEthResult.length === 1)
        assert.equals(claimableEthResult[0], NOT_FOUND)
      })

      it('reverts if first index is zero', async () => {
        const lastCheckpointIndex = await withdrawalQueue.getLastCheckpointIndex()
        await assert.reverts(
          withdrawalQueue.findCheckpointHints([1], 0, lastCheckpointIndex),
          `InvalidRequestIdRange(0, ${+lastCheckpointIndex})`
        )
      })

      it('reverts if last index is larger than in store', async () => {
        const lastCheckpointWrong = (await withdrawalQueue.getLastCheckpointIndex()) + 1
        await assert.reverts(
          withdrawalQueue.findCheckpointHints([1], 1, lastCheckpointWrong),
          `InvalidRequestIdRange(1, ${+lastCheckpointWrong})`
        )
      })

      it('returns empty list when passed empty request ids list', async () => {
        const lastCheckpointIndex = await withdrawalQueue.getLastCheckpointIndex()
        const hints = await withdrawalQueue.findCheckpointHints([], 1, lastCheckpointIndex)
        assert.equal(hints.length, 0)
      })

      it('returns not found when indexes have negative overlap', async () => {
        const batch = await withdrawalQueue.prefinalize.call([requestId], defaultShareRate)
        await withdrawalQueue.finalize(requestId, defaultShareRate, { from: steth.address, value: batch.ethToLock })
        const lastCheckpointIndex = await withdrawalQueue.getLastCheckpointIndex()
        const hints = await withdrawalQueue.findCheckpointHints(
          [requestId],
          +lastCheckpointIndex + 1,
          lastCheckpointIndex
        )
        assert.equal(hints.length, 1)
        assert.equals(hints[0], NOT_FOUND)
      })

      it('returns hints array with one item for list from single request id', async () => {
        const batch = await withdrawalQueue.prefinalize.call([requestId], defaultShareRate)
        await withdrawalQueue.finalize(requestId, defaultShareRate, { from: steth.address, value: batch.ethToLock })
        const lastCheckpointIndex = await withdrawalQueue.getLastCheckpointIndex()
        const hints = await withdrawalQueue.findCheckpointHints([requestId], 1, lastCheckpointIndex)
        assert.equal(hints.length, 1)
        assert.equals(hints[0], 1)
      })

      it('returns correct hints array for given request ids', async () => {
        await withdrawalQueue.finalize(requestId, shareRate(20), { from: steth.address, value: ETH(20) })

        await steth.mintShares(owner, shares(1))
        await steth.approve(withdrawalQueue.address, StETH(300), { from: owner })

        const secondRequestAmount = ETH(10)
        await withdrawalQueue.requestWithdrawals([secondRequestAmount], owner, { from: owner })
        const secondRequestId = await withdrawalQueue.getLastRequestId()

        const thirdRequestAmount = ETH(30)
        await withdrawalQueue.requestWithdrawals([thirdRequestAmount], user, { from: user })
        const thirdRequestId = await withdrawalQueue.getLastRequestId()

        await withdrawalQueue.finalize(thirdRequestId, shareRate(20), { from: steth.address, value: ETH(40) })

        const lastCheckpointIndex = await withdrawalQueue.getLastCheckpointIndex()
        const hints = await withdrawalQueue.findCheckpointHints(
          [requestId, secondRequestId, thirdRequestId],
          1,
          lastCheckpointIndex
        )
        assert.equal(hints.length, 3)
        assert.equals(hints[0], 1)
        assert.equals(hints[1], 2)
        assert.equals(hints[2], 2)
      })

      it('reverts with RequestIdsNotSorted error when request ids not in ascending order', async () => {
        await withdrawalQueue.finalize(requestId, shareRate(20), { from: steth.address, value: ETH(20) })

        await steth.mintShares(owner, shares(1))
        await steth.approve(withdrawalQueue.address, StETH(300), { from: owner })

        const secondRequestAmount = ETH(10)
        await withdrawalQueue.requestWithdrawals([secondRequestAmount], owner, { from: owner })
        const secondRequestId = await withdrawalQueue.getLastRequestId()

        const thirdRequestAmount = ETH(30)
        await withdrawalQueue.requestWithdrawals([thirdRequestAmount], user, { from: user })
        const thirdRequestId = await withdrawalQueue.getLastRequestId()

        await withdrawalQueue.finalize(thirdRequestId, shareRate(20), { from: steth.address, value: ETH(40) })

        const lastCheckpointIndex = await withdrawalQueue.getLastCheckpointIndex()
        await assert.reverts(
          withdrawalQueue.findCheckpointHints([requestId, thirdRequestId, secondRequestId], 1, lastCheckpointIndex),
          'RequestIdsNotSorted()'
        )
      })
    })

    context('range tests', () => {
      beforeEach(async () => {
        const numOfRequests = 10
        const requests = Array(numOfRequests).fill(ETH(20))
        const discountedPrices = Array(numOfRequests)
          .fill()
          .map((_, i) => ETH(i))
        const sharesPerRequest = await steth.getSharesByPooledEth(ETH(20))
        const discountShareRates = discountedPrices.map((p) => shareRate(+p / +sharesPerRequest))

        await withdrawalQueue.requestWithdrawals(requests, owner, { from: user })
        for (let i = 1; i <= numOfRequests; i++) {
          await withdrawalQueue.finalize([i], discountShareRates[i - 1], {
            from: steth.address,
            value: discountedPrices[i - 1],
          })
        }
        assert.equals(await withdrawalQueue.getLastCheckpointIndex(), numOfRequests)
      })

      it('return NOT_FOUND if request is not finalized', async () => {
        await withdrawalQueue.requestWithdrawals([ETH(1)], owner, { from: user })
        const hints = await withdrawalQueue.findCheckpointHints([11], 1, 10)
        assert.equals(hints.length, 1)
        assert.equals(hints[0], NOT_FOUND)
      })

      it('reverts if there is no such a request', async () => {
        await assert.reverts(withdrawalQueue.findCheckpointHints([12], 1, 10), 'InvalidRequestId(12)')
      })

      it('range search (found)', async () => {
        assert.equals(await withdrawalQueue.findCheckpointHints([5], 1, 9), 5)
        assert.equals(await withdrawalQueue.findCheckpointHints([1], 1, 9), 1)
        assert.equals(await withdrawalQueue.findCheckpointHints([9], 1, 9), 9)
        assert.equals(await withdrawalQueue.findCheckpointHints([5], 5, 5), 5)
      })

      it('range search (not found)', async () => {
        assert.equals(await withdrawalQueue.findCheckpointHints([10], 1, 5), 0)
        assert.equals(await withdrawalQueue.findCheckpointHints([6], 1, 5), 0)
        assert.equals(await withdrawalQueue.findCheckpointHints([1], 5, 5), 0)
        assert.equals(await withdrawalQueue.findCheckpointHints([4], 5, 9), 0)
      })

      it('sequential search', async () => {
        for (const [idToFind, searchLength] of [
          [1, 3],
          [1, 10],
          [10, 2],
          [10, 3],
          [8, 2],
          [9, 3],
        ]) {
          assert.equals(await sequentialSearch(idToFind, searchLength), idToFind)
        }
      })

      const sequentialSearch = async (requestId, searchLength) => {
        const lastIndex = await withdrawalQueue.getLastCheckpointIndex()

        for (let i = 1; i <= lastIndex; i += searchLength) {
          let end = i + searchLength - 1
          if (end > lastIndex) end = lastIndex
          const foundIndex = await withdrawalQueue.findCheckpointHints([requestId], i, end)
          if (+foundIndex !== 0) return foundIndex
        }
      }
    })
  })

  context('requestWithdrawals()', () => {
    it('works correctly with non empty payload and different tokens', async () => {
      await steth.mintShares(user, shares(10))
      await steth.approve(withdrawalQueue.address, StETH(300), { from: user })
      const requests = [ETH(10), ETH(20)]
      const stETHBalanceBefore = await steth.balanceOf(user)
      const lastRequestIdBefore = await withdrawalQueue.getLastRequestId()

      await withdrawalQueue.requestWithdrawals(requests, stranger, { from: user })

      assert.equals(await withdrawalQueue.getLastRequestId(), lastRequestIdBefore.add(bn(requests.length)))
      const stETHBalanceAfter = await steth.balanceOf(user)
      assert.almostEqual(stETHBalanceAfter, stETHBalanceBefore.sub(bn(requests[0])).sub(bn(requests[1])), 30)
    })
  })

  context('requestWithdrawalsWstETH()', () => {
    it('works correctly with non empty payload and different tokens', async () => {
      await wsteth.mint(user, ETH(100))
      await steth.mintShares(wsteth.address, shares(100))
      await steth.mintShares(user, shares(100))
      await wsteth.approve(withdrawalQueue.address, ETH(300), { from: user })
      const requests = [ETH(10), ETH(20)]
      const wstETHBalanceBefore = await wsteth.balanceOf(user)
      const lastRequestIdBefore = await withdrawalQueue.getLastRequestId()

      await withdrawalQueue.requestWithdrawalsWstETH(requests, stranger, { from: user })

      assert.equals(await withdrawalQueue.getLastRequestId(), lastRequestIdBefore.add(bn(requests.length)))
      const wstETHBalanceAfter = await wsteth.balanceOf(user)
      assert.equals(wstETHBalanceAfter, wstETHBalanceBefore.sub(bn(requests[0])).sub(bn(requests[1])))
    })

    it('uses sender address as owner if zero passed', async () => {
      await wsteth.mint(user, ETH(1))
      await steth.mintShares(wsteth.address, shares(1))
      await steth.mintShares(user, shares(1))
      await wsteth.approve(withdrawalQueue.address, ETH(1), { from: user })

      const tx = await withdrawalQueue.requestWithdrawalsWstETH([ETH(1)], ZERO_ADDRESS, { from: user })

      assert.emits(tx, 'WithdrawalRequested', {
        requestId: 1,
        requestor: user.toLowerCase(),
        owner: user.toLowerCase(),
        amountOfStETH: await steth.getPooledEthByShares(ETH(1)),
        amountOfShares: shares(1),
      })
    })
  })

  context('requestWithdrawalsWstETHWithPermit()', () => {
    const [alice] = ACCOUNTS_AND_KEYS
    it('works correctly with non empty payload', async () => {
      await wsteth.mint(user, ETH(100))
      await steth.mintShares(wsteth.address, shares(100))
      await steth.mintShares(user, shares(100))
      await wsteth.approve(withdrawalQueue.address, ETH(300), { from: user })
      await impersonate(ethers.provider, alice.address)
      await web3.eth.sendTransaction({ to: alice.address, from: user, value: ETH(1) })
      await wsteth.transfer(alice.address, ETH(100), { from: user })

      const requests = []

      const withdrawalRequestsCount = 5
      for (let i = 0; i < withdrawalRequestsCount; ++i) {
        requests.push(ETH(10))
      }

      const amount = bn(ETH(10)).mul(bn(withdrawalRequestsCount))
      const chainId = await wsteth.getChainId()
      const deadline = MAX_UINT256
      const domainSeparator = makeDomainSeparator('Wrapped liquid staked Ether 2.0', '1', chainId, wsteth.address)
      const { v, r, s } = signPermit(
        alice.address,
        withdrawalQueue.address,
        amount, // amount
        0, // nonce
        deadline,
        domainSeparator,
        alice.key
      )
      const permission = [
        amount,
        deadline, // deadline
        v,
        r,
        s,
      ]

      const aliceBalancesBefore = await wsteth.balanceOf(alice.address)
      const lastRequestIdBefore = await withdrawalQueue.getLastRequestId()
      await withdrawalQueue.requestWithdrawalsWstETHWithPermit(requests, owner, permission, { from: alice.address })
      assert.equals(await withdrawalQueue.getLastRequestId(), lastRequestIdBefore.add(bn(requests.length)))
      const aliceBalancesAfter = await wsteth.balanceOf(alice.address)
      assert.equals(aliceBalancesAfter, aliceBalancesBefore.sub(bn(ETH(10)).mul(bn(withdrawalRequestsCount))))
    })
  })

  context('requestWithdrawalsWithPermit()', () => {
    const [alice] = ACCOUNTS_AND_KEYS
    it('works correctly with non empty payload', async () => {
      await web3.eth.sendTransaction({ to: alice.address, from: user, value: ETH(1) })
      await steth.mintShares(alice.address, shares(100))
      const withdrawalRequestsCount = 5
      const requests = Array(withdrawalRequestsCount).fill(ETH(10))

      const amount = bn(ETH(10)).mul(bn(withdrawalRequestsCount))
      const deadline = MAX_UINT256
      await impersonate(ethers.provider, alice.address)
      const domainSeparator = await steth.DOMAIN_SEPARATOR()
      const { v, r, s } = signPermit(
        alice.address,
        withdrawalQueue.address,
        amount, // amount
        0, // nonce
        deadline,
        domainSeparator,
        alice.key
      )
      const permission = [
        amount,
        deadline, // deadline
        v,
        r,
        s,
      ]

      const aliceBalancesBefore = await steth.balanceOf(alice.address)
      const lastRequestIdBefore = await withdrawalQueue.getLastRequestId()
      await withdrawalQueue.requestWithdrawalsWithPermit(requests, owner, permission, { from: alice.address })
      assert.equals(await withdrawalQueue.getLastRequestId(), lastRequestIdBefore.add(bn(requests.length)))
      const aliceBalancesAfter = await steth.balanceOf(alice.address)
      assert.equals(aliceBalancesAfter, aliceBalancesBefore.sub(bn(ETH(10)).mul(bn(withdrawalRequestsCount))))
    })
  })

  context('Transfer request', () => {
    const amount = ETH(300)
    let requestId

    beforeEach('Enqueue a request', async () => {
      await withdrawalQueue.requestWithdrawals([amount], user, { from: user })
      requestId = (await withdrawalQueue.getLastRequestId()).toNumber()
    })

    it('One can change the owner', async () => {
      const senderWithdrawalsBefore = await withdrawalQueue.getWithdrawalRequests(user)
      const ownerWithdrawalsBefore = await withdrawalQueue.getWithdrawalRequests(owner)

      assert.isTrue(senderWithdrawalsBefore.map((v) => v.toNumber()).includes(requestId))
      assert.isFalse(ownerWithdrawalsBefore.map((v) => v.toNumber()).includes(requestId))

      await withdrawalQueue.transferFrom(user, owner, requestId, { from: user })

      const senderWithdrawalAfter = await withdrawalQueue.getWithdrawalRequests(user)
      const ownerWithdrawalsAfter = await withdrawalQueue.getWithdrawalRequests(owner)

      assert.isFalse(senderWithdrawalAfter.map((v) => v.toNumber()).includes(requestId))
      assert.isTrue(ownerWithdrawalsAfter.map((v) => v.toNumber()).includes(requestId))
    })

    it("One can't change someone else's request", async () => {
      await assert.reverts(
        withdrawalQueue.transferFrom(user, owner, requestId, { from: stranger }),
        `NotOwnerOrApproved("${stranger}")`
      )
    })

    it("One can't pass zero owner", async () => {
      await assert.reverts(
        withdrawalQueue.transferFrom(user, ZERO_ADDRESS, requestId, { from: user }),
        'TransferToZeroAddress()'
      )
    })

    it("One can't pass zero requestId", async () => {
      await assert.reverts(withdrawalQueue.transferFrom(user, owner, 0, { from: user }), `InvalidRequestId(0)`)
    })

    it("One can't change claimed request", async () => {
      await withdrawalQueue.finalize(requestId, defaultShareRate, { from: steth.address, value: amount })
      await withdrawalQueue.claimWithdrawal(requestId, { from: user })

      await assert.reverts(
        withdrawalQueue.transferFrom(user, owner, requestId, { from: user }),
        `RequestAlreadyClaimed(1)`
      )
    })

    it("Changing owner doesn't work with wrong request id", async () => {
      const wrongRequestId = requestId + 1
      await assert.reverts(
        withdrawalQueue.transferFrom(user, owner, wrongRequestId, { from: user }),
        `InvalidRequestId(${wrongRequestId})`
      )
    })
  })

  context('Transfer request performance', function () {
    const firstRequestCount = 1000
    const secondRequestCount = 10000

    this.timeout(1000000)

    it.skip('Can perform a lots of requests', async () => {
      for (let i = 0; i < firstRequestCount; i++) {
        await withdrawalQueue.requestWithdrawals([ETH(1 / secondRequestCount)], user, { from: user })
      }
      const firstGasUsed = (await withdrawalQueue.changeRecipient(firstRequestCount - 1, owner, { from: user })).receipt
        .gasUsed

      for (let i = firstRequestCount; i < secondRequestCount; i++) {
        await withdrawalQueue.requestWithdrawals([ETH(1 / secondRequestCount)], user, { from: user })
      }
      const secondGasUsed = (await withdrawalQueue.changeRecipient(secondRequestCount / 2, owner, { from: user }))
        .receipt.gasUsed

      assert.isTrue(firstGasUsed >= secondGasUsed)
    })
  })

  context('getWithdrawalStatus', () => {
    it('reverts if requestId is zero', async () => {
      await assert.reverts(withdrawalQueue.getWithdrawalStatus([0]), `InvalidRequestId(0)`)
    })

    it('reverts if requestId is ahead of currently stored', async () => {
      const idAhead = +(await withdrawalQueue.getLastRequestId()) + 1
      await assert.reverts(withdrawalQueue.getWithdrawalStatus([idAhead]), `InvalidRequestId(${idAhead})`)
    })
  })
})
