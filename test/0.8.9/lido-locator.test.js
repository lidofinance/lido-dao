const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const { randomBytes } = require('crypto')
const { toChecksumAddress } = require('ethereumjs-util')
const hre = require('hardhat')
const { assert } = require('../helpers/assert')
const Proxy = artifacts.require('OssifiableProxy.sol')
const LidoLocator = artifacts.require('LidoLocator.sol')

const services = [
  'accountingOracle',
  'depositSecurityModule',
  'elRewardsVault',
  'legacyOracle',
  'lido',
  'safetyNetsRegistry',
  'selfOwnedStEthBurner',
  'stakingRouter',
  'treasury',
  'validatorExitBus',
  'withdrawalQueue',
  'withdrawalVault'
]

contract('LidoLocator', ([deployer, agent]) => {
  let evmSnapshotId
  let proxy
  let lidoLocatorProxy
  const initialConfig = getRandomConfig()

  before(async () => {
    const implementation = await LidoLocator.new(initialConfig, { from: deployer })
    proxy = await Proxy.new(implementation.address, agent, '0x', { from: deployer })
    lidoLocatorProxy = await LidoLocator.at(proxy.address)

    evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
  })

  afterEach(async () => {
    await hre.ethers.provider.send('evm_revert', [evmSnapshotId])
    evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
  })

  describe('checking initial implementation', () => {
    for (const [getter, address] of Object.entries(initialConfig)) {
      it(`${getter}() matches to what's been passed to constructor`, async () => {
        const expectedAddress = address
        const actualAddress = await lidoLocatorProxy[getter]()

        assert(actualAddress === expectedAddress, `expected ${expectedAddress}, got ${actualAddress}`)
      })
    }
  })

  describe('breaking constructor', () => {
    it('should revert when passing a zero address', async () => {
      const configsWithZeroAddress = []
      for (const service of services) {
        const config = getRandomConfig()
        config[service] = ZERO_ADDRESS

        configsWithZeroAddress.push(config)
      }

      for (const config of configsWithZeroAddress) {
        await assert.reverts(LidoLocator.new(config), 'ErrorZeroAddress()')
      }
    })
  })

  describe('checking updated implementation', () => {
    it('works after upgrade to a compatible impl', async () => {
      const updatedConfig = getRandomConfig()

      const updatedImplementation = await LidoLocator.new(updatedConfig, { from: deployer })
      await proxy.proxy__upgradeTo(updatedImplementation.address, { from: agent })
      lidoLocatorProxy = await LidoLocator.at(proxy.address)

      for (const [getter, address] of Object.entries(updatedConfig)) {
        it(`new ${getter}() matches`, async () => {
          const expectedAddress = address
          const actualAddress = await lidoLocatorProxy[getter]()

          assert(actualAddress === expectedAddress, `expected ${expectedAddress}, got ${actualAddress}`)
        })
      }
    })
  })
})

function getRandomConfig() {
  return services.reduce((config, current) => {
    config[current] = generateRandomAddress()
    return config
  }, {})
}

function generateRandomAddress() {
  return toChecksumAddress('0x' + randomBytes(20).toString('hex'))
}
