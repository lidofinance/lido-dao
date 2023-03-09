const { contract, artifacts } = require('hardhat')
const { BN } = require('bn.js')
const { assert } = require('../helpers/assert')
const { ZERO_ADDRESS } = require('../helpers/constants')
const { toBN, e9, e18, e27 } = require('../helpers/utils')
const { deployProtocol } = require('../helpers/protocol')
const { reportOracle, getSecondsPerFrame, getSlotTimestamp } = require('../helpers/oracle')
const { advanceChainTime } = require('../helpers/blockchain')
// const { processNamedTuple } = require('../helpers/debug')

const StakingModuleMock = artifacts.require('StakingModuleMock')

function piecewiseModN({ values, pointsPerValue, x }) {
  const iValue = Math.floor(x / pointsPerValue)
  const leftValue = values[iValue % values.length]
  const rightValue = values[(iValue + 1) % values.length]
  return leftValue + ((rightValue - leftValue) * (x % pointsPerValue)) / pointsPerValue
}

contract('Lido, AccountingOracle, WithdrawalQueue integration', ([depositor, user, user2]) => {
  const test = (numRebases, withdrawalRequestsPerRebase, rebasesPerShareRateExtrema) => {
    let lido, router, wQueue, oracle, consensus, voting, stakingModule, stakingModuleId
    let secondsPerFrame

    before('deploy contracts', async () => {
      const deployed = await deployProtocol({
        stakingModulesFactory: async () => {
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

    const calcCLBalanceIncreaseForShareRateBP = async (shareRateBP) => {
      const totalShares = await lido.getTotalShares()
      const newTotalEth = toBN(shareRateBP).mul(toBN(totalShares)).divn(10000)
      return newTotalEth.sub(toBN(await lido.getTotalPooledEther()))
    }

    const rebaseToShareRateBP = async (shareRateBP) => {
      const stat = await lido.getBeaconStat()
      const ethDiff = await calcCLBalanceIncreaseForShareRateBP(shareRateBP)
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
    let shareRateBP

    for (let i = 0; i < numRebases; ++i) {
      shareRateBP = Math.floor(
        piecewiseModN({
          values: shareRatesBP,
          pointsPerValue: rebasesPerShareRateExtrema,
          x: i,
        })
      )

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

        if (i === numRebases - 1) {
          it(`users submit enough ETH to buffer to fullfill all withdrawals`, async () => {
            // twice as much ETH will be enough in all scenarios
            await lido.submit(ZERO_ADDRESS, { from: user2, value: toBN(userBalance).muln(2) })
          })
        }
      })
    }

    const finalShareRateBP = Math.floor((shareRatesBP[0] + shareRatesBP[1]) / 2)
    const finalShareRate27 = e27(finalShareRateBP / 10000)

    context(`share rate: ${finalShareRateBP / 10000}`, () => {
      let oracleReportFields, ethAvailForWithdrawals

      it(`calculating available ETH`, async () => {
        const { refSlot } = await consensus.getCurrentFrame()

        const stat = await lido.getBeaconStat()
        const ethDiff = await calcCLBalanceIncreaseForShareRateBP(finalShareRateBP)
        const newCLBalance = toBN(stat.beaconBalance).add(ethDiff)

        oracleReportFields = {
          refSlot,
          numValidators: stat.beaconValidators,
          clBalance: newCLBalance,
          withdrawalVaultBalance: 0,
          elRewardsVaultBalance: 0,
          sharesRequestedToBurn: 0,
        }

        const timestamp = await getSlotTimestamp(+refSlot, consensus)
        const secondsElapsed = secondsPerFrame

        const [totalEth, totalShares, withdrawals, elRewards] = await lido.handleOracleReport.call(
          timestamp,
          secondsElapsed,
          oracleReportFields.numValidators,
          oracleReportFields.clBalance,
          oracleReportFields.withdrawalVaultBalance,
          oracleReportFields.elRewardsVaultBalance,
          oracleReportFields.sharesRequestedToBurn,
          [],
          0, // simulatedShareRate
          { from: oracle.address }
        )

        assert.equals(withdrawals, 0)
        assert.equals(elRewards, 0)

        const shareRateE27 = toBN(e27(totalEth)).div(toBN(totalShares))
        const oneWeiE27 = e9(1)

        assert.isClose(shareRateE27, finalShareRate27, oneWeiE27)

        const unfinalizedStETH = await wQueue.unfinalizedStETH()
        const bufferedEth = await lido.getBufferedEther()

        ethAvailForWithdrawals = BN.min(toBN(unfinalizedStETH), toBN(bufferedEth))
          .add(toBN(withdrawals))
          .add(toBN(elRewards))

        console.log(`ethAvailForWithdrawals: ${ethAvailForWithdrawals.div(toBN(10).pow(toBN(18)))}`)
      })

      it.skip('TODO: oracle report')
    })
  }

  context('handleOracleReport gas consumption', () => {
    const testWithParams = (numRebases, withdrawalRequestsPerRebase, rebasesPerShareRateExtrema) => {
      const desc =
        `rebases: ${numRebases}, requests per rebase: ${withdrawalRequestsPerRebase}, ` +
        `rebases per extrema: ${rebasesPerShareRateExtrema}`
      context(desc, () => test(numRebases, withdrawalRequestsPerRebase, rebasesPerShareRateExtrema))
    }
    testWithParams(2, 1, 1)
  })
})
