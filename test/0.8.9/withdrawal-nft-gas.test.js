const { contract, web3 } = require('hardhat')

const { ETH, StETH, shareRate, shares } = require('../helpers/utils')
const { assert } = require('../helpers/assert')

const { deployWithdrawalQueue } = require('./withdrawal-queue-deploy.test')

contract('WithdrawalQueue', ([owner, daoAgent, user, tokenUriManager]) => {
  let withdrawalQueue

  before('deploy', async function () {
    if (!process.env.REPORT_GAS) {
      this.skip()
    }
    const deployed = await deployWithdrawalQueue({
      stethOwner: owner,
      queueAdmin: daoAgent,
      queuePauser: daoAgent,
      queueResumer: daoAgent,
      queueFinalizer: daoAgent,
    })

    const steth = deployed.steth
    withdrawalQueue = deployed.withdrawalQueue
    await withdrawalQueue.grantRole(web3.utils.keccak256('MANAGE_TOKEN_URI_ROLE'), tokenUriManager, { from: daoAgent })
    await withdrawalQueue.setBaseURI('http://example.com', { from: tokenUriManager })

    await steth.setTotalPooledEther(ETH(600))
    await steth.mintShares(user, shares(1))
    await steth.approve(withdrawalQueue.address, StETH(300), { from: user })
  })

  it('findCheckpointHints gas spendings', async () => {
    // checkpoints is created daily, so 2048 is enough for 6 years at least
    const maxCheckpontSize = 2048

    let size = 1
    while (size <= maxCheckpontSize) {
      await setUpCheckpointsUpTo(size)

      console.log(
        'findCheckpointHints([1], 1, checkpointsSize): Gas spent:',
        await withdrawalQueue.findCheckpointHints.estimateGas([1], 1, size),
        'tokenURI(1): Gas spent:',
        await withdrawalQueue.tokenURI.estimateGas(1),
        'checkpoints size: ',
        size
      )
      size = size * 2
    }
  }).timeout(0)

  async function setUpCheckpointsUpTo(n) {
    for (let i = await withdrawalQueue.getLastCheckpointIndex(); i < n; i++) {
      await withdrawalQueue.requestWithdrawals([StETH(0.00001)], user, { from: user })
      await withdrawalQueue.finalize([await withdrawalQueue.getLastRequestId()], shareRate(300), {
        from: daoAgent,
        value: ETH(0.00001),
      })
    }

    assert.equals(await withdrawalQueue.getLastCheckpointIndex(), n, 'last checkpoint index')
  }
})
