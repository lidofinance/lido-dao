/* eslint-disable no-template-curly-in-string */
const { contract, ethers } = require('hardhat')
const { bn } = require('@aragon/contract-helpers-test')
const { itParam } = require('mocha-param')

const { ETH, StETH, shares } = require('../helpers/utils')
const { setBalance, EvmSnapshot } = require('../helpers/blockchain')
const { deployWithdrawalQueue } = require('./withdrawal-queue-deploy.test')

contract('WithdrawalQueue', ([owner, user]) => {
  let wq, steth, defaultShareRate, belowShareRate, aboveShareRate, snapshot
  let gasPrice = 1
  const currentRate = async () =>
    bn(await steth.getTotalPooledEther())
      .mul(bn(10).pow(bn(27)))
      .div(await steth.getTotalShares())

  const MAX_BATCH_SIZE = 280
  const batchIncrement = (i) => i * 2
  const REQ_AMOUNT = ETH(0.00001)
  const batchSizes = []
  for (let batch_size = 1; batch_size <= MAX_BATCH_SIZE; batch_size = batchIncrement(batch_size)) {
    batchSizes.push(batch_size)
  }

  before('Deploy', async function () {
    if (!process.env.REPORT_GAS) {
      this.skip()
    }
    snapshot = new EvmSnapshot(ethers.provider)

    const deployed = await deployWithdrawalQueue({
      stethOwner: owner,
      queueAdmin: owner,
      queuePauser: owner,
      queueResumer: owner,
      queueFinalizer: owner,
    })

    steth = deployed.steth
    wq = deployed.withdrawalQueue

    await steth.setTotalPooledEther(ETH(600))
    await setBalance(steth.address, ETH(600))
    await steth.mintShares(user, shares(300))
    await steth.approve(wq.address, StETH(300), { from: user })
    defaultShareRate = await currentRate()
    belowShareRate = defaultShareRate.divn(2)
    aboveShareRate = defaultShareRate.muln(2)
    await snapshot.make()
  })

  after('clean up', async function () {
    // only rollback if not skipped
    if (process.env.REPORT_GAS) {
      await snapshot.rollback()
    }
  })

  context('requestWithdrawal', () => {
    let results

    before(async () => {
      results = []
    })

    after(async () => {
      console.log('requestWithdrawals')
      console.table(results)
    })

    itParam('batch size ${value}', batchSizes, async (batch_size) => {
      const args = [
        Array(batch_size).fill(REQ_AMOUNT),
        user,
        {
          from: user,
          // smap of large transactions causes local network baseFee rise in next blocks
          // increase gasPrice a bit on every tx to make sure execute
          gasPrice: gasPrice++,
          gasLimit: 1000000000,
        },
      ]
      const estimated = await wq.requestWithdrawals.estimateGas(...args)
      args[args.length - 1].gasLimit = estimated
      const tx = await wq.requestWithdrawals(...args)
      results.push({
        'batch size': batch_size,
        estimated,
        used: tx.receipt.gasUsed,
        'diff%': parseFloat((((estimated - tx.receipt.gasUsed) / estimated) * 100).toFixed(3)),
        'gas/req': Math.ceil(tx.receipt.gasUsed / batch_size),
      })
    })
  })

  context('pre/finalize', () => {
    let prefinalize_results, finalization_results, slash

    before(async () => {
      prefinalize_results = []
      finalization_results = []
      slash = false
    })

    after(async () => {
      console.log('Prefinalize')
      console.table(prefinalize_results)
      console.log('Finalize')
      console.table(finalization_results)
    })

    itParam('batch size ${value}', batchSizes, async (batch_size) => {
      const batchStart = await wq.getLastFinalizedRequestId()
      const batchEnd = batchStart.addn(batch_size)
      const prefinalize_args = [[batchEnd], slash ? aboveShareRate : belowShareRate]
      const [prefinalize_gas, prefinalize_res] = await Promise.all([
        wq.prefinalize.estimateGas(...prefinalize_args),
        wq.prefinalize.call(...prefinalize_args),
      ])
      prefinalize_results.push({
        'batch size': batch_size,
        gas: prefinalize_gas,
        slash,
        'gas/req': Math.ceil(prefinalize_gas / batch_size),
      })

      const finalization_args = [
        batchEnd,
        slash ? aboveShareRate : belowShareRate,
        { from: owner, value: prefinalize_res.ethToLock, gasPrice: gasPrice++ },
      ]
      const estimated = await wq.finalize.estimateGas(...finalization_args)
      finalization_args[finalization_args.length - 1].gasLimit = estimated
      const tx = await wq.finalize(...finalization_args)
      finalization_results.push({
        'batch size': batch_size,
        estimated,
        used: tx.receipt.gasUsed,
        'diff%': parseFloat((((estimated - tx.receipt.gasUsed) / estimated) * 100).toFixed(3)),
        'gas/req': Math.ceil(tx.receipt.gasUsed / batch_size),
        slash,
      })
      slash = !slash
    })
  })

  context('findHints/claim', () => {
    let findHints_results, claim_results, lastCheckpointIndex, batchStart

    before(async () => {
      findHints_results = []
      claim_results = []
      lastCheckpointIndex = await wq.getLastCheckpointIndex()
      batchStart = 1
    })

    after(async () => {
      console.log('FindCheckpointsHints')
      console.table(findHints_results)
      console.log('claimWithdrawals')
      console.table(claim_results)
    })
    itParam('batch size ${value}', batchSizes, async (batch_size) => {
      const requestIds = Array(batch_size)
        .fill(0)
        .map((_, i) => batchStart + i)
      const findHintsArgs = [requestIds, 1, lastCheckpointIndex]
      const [findHints_gas, findHints_res] = await Promise.all([
        wq.findCheckpointHints.estimateGas(...findHintsArgs),
        wq.findCheckpointHints.call(...findHintsArgs),
      ])
      findHints_results.push({
        'batch size': batch_size,
        gas: findHints_gas,
        'gas/req': Math.ceil(findHints_gas / batch_size),
      })

      /// Claiming
      const claiming_args = [requestIds, findHints_res, { from: user, gasPrice: gasPrice++ }]
      const estimated = await wq.claimWithdrawals.estimateGas(...claiming_args)
      claiming_args[claiming_args.length - 1].gasLimit = estimated
      const tx = await wq.claimWithdrawals(...claiming_args)
      claim_results.push({
        'batch size': batch_size,
        estimated,
        used: tx.receipt.gasUsed,
        'diff%': parseFloat((((estimated - tx.receipt.gasUsed) / estimated) * 100).toFixed(3)),
        'gas/req': Math.ceil(tx.receipt.gasUsed / batch_size),
      })
      batchStart += batch_size
    })
  })
})
