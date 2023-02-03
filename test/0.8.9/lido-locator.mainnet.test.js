const hre = require('hardhat')
const { assert } = require('../helpers/assert')
const Proxy = artifacts.require('OssifiableProxy.sol')
const LidoLocator = artifacts.require('LidoLocator.sol')
const LidoLocatorUpdated = artifacts.require('LidoLocatorUpdatedMock.sol')

contract('LidoLocator.Mainnet', async ([deployer, agent]) => {
  let evmSnapshotId
  let proxy
  let lidoLocatorProxy

  before(async () => {
    const implementation = await LidoLocator.new({ from: deployer })
    proxy = await Proxy.new(implementation.address, agent, '0x', { from: deployer })
    lidoLocatorProxy = await LidoLocator.at(proxy.address)

    evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
  })

  afterEach(async () => {
    await hre.ethers.provider.send('evm_revert', [evmSnapshotId])
    evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
  })

  describe('initial implementation', () => {
    for (const { name, address, getter } of getLidoLocatorInitialServices()) {
      it(`${name} address matches`, async () => {
        const actualAddress = await lidoLocatorProxy[getter]()
        assert(actualAddress === address, `expected ${address}, got ${actualAddress}`)
      })
    }
  })

  describe('updated implementation', () => {
    before(async () => {
      const updatedImplementation = await LidoLocatorUpdated.new({ from: deployer })
      await proxy.proxy__upgradeTo(updatedImplementation.address, { from: agent })
      lidoLocatorProxy = await LidoLocatorUpdated.at(proxy.address)

      evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
    })

    for (const { name, address, getter } of getLidoLocatorUpdatedServices()) {
      it(`${name} address matches`, async () => {
        const actualAddress = await lidoLocatorProxy[getter]()
        assert(actualAddress === address, `expected ${address}, got ${actualAddress}`)
      })
    }
  })
})

function getLidoLocatorInitialServices() {
  return [
    {
      name: 'Lido',
      address: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
      getter: 'getLido'
    },
    {
      name: 'DepositSecurityModule',
      address: '0x710B3303fB508a84F10793c1106e32bE873C24cd',
      getter: 'getDepositSecurityModule'
    },
    {
      name: 'ELRewardsVault',
      address: '0x388C818CA8B9251b393131C08a736A67ccB19297',
      getter: 'getELRewardsVault'
    },
    {
      name: 'Oracle',
      address: '0x442af784A788A5bd6F42A01Ebe9F287a871243fb',
      getter: 'getOracle'
    },
    {
      name: 'CompositePostRebaseBeaconReceiver',
      address: '0x55a7E1cbD678d9EbD50c7d69Dc75203B0dBdD431',
      getter: 'getCompositePostRebaseBeaconReceiver'
    },
    {
      name: 'SafetyNetsRegistry',
      address: '0x1111111111111111111111111111111111111111',
      getter: 'getSafetyNetsRegistry'
    },
    {
      name: 'SelfOwnedStETHBurner',
      address: '0xB280E33812c0B09353180e92e27b8AD399B07f26',
      getter: 'getSelfOwnedStETHBurner'
    },
    {
      name: 'StakingRouter',
      address: '0x2222222222222222222222222222222222222222',
      getter: 'getStakingRouter'
    },
    {
      name: 'Treasury',
      address: '0x3e40D73EB977Dc6a537aF587D48316feE66E9C8c',
      getter: 'getTreasury'
    },
    {
      name: 'WithdrawalQueue',
      address: '0x3333333333333333333333333333333333333333',
      getter: 'getWithdrawalQueue'
    },
    {
      name: 'WithdrawalVault',
      address: '0x4444444444444444444444444444444444444444',
      getter: 'getWithdrawalVault'
    }
  ]
}

function getLidoLocatorUpdatedServices() {
  return [
    {
      name: 'Lido',
      address: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
      getter: 'getLido'
    },
    {
      name: 'ELRewardsVault',
      address: '0x388C818CA8B9251b393131C08a736A67ccB19297',
      getter: 'getELRewardsVault'
    },
    {
      name: 'Oracle',
      address: '0x442af784A788A5bd6F42A01Ebe9F287a871243fb',
      getter: 'getOracle'
    },
    {
      name: 'CompositePostRebaseBeaconReceiver',
      address: '0x55a7E1cbD678d9EbD50c7d69Dc75203B0dBdD431',
      getter: 'getCompositePostRebaseBeaconReceiver'
    },
    {
      name: 'getSafetyNetsRegistries',
      address: '0x1111111111111111111111111111111111111111',
      getter: 'getSafetyNetsRegistries'
    },
    {
      name: 'SelfOwnedStETHBurner',
      address: '0xB280E33812c0B09353180e92e27b8AD399B07f26',
      getter: 'getSelfOwnedStETHBurner'
    },
    {
      name: 'SomeNewLidoService',
      address: '0x1212121212121212121212121212121212121212',
      getter: 'getSomeNewLidoService'
    },
    {
      name: 'StakingRouter',
      address: '0x2222222222222222222222222222222222222222',
      getter: 'getStakingRouter'
    },
    {
      name: 'Treasury',
      address: '0x3e40D73EB977Dc6a537aF587D48316feE66E9C8c',
      getter: 'getTreasury'
    },
    {
      name: 'WithdrawalQueue',
      address: '0x5555555555555555555555555555555555555555',
      getter: 'getWithdrawalQueue'
    },
    {
      name: 'WithdrawalVault',
      address: '0x4444444444444444444444444444444444444444',
      getter: 'getWithdrawalVault'
    }
  ]
}
