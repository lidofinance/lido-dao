const { assert } = require('../helpers/assert')
const { MAX_UINT256 } = require('../helpers/constants')
const { ZERO_ADDRESS, toBN, e18, e27 } = require('../helpers/utils')
const { deployProtocol } = require('../helpers/protocol')
const { reportOracle, getSecondsPerFrame } = require('../helpers/oracle')
const { advanceChainTime } = require('../helpers/blockchain')

const StakingModuleMock = artifacts.require('StakingModuleMock')


function piecewiseModN({values, pointsPerValue, x}) {
  const iValue = Math.floor(x / pointsPerValue)
  const leftValue = values[iValue % values.length]
  const rightValue = values[(iValue + 1) % values.length]
  return leftValue + (rightValue - leftValue) * (x % pointsPerValue) / pointsPerValue
}


contract('Lido, AccountingOracle, WithdrawalQueue integration', ([depositor, user, stranger]) => {

  const test = (numRebases, withdrawalRequestsPerRebase, rebasesPerShareRateExtrema) => {
    let lido, router, wQueue, oracle, consensus, voting, stakingModule, stakingModuleId
    let secondsPerFrame

    before('deploy contracts', async () => {
      const deployed = await deployProtocol({
        stakingModulesFactory: async (protocol) => {
          stakingModule = await StakingModuleMock.new()
          return [
            {
              module: stakingModule,
              name: 'module1',
              targetShares: 10000,
              moduleFee: 500,
              treasuryFee: 500,
            },
          ]
        },
        depositSecurityModuleFactory: async () => {
          return { address: depositor }
        },
      })

      lido = deployed.pool
      router = deployed.stakingRouter
      wQueue = deployed.withdrawalQueue
      oracle = deployed.oracle
      consensus = deployed.consensusContract
      voting = deployed.voting.address

      secondsPerFrame = await getSecondsPerFrame(consensus)
      stakingModuleId = +(await router.getStakingModuleIds())[0]

      const withdrawalCredentials = '0x'.padEnd(66, '1234')
      await router.setWithdrawalCredentials(withdrawalCredentials, { from: voting })

      await deployed.oracleReportSanityChecker.setAnnualBalanceIncreaseBPLimit(10000, { from: voting })

      await wQueue.resume({ from: deployed.appManager.address })
    })

    const advanceTimeToNextFrame = async () => {
      await advanceChainTime(secondsPerFrame)
    }

    const rebaseToShareRateBP = async (shareRateBP) => {
      const stat = await lido.getBeaconStat()
      const totalShares = await lido.getTotalShares()
      const newTotalEth = toBN(shareRateBP).mul(toBN(totalShares)).divn(10000)
      const ethDiff = newTotalEth.sub(toBN(await lido.getTotalPooledEther()))
      const newCLBalance = toBN(stat.beaconBalance).add(ethDiff)

      await advanceTimeToNextFrame()

      const { submitDataTx } = await reportOracle(consensus, oracle, {
        numValidators: stat.beaconValidators,
        clBalance: newCLBalance,
      })

      return submitDataTx
    }

    let userBalance

    it(`a user submits ETH to the protocol`, async () => {
      const ethToSubmit = toBN(e18(320)).sub(await lido.getTotalPooledEther())
      await lido.submit(ZERO_ADDRESS, { from: user, value: ethToSubmit })

      userBalance = await lido.balanceOf(user)
      await lido.approve(wQueue.address, userBalance, { from: user })
    })

    it(`ether gets deposited to the CL`, async () => {
      await stakingModule.setAvailableKeysCount(10)
      await lido.deposit(10, stakingModuleId, '0x0', { from: depositor })
      assert.equals(await lido.getBufferedEther(), 0)

      let stat = await lido.getBeaconStat()
      assert.equals(stat.depositedValidators, 10)

      const clBalance = toBN(stat.depositedValidators).mul(toBN(e18(32)))

      await advanceTimeToNextFrame()

      await reportOracle(consensus, oracle, {
        numValidators: stat.depositedValidators,
        clBalance,
      })

      stat = await lido.getBeaconStat()
      assert.equals(stat.beaconValidators, 10)
      assert.equals(stat.beaconBalance, clBalance)
    })

    const totalRequests = numRebases * withdrawalRequestsPerRebase
    const shareRatesBP = [10010, 10020]

    for (let i = 0; i < numRebases; ++i) {
      const shareRateBP = Math.floor(piecewiseModN({
        values: shareRatesBP,
        pointsPerValue: rebasesPerShareRateExtrema,
        x: i
      }))

      context(`rebase ${i}, share rate: ${shareRateBP / 10000}`, () => {
        before(async () => {
          await rebaseToShareRateBP(shareRateBP)
          assert.equals(await lido.getPooledEthByShares(10000), shareRateBP)
        })

        it(`adding ${withdrawalRequestsPerRebase} requests`, async () => {
          const requestSize = toBN(userBalance).divn(totalRequests)
          const amounts = new Array(withdrawalRequestsPerRebase).fill(requestSize)
          await wQueue.requestWithdrawals(amounts, user, { from: user })
        })
      })
    }

    const finalizationShareRateBP = Math.floor((shareRatesBP[0] + shareRatesBP[1]) / 2)

    context(`share rate: ${finalizationShareRateBP / 10000}`, () => {
      it(`calculating batches`, async () => {
        await rebaseToShareRateBP(finalizationShareRateBP)
        const shareRate27 = e27(finalizationShareRateBP / 10000)

        let calcState = { ethBudget: MAX_UINT256, finished: false, batches: [] }
        let i = 0

        while (!calcState.finished) {
          calcState = await wQueue.calculateFinalizationBatches(shareRate27, MAX_UINT256, calcState)
          console.log(`calcState ${i}:`, calcState)
          ++i
        }
      })
    })
  }

  context('handleOracleReport gas consumption', () => {
    const testWithParams = (numRebases, withdrawalRequestsPerRebase, rebasesPerShareRateExtrema) => {
      const desc = `rebases: ${numRebases}, requests per rebase: ${withdrawalRequestsPerRebase}, ` +
        `rebases per extrema: ${rebasesPerShareRateExtrema}`
      context(desc, () => test(numRebases, withdrawalRequestsPerRebase, rebasesPerShareRateExtrema))
    }
    testWithParams(40, 1, 1)
  })
})
