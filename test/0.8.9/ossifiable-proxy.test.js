const { assert } = require('../helpers/assert')
const { contract, artifacts, network } = require('hardhat')

const TruffleContract = require('@truffle/contract')
const { ContractStub } = require('../helpers/contract-stub')
const { ZERO_ADDRESS } = require('../helpers/constants')
const { EvmSnapshot } = require('../helpers/blockchain')

const InitializableABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'uint256',
        name: 'version',
        type: 'uint256',
      },
    ],
    name: 'Initialized',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [],
    name: 'ReceiveCalled',
    type: 'event',
  },
  {
    inputs: [
      {
        internalType: 'uint8',
        name: 'version_',
        type: 'uint8',
      },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'version',
    outputs: [
      {
        internalType: 'uint8',
        name: '',
        type: 'uint8',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
]

const OssifiableProxy = artifacts.require('OssifiableProxy')
const InitializableContract = TruffleContract({ abi: InitializableABI })

contract('OssifiableProxy', ([deployer, admin, stranger]) => {
  let currentImpl, newImpl, proxy, proxiedImpl
  const snapshot = new EvmSnapshot(network.provider)

  before(async () => {
    InitializableContract.setProvider(network.provider)
    currentImpl = await ContractStub(InitializableContract).create({ from: deployer })
    newImpl = await ContractStub(InitializableContract)
      .frame(0)
      .on('receive', { emits: [{ name: 'ReceiveCalled' }] })
      .on('version', { return: { type: ['uint8'], value: [0] } })
      .on('initialize', { emits: [{ name: 'Initialized', args: { type: ['uint256'], value: [1] } }], nextFrame: 1 })

      .frame(1)
      .on('version', { return: { type: ['uint8'], value: [1] } })
      .create({ from: deployer })

    proxy = await OssifiableProxy.new(currentImpl.address, admin, '0x', { from: deployer })
    proxiedImpl = await InitializableContract.at(proxy.address)
    await snapshot.make()
  })

  afterEach(async () => snapshot.rollback())

  describe('getters', () => {
    it('proxy__getAdmin()', async () => {
      assert.equal(await proxy.proxy__getAdmin(), admin)
    })

    it('proxy__getImplementation()', async () => {
      assert.equal(await proxy.proxy__getImplementation(), currentImpl.address)
    })

    it('proxy__getIsOssified()', async () => {
      assert.isFalse(await proxy.proxy__getIsOssified())
    })
  })

  describe('proxy__ossify()', () => {
    it('reverts with error "NotAdmin" when called by stranger', async () => {
      await assert.reverts(proxy.proxy__ossify({ from: stranger }), 'NotAdmin()')
    })

    it('reverts with error "ProxyIsOssified" when called on ossified proxy', async () => {
      // ossify proxy
      await proxy.proxy__ossify({ from: admin })

      // validate proxy is ossified
      assert.isTrue(await proxy.proxy__getIsOssified())

      await assert.reverts(proxy.proxy__ossify({ from: admin }), 'ProxyIsOssified()')
    })

    it('ossifies proxy', async () => {
      const tx = await proxy.proxy__ossify({ from: admin })

      // validate AdminChanged event was emitted
      assert.emits(tx, 'AdminChanged', { previousAdmin: admin, newAdmin: ZERO_ADDRESS })

      // validate ProxyOssified event was emitted
      assert.emits(tx, 'ProxyOssified')

      // validate proxy is ossified
      assert.isTrue(await proxy.proxy__getIsOssified())
    })
  })

  describe('proxy__changeAdmin()', () => {
    it('reverts with error "NotAdmin" when called by stranger', async () => {
      await assert.reverts(proxy.proxy__changeAdmin(stranger, { from: stranger }), 'NotAdmin()')
    })

    it('reverts with error "ProxyIsOssified" when called on ossified proxy', async () => {
      // ossify proxy
      await proxy.proxy__ossify({ from: admin })

      // validate proxy is ossified
      assert.isTrue(await proxy.proxy__getIsOssified())

      await assert.reverts(proxy.proxy__changeAdmin(stranger, { from: admin }), 'ProxyIsOssified()')
    })

    it('changes admin', async () => {
      const tx = await proxy.proxy__changeAdmin(stranger, { from: admin })

      // validate AdminChanged event was emitted
      assert.emits(tx, 'AdminChanged', { previousAdmin: admin, newAdmin: stranger })

      // validate admin was changed
      assert.equal(await proxy.proxy__getAdmin(), stranger)
    })
  })

  describe('proxy__upgradeTo()', () => {
    it('reverts with error "NotAdmin" called by stranger', async () => {
      await assert.reverts(proxy.proxy__upgradeTo(newImpl.address, { from: stranger }), 'NotAdmin()')
    })

    it('reverts with error "ProxyIsOssified()" when called on ossified proxy', async () => {
      // ossify proxy
      await proxy.proxy__ossify({ from: admin })

      // validate proxy is ossified
      assert.isTrue(await proxy.proxy__getIsOssified())

      await assert.reverts(proxy.proxy__upgradeTo(newImpl.address, { from: admin }), 'ProxyIsOssified()')
    })

    it('upgrades proxy to new implementation', async () => {
      const tx = await proxy.proxy__upgradeTo(newImpl.address, { from: admin })

      // validate Upgraded event was emitted
      assert.emits(tx, 'Upgraded', { implementation: newImpl.address })

      // validate implementation address was updated
      assert.equal(await proxy.proxy__getImplementation(), newImpl.address)
    })
  })

  describe('proxy__upgradeToAndCall()', () => {
    let initPayload
    it('reverts with error "NotAdmin()" when called by stranger', async () => {
      initPayload = newImpl.contract.methods.initialize(1).encodeABI()
      await assert.reverts(
        proxy.proxy__upgradeToAndCall(newImpl.address, initPayload, false, {
          from: stranger,
        }),
        'NotAdmin()'
      )
    })

    it('reverts with error "ProxyIsOssified()" whe called on ossified proxy', async () => {
      // ossify proxy
      await proxy.proxy__ossify({ from: admin })

      // validate proxy is ossified
      assert.isTrue(await proxy.proxy__getIsOssified())

      await assert.reverts(proxy.proxy__upgradeToAndCall(newImpl.address, initPayload, false), 'ProxyIsOssified()')
    })

    it('upgrades proxy to new implementation when forceCall is false', async () => {
      const tx = await proxy.proxy__upgradeToAndCall(newImpl.address, initPayload, false, { from: admin })

      // validate Upgraded event was emitted
      assert.emits(tx, 'Upgraded', { implementation: newImpl.address })

      // validate Initialized event was emitted
      assert.emits(tx, 'Initialized', { version: 1 }, { abi: InitializableABI })

      // validate implementation address was updated
      assert.equal(await proxy.proxy__getImplementation(), newImpl.address)

      // validate version was set
      assert.equal(await proxiedImpl.version(), 1)
    })

    it('upgrades proxy to new implementation when forceCall is false', async () => {
      const tx = await proxy.proxy__upgradeToAndCall(newImpl.address, '0x', true, { from: admin })

      // validate Upgraded event was emitted
      assert.emits(tx, 'Upgraded', { implementation: newImpl.address })

      // validate ReceiveCalled event was emitted
      assert.emits(tx, 'ReceiveCalled', {}, { abi: InitializableABI })

      // validate implementation address was updated
      assert.equal(await proxy.proxy__getImplementation(), newImpl.address)

      // validate version wasn't set
      assert.equal(await proxiedImpl.version(), 0)
    })
  })
})
