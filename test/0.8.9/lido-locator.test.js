const { ethers, contract, artifacts } = require('hardhat')

const { ZERO_ADDRESS } = require('../helpers/constants')
const { assert } = require('../helpers/assert')
const { locatorServices, getRandomLocatorConfig } = require('../helpers/locator')

const Proxy = artifacts.require('OssifiableProxy.sol')
const LidoLocator = artifacts.require('LidoLocator.sol')

contract('LidoLocator', ([deployer, agent]) => {
  let evmSnapshotId
  let proxy
  let lidoLocatorProxy
  const initialConfig = getRandomLocatorConfig()

  before(async () => {
    const implementation = await LidoLocator.new(initialConfig, { from: deployer })
    proxy = await Proxy.new(implementation.address, agent, '0x', { from: deployer })
    lidoLocatorProxy = await LidoLocator.at(proxy.address)

    evmSnapshotId = await ethers.provider.send('evm_snapshot', [])
  })

  afterEach(async () => {
    await ethers.provider.send('evm_revert', [evmSnapshotId])
    evmSnapshotId = await ethers.provider.send('evm_snapshot', [])
  })

  describe('checking initial implementation', () => {
    for (const [getter, address] of Object.entries(initialConfig)) {
      it(`${getter}() matches to what's been passed to constructor`, async () => {
        const expectedAddress = address
        const actualAddress = await lidoLocatorProxy[getter]()

        assert(actualAddress === expectedAddress, `expected ${expectedAddress}, got ${actualAddress}`)
      })
    }

    it('coreComponents() matches', async () => {
      const actualCoreComponents = await lidoLocatorProxy.coreComponents()

      const expectedCoreComponents = [
        initialConfig.elRewardsVault,
        initialConfig.oracleReportSanityChecker,
        initialConfig.stakingRouter,
        initialConfig.treasury,
        initialConfig.withdrawalQueue,
        initialConfig.withdrawalVault,
      ]

      for (let i = 0; i < actualCoreComponents.length; i++) {
        const actual = actualCoreComponents[i]
        const expected = expectedCoreComponents[i]

        assert(actual === expected, 'coreComponents mismatch')
      }
    })

    it('oracleReportComponentsForLido() matches', async () => {
      const actualReportComponents = await lidoLocatorProxy.oracleReportComponentsForLido()

      const expectedReportComponents = [
        initialConfig.accountingOracle,
        initialConfig.elRewardsVault,
        initialConfig.oracleReportSanityChecker,
        initialConfig.burner,
        initialConfig.withdrawalQueue,
        initialConfig.withdrawalVault,
        initialConfig.postTokenRebaseReceiver,
      ]

      for (let i = 0; i < actualReportComponents.length; i++) {
        const actual = actualReportComponents[i]
        const expected = expectedReportComponents[i]

        assert(actual === expected, 'reportComponentsForLido mismatch')
      }
    })
  })

  describe('breaking constructor', () => {
    it('should revert when passing a zero address', async () => {
      const configsWithZeroAddress = []
      for (const service of locatorServices) {
        const config = getRandomLocatorConfig({ [service]: ZERO_ADDRESS })
        configsWithZeroAddress.push(config)
      }

      for (const config of configsWithZeroAddress) {
        await assert.reverts(LidoLocator.new(config), 'ZeroAddress()')
      }
    })
  })

  describe('checking updated implementation', () => {
    describe('works after upgrade to a compatible impl', () => {
      const updatedConfig = getRandomLocatorConfig()

      beforeEach(async () => {
        const updatedImplementation = await LidoLocator.new(updatedConfig, { from: deployer })
        await proxy.proxy__upgradeTo(updatedImplementation.address, { from: agent })
        lidoLocatorProxy = await LidoLocator.at(proxy.address)
      })

      it(`new implementation config matches`, async () => {
        for (const [getter, address] of Object.entries(updatedConfig)) {
          const expectedAddress = address
          const actualAddress = await lidoLocatorProxy[getter]()

          assert(actualAddress === expectedAddress, `expected ${expectedAddress}, got ${actualAddress}`)
        }
      })

      it('coreComponents() matches', async () => {
        const actualCoreComponents = await lidoLocatorProxy.coreComponents()

        const expectedCoreComponents = [
          updatedConfig.elRewardsVault,
          updatedConfig.oracleReportSanityChecker,
          updatedConfig.stakingRouter,
          updatedConfig.treasury,
          updatedConfig.withdrawalQueue,
          updatedConfig.withdrawalVault,
        ]

        for (let i = 0; i < actualCoreComponents.length; i++) {
          const actual = actualCoreComponents[i]
          const expected = expectedCoreComponents[i]

          assert(actual === expected, 'coreComponents mismatch')
        }
      })

      it('oracleReportComponentsForLido() matches', async () => {
        const actualReportComponents = await lidoLocatorProxy.oracleReportComponentsForLido()

        const expectedReportComponents = [
          initialConfig.accountingOracle,
          initialConfig.elRewardsVault,
          initialConfig.oracleReportSanityChecker,
          initialConfig.burner,
          initialConfig.withdrawalQueue,
          initialConfig.withdrawalVault,
          initialConfig.postTokenRebaseReceiver,
        ]

        for (let i = 0; i < actualReportComponents.length; i++) {
          const actual = actualReportComponents[i]
          const expected = expectedReportComponents[i]

          assert(actual === expected, 'reportComponentsForLido mismatch')
        }
      })
    })
  })
})
