const { artifacts, contract } = require('hardhat')
const { ZERO_ADDRESS } = require('../helpers/constants')

const { ETH } = require('../helpers/utils')
const withdrawals = require('../helpers/withdrawals')
const { assert } = require('../helpers/assert')

const StETHMock = artifacts.require('StETHPermitMock.sol')
const EIP712StETH = artifacts.require('EIP712StETH')

async function deployWithdrawalQueue({
  stethOwner,
  queueAdmin,
  queuePauser,
  queueResumer,
  queueFinalizer,
  queueBunkerReporter,
  queueName = 'Unsteth nft',
  symbol = 'UNSTETH',
  doResume = true,
}) {
  const steth = await StETHMock.new({ value: ETH(1), from: stethOwner })
  const eip712StETH = await EIP712StETH.new(steth.address, { from: stethOwner })
  await steth.initializeEIP712StETH(eip712StETH.address)

  const { queue: withdrawalQueue } = await withdrawals.deploy(queueAdmin, steth.address, queueName, symbol)

  const initTx = await withdrawalQueue.initialize(queueAdmin)

  await withdrawalQueue.grantRole(await withdrawalQueue.FINALIZE_ROLE(), queueFinalizer || steth.address, {
    from: queueAdmin,
  })
  await withdrawalQueue.grantRole(await withdrawalQueue.PAUSE_ROLE(), queuePauser || queueAdmin, { from: queueAdmin })
  await withdrawalQueue.grantRole(await withdrawalQueue.RESUME_ROLE(), queueResumer || queueAdmin, { from: queueAdmin })
  await withdrawalQueue.grantRole(
    await withdrawalQueue.BUNKER_MODE_REPORT_ROLE(),
    queueBunkerReporter || steth.address,
    { from: queueAdmin }
  )

  if (doResume) {
    await withdrawalQueue.resume({ from: queueResumer || queueAdmin })
  }

  return {
    initTx,
    steth,
    withdrawalQueue,
  }
}

module.exports = {
  deployWithdrawalQueue,
}

contract(
  'WithdrawalQueue',
  ([stethOwner, queueAdmin, queuePauser, queueResumer, queueFinalizer, queueBunkerReporter]) => {
    context('initialization', () => {
      it('is paused right after deploy', async () => {
        const { withdrawalQueue } = await deployWithdrawalQueue({
          stethOwner,
          queueAdmin,
          queuePauser,
          queueResumer,
          doResume: false,
        })
        assert.equals(await withdrawalQueue.isPaused(), true)
      })

      it('bunker mode is disabled by default', async () => {
        const { withdrawalQueue } = await deployWithdrawalQueue({
          stethOwner,
          queueAdmin,
          queuePauser,
          queueResumer,
        })
        const BUNKER_MODE_DISABLED_TIMESTAMP = await withdrawalQueue.BUNKER_MODE_DISABLED_TIMESTAMP()
        const isBunkerModeActive = await withdrawalQueue.isBunkerModeActive()
        const bunkerModeSinceTimestamp = await withdrawalQueue.bunkerModeSinceTimestamp()

        assert.equals(isBunkerModeActive, false)
        assert.equals(+bunkerModeSinceTimestamp, +BUNKER_MODE_DISABLED_TIMESTAMP)
      })

      it('emits InitializedV1', async () => {
        const { initTx } = await deployWithdrawalQueue({
          stethOwner,
          queueAdmin,
          queuePauser,
          queueResumer,
          queueFinalizer,
          queueBunkerReporter,
        })
        assert.emits(initTx, 'InitializedV1', {
          _admin: queueAdmin,
        })
      })

      it('initial queue and checkpoint items', async () => {
        const { withdrawalQueue } = await deployWithdrawalQueue({
          stethOwner,
          queueAdmin,
          queuePauser,
          queueResumer,
        })

        const queueId = await withdrawalQueue.getLastRequestId()
        const queueItem = await withdrawalQueue.getQueueItem(queueId)

        const checkpointIndex = await withdrawalQueue.getLastCheckpointIndex()
        const checkpointItem = await withdrawalQueue.getCheckpointItem(checkpointIndex)

        assert.equals(queueItem.cumulativeStETH, 0)
        assert.equals(queueItem.cumulativeShares, 0)
        assert.equals(queueItem.owner, ZERO_ADDRESS)
        assert.equals(queueItem.claimed, true)

        assert.equals(checkpointItem.fromRequestId, 0)
        assert.equals(checkpointItem.maxShareRate, 0)
      })

      it('check if pauser is zero', async () => {
        await assert.reverts(
          deployWithdrawalQueue({
            stethOwner,
            queueAdmin,
            queueName: '',
          }),
          'ZeroMetadata()'
        )
        await assert.reverts(
          deployWithdrawalQueue({
            stethOwner,
            queueAdmin,
            symbol: '',
          }),
          'ZeroMetadata()'
        )
      })
    })
  }
)
