const { artifacts, contract } = require('hardhat')
const { ZERO_ADDRESS, MAX_UINT256 } = require('../helpers/constants')

const { ETH, toBN } = require('../helpers/utils')
const withdrawals = require('../helpers/withdrawals')
const { assert } = require('../helpers/assert')

const StETHMock = artifacts.require('StETHPermitMock.sol')
const WstETH = artifacts.require('WstETHMock.sol')
const EIP712StETH = artifacts.require('EIP712StETH')
const NFTDescriptorMock = artifacts.require('NFTDescriptorMock.sol')

const QUEUE_NAME = 'Unsteth nft'
const QUEUE_SYMBOL = 'UNSTETH'
const NFT_DESCRIPTOR_BASE_URI = 'https://exampleDescriptor.com'

async function deployWithdrawalQueue({
  stethOwner,
  queueAdmin,
  queuePauser,
  queueResumer,
  queueFinalizer,
  queueOracle,
  queueName = QUEUE_NAME,
  symbol = QUEUE_SYMBOL,
  doResume = true,
}) {
  const nftDescriptor = await NFTDescriptorMock.new(NFT_DESCRIPTOR_BASE_URI)
  const steth = await StETHMock.new({ value: ETH(1), from: stethOwner })
  const wsteth = await WstETH.new(steth.address, { from: stethOwner })
  const eip712StETH = await EIP712StETH.new(steth.address, { from: stethOwner })
  await steth.initializeEIP712StETH(eip712StETH.address)

  const { queue: withdrawalQueue, impl: withdrawalQueueImplementation } = await withdrawals.deploy(
    queueAdmin,
    wsteth.address,
    queueName,
    symbol
  )

  const initTx = await withdrawalQueue.initialize(queueAdmin)

  await withdrawalQueue.grantRole(await withdrawalQueue.FINALIZE_ROLE(), queueFinalizer || steth.address, {
    from: queueAdmin,
  })
  await withdrawalQueue.grantRole(await withdrawalQueue.PAUSE_ROLE(), queuePauser || queueAdmin, { from: queueAdmin })
  await withdrawalQueue.grantRole(await withdrawalQueue.RESUME_ROLE(), queueResumer || queueAdmin, { from: queueAdmin })
  await withdrawalQueue.grantRole(await withdrawalQueue.ORACLE_ROLE(), queueOracle || steth.address, {
    from: queueAdmin,
  })

  if (doResume) {
    await withdrawalQueue.resume({ from: queueResumer || queueAdmin })
  }

  return {
    initTx,
    steth,
    wsteth,
    withdrawalQueue,
    nftDescriptor,
    withdrawalQueueImplementation,
  }
}

module.exports = {
  deployWithdrawalQueue,
  QUEUE_NAME,
  QUEUE_SYMBOL,
  NFT_DESCRIPTOR_BASE_URI,
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

      it('implementation is petrified', async () => {
        const { withdrawalQueueImplementation } = await deployWithdrawalQueue({
          stethOwner,
          queueAdmin,
          queuePauser,
          queueResumer,
          doResume: false,
        })

        assert.equals(await withdrawalQueueImplementation.getContractVersion(), toBN(MAX_UINT256))

        await assert.reverts(withdrawalQueueImplementation.initialize(queueAdmin), 'NonZeroContractVersionOnInit()')
      })
    })
  }
)
