const hre = require('hardhat')
const GateSeal = artifacts.require('GateSeal.sol')
const PausableUntil = artifacts.require('PausableUntilMock.sol')
const { time } = require('@nomicfoundation/hardhat-network-helpers')

const { assert } = require('../helpers/assert')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

contract('GateSeal', ([deployer, initializer, pauser, stranger]) => {
  let evmSnapshotId
  let gateSeal
  let pausable

  const pauseDuration = 60 * 60 * 24 * 7 // one week
  const shelfLife = 60 * 60 * 24 * 365 // one year

  before(async () => {
    gateSeal = await GateSeal.new(initializer, { from: deployer })
    pausable = await PausableUntil.new({ from: deployer })

    evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
  })

  afterEach(async () => {
    await hre.ethers.provider.send('evm_revert', [evmSnapshotId])
    evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
  })

  describe('happy path', () => {
    it('should be initialized correctly', async () => {
      await gateSeal.initialize(pausable.address, pauser, pauseDuration, shelfLife, { from: initializer })

      const isInitialized = await gateSeal.isInitialized()
      assert(isInitialized, 'expected to be initialized')

      const isPausedBefore = await pausable.isPaused()
      assert(!isPausedBefore, 'expected to be unpaused')

      await gateSeal.sealGate({ from: pauser })
      const pausedDate = await time.latest()

      const isPausedAfter = await pausable.isPaused()
      assert(isPausedAfter, 'expected to be paused')

      const blockTimestamp = await time.latest()
      const expiryDate = await gateSeal.getExpiryDate()
      assertBn(expiryDate, blockTimestamp - 1, 'expected to be expired')

      const isExpired = await gateSeal.isExpired()
      assert(isExpired, 'expected to be expired')

      await time.increaseTo(pausedDate + pauseDuration - 1)

      const isPausedBeforePauseOver = await pausable.isPaused()
      assert(isPausedBeforePauseOver, 'expected to be paused')

      await time.increaseTo(pausedDate + pauseDuration)

      const isPausedAfterPauseOver = await pausable.isPaused()
      assert(!isPausedAfterPauseOver, 'expected to be unpaused')
    })
  })

  describe('constructor', () => {
    it('should not accept zero address', async () => {
      await assert.reverts(GateSeal.new(ZERO_ADDRESS, { from: deployer }), 'ZeroAddress()')
    })
  })

  describe('initialize()', () => {
    it('should not allow stranger to initialize', async () => {
      await assert.reverts(
        gateSeal.initialize(pausable.address, pauser, pauseDuration, shelfLife, { from: stranger }),
        'NotInitializer()'
      )
    })

    it('should not initialize with pausable at zero address', async () => {
      await assert.reverts(
        gateSeal.initialize(ZERO_ADDRESS, pauser, pauseDuration, shelfLife, { from: initializer }),
        'ZeroAddress()'
      )
    })

    it('should not initialize with pauser at zero address', async () => {
      await assert.reverts(
        gateSeal.initialize(pausable.address, ZERO_ADDRESS, pauseDuration, shelfLife, { from: initializer }),
        'ZeroAddress()'
      )
    })

    it('should initialize only once', async () => {
      await gateSeal.initialize(pausable.address, pauser, pauseDuration, shelfLife, { from: initializer })

      await assert.reverts(
        gateSeal.initialize(pausable.address, ZERO_ADDRESS, pauseDuration, shelfLife, { from: initializer }),
        'AlreadyInitialized()'
      )
    })
  })

  describe('sealGate', () => {
    describe('initialized', () => {
      let initializedDate = 0

      before(async () => {
        await gateSeal.initialize(pausable.address, pauser, pauseDuration, shelfLife, { from: initializer })
        initializedDate = await time.latest()

        evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
      })

      it('should seal right up to expiry date', async () => {
        await time.increaseTo(initializedDate + shelfLife - 1)

        await gateSeal.sealGate({ from: pauser })

        const isPaused = await pausable.isPaused()
        assert(isPaused, 'expected to be paused')

        const isExpired = await gateSeal.isExpired()
        assert(isExpired, 'expected to be expired')
      })

      it('should not seal past expiry date', async () => {
        await time.increaseTo(initializedDate + shelfLife)

        await assert.reverts(gateSeal.sealGate({ from: pauser }), 'Expired()')

        const isExpired = await gateSeal.isExpired()
        assert(isExpired, 'expected to be expired')
      })
    })
  })
})
