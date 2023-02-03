const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const { randomBytes } = require('crypto')
const { toChecksumAddress } = require('ethereumjs-util')
const hre = require('hardhat')
const { assert } = require('../helpers/assert')
const Proxy = artifacts.require('OssifiableProxy.sol')
const LidoLocator = artifacts.require('LidoLocator.sol')
const LidoLocatorUpdated = artifacts.require('LidoLocatorUpdatedMock.sol')

contract('LidoLocator', async ([deployer, agent]) => {
  let evmSnapshotId
  let proxy
  let lidoLocatorProxy
  let initialAddresses = []
  let updatedAddresses = []

  before(async () => {
    initialAddresses = generateRandomAddresses(getInitialGetters().length)

    const implementation = await LidoLocator.new(initialAddresses, { from: deployer })
    proxy = await Proxy.new(implementation.address, agent, '0x', { from: deployer })
    lidoLocatorProxy = await LidoLocator.at(proxy.address)

    evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
  })

  afterEach(async () => {
    await hre.ethers.provider.send('evm_revert', [evmSnapshotId])
    evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
  })

  describe('checking initial implementation', () => {
    for (const [index, getter] of getInitialGetters().entries()) {
      it(`${getter}() matches to what's been passed to constructor`, async () => {
        const expectedAddress = initialAddresses[index]
        const actualAddress = await lidoLocatorProxy[getter]()

        assert(actualAddress === expectedAddress, `expected ${expectedAddress}, got ${actualAddress}`)
      })
    }
  })

  describe('breaking constructor', () => {
    it('should revert when passing an incorrect number of addresses', async () => {
      const correctNumberOfAddresses = getInitialGetters().length

      const constructorsInputs = [
        generateRandomAddresses(0),
        generateRandomAddresses(correctNumberOfAddresses - 1),
        generateRandomAddresses(correctNumberOfAddresses + 1)
      ]

      for (const addresses of constructorsInputs) {
        await assert.reverts(LidoLocator.new(addresses), 'ErrorIncorrectLength()')
      }
    })

    it('should revert when passing a zero address', async () => {
      const numberOfAddresses = getInitialGetters().length

      // generate constructor inputs with a ZERO_ADDRESS at each index
      const constructorsInputs = []
      for (let i = 0; i < numberOfAddresses; i++) {
        const addresses = generateRandomAddresses(numberOfAddresses)
        addresses[i] = ZERO_ADDRESS
      }

      for (const addresses of constructorsInputs) {
        await assert.reverts(LidoLocator.new(addresses), 'ErrorZeroAddress()')
      }
    })
  })

  describe('checking updated implementation', () => {
    it('works after upgrade to a compatible impl', async () => {
      updatedAddresses = generateRandomAddresses(getInitialGetters().length)

      const updatedImplementation = await LidoLocator.new(updatedAddresses, { from: deployer })
      await proxy.proxy__upgradeTo(updatedImplementation.address, { from: agent })
      lidoLocatorProxy = await LidoLocator.at(proxy.address)

      for (const [index, getter] of getInitialGetters().entries()) {
        const expectedAddress = updatedAddresses[index]
        const actualAddress = await lidoLocatorProxy[getter]()

        assert(actualAddress === expectedAddress, `expected ${expectedAddress}, got ${actualAddress}`)
      }
    })

    it('works after upgrade to an incompatible impl', async () => {
      updatedAddresses = generateRandomAddresses(getUpdatedGetters().length)

      const updatedImplementation = await LidoLocatorUpdated.new(updatedAddresses, { from: deployer })
      await proxy.proxy__upgradeTo(updatedImplementation.address, { from: agent })
      lidoLocatorProxy = await LidoLocatorUpdated.at(proxy.address)

      for (const [index, getter] of getUpdatedGetters().entries()) {
        const expectedAddress = updatedAddresses[index]
        const actualAddress = await lidoLocatorProxy[getter]()

        assert(actualAddress === expectedAddress, `expected ${expectedAddress}, got ${actualAddress}`)
      }
    })
  })
})

function getInitialGetters() {
  return [
    'getLido',
    'getCompositePostRebaseBeaconReceiver',
    'getDepositSecurityModule',
    'getELRewardsVault',
    'getOracle',
    'getSafetyNetsRegistry',
    'getSelfOwnedStETHBurner',
    'getStakingRouter',
    'getTreasury',
    'getWithdrawalQueue',
    'getWithdrawalVault'
  ]
}

function getUpdatedGetters() {
  return [
    'getLido',
    'getElRewardsVault',
    'getOracle',
    'getCompositePostRebaseBeaconReceiver',
    'getSafetyNetsRegistries',
    'getSelfOwnedStETHBurner',
    'getStakingRouter',
    'getSomeNewLidoService0',
    'getSomeNewLidoService1',
    'getTreasury',
    'getWithdrawalQueue',
    'getWithdrawalVault'
  ]
}

function generateRandomAddresses(number) {
  return Array.from({ length: number }, generateRandomAddress)
}

function generateRandomAddress() {
  return toChecksumAddress('0x' + randomBytes(20).toString('hex'))
}
