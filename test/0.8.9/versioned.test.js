const { contract, artifacts } = require('hardhat')
const { assert } = require('../helpers/assert')

async function deployBehindOssifiableProxy(artifactName, proxyOwner, constructorArgs = []) {
  const Contract = await artifacts.require(artifactName)
  const implementation = await Contract.new(...constructorArgs, { from: proxyOwner })
  const OssifiableProxy = await artifacts.require('OssifiableProxy')
  const proxy = await OssifiableProxy.new(implementation.address, proxyOwner, [], { from: proxyOwner })
  const proxied = await Contract.at(proxy.address)
  return { implementation, proxy, proxied }
}

contract('Versioned', ([admin, proxyOwner, account2, member1, member2]) => {
  let versionedImpl
  let versionedProxied
  const VERSION_INIT = 1
  const VERSION_ZERO = 0

  before('Deploy', async () => {
    const deployed = await deployBehindOssifiableProxy(
      'contracts/0.8.9/test_helpers/VersionedMock.sol:VersionedMock',
      proxyOwner,
      []
    )
    versionedImpl = deployed.implementation
    versionedProxied = deployed.proxied
  })

  describe('raw implementation', async () => {
    it('default version is petrified', async () => {
      const versionPetrified = await versionedImpl.getPetrifiedVersionMark()
      assert.equals(await versionedImpl.getContractVersion(), versionPetrified)
      await assert.reverts(
        versionedImpl.checkContractVersion(VERSION_ZERO),
        `UnexpectedContractVersion(${String(versionPetrified)}, ${VERSION_ZERO})`
      )
    })

    it('reverts if trying to initialize', async () => {
      await versionedImpl.getContractVersion()
      await assert.reverts(versionedImpl.initializeContractVersionTo(1), 'NonZeroContractVersionOnInit()')
    })
  })

  describe('behind proxy', () => {
    it('default version is zero', async () => {
      const version = await versionedProxied.getContractVersion()
      assert.equals(version, VERSION_ZERO)
      await versionedProxied.checkContractVersion(VERSION_ZERO)
      await assert.reverts(
        versionedProxied.checkContractVersion(VERSION_INIT),
        `UnexpectedContractVersion(${VERSION_ZERO}, ${VERSION_INIT})`
      )
    })

    it('initialize sets version and emits event', async () => {
      const tx = await versionedProxied.initializeContractVersionTo(VERSION_INIT)
      assert.emits(tx, 'ContractVersionSet', { version: VERSION_INIT })
      assert.equals(await versionedProxied.getContractVersion(), VERSION_INIT)
      await versionedProxied.checkContractVersion(VERSION_INIT)
      await assert.reverts(
        versionedProxied.checkContractVersion(VERSION_ZERO),
        `UnexpectedContractVersion(${VERSION_INIT}, ${VERSION_ZERO})`
      )
    })

    it('reverts if trying to repeat initialize', async () => {
      await assert.reverts(versionedProxied.initializeContractVersionTo(1), 'NonZeroContractVersionOnInit()')
    })

    it('version can be incremented by value 1 at time', async () => {
      const prevVersion = +(await versionedProxied.getContractVersion())
      const nextVersion = prevVersion + 1
      const tx = await versionedProxied.updateContractVersion(nextVersion)
      assert.emits(tx, 'ContractVersionSet', { version: nextVersion })
      await versionedProxied.checkContractVersion(nextVersion)
      await assert.reverts(
        versionedProxied.checkContractVersion(prevVersion),
        `UnexpectedContractVersion(${nextVersion}, ${prevVersion})`
      )
      const newVersion = +(await versionedProxied.getContractVersion())
      assert.equals(newVersion, nextVersion)
    })

    it('reverts if trying to update version with incorrect value', async () => {
      const prevVersion = +(await versionedProxied.getContractVersion())
      await assert.reverts(versionedProxied.updateContractVersion(prevVersion - 1), 'InvalidContractVersionIncrement()')
      await assert.reverts(versionedProxied.updateContractVersion(prevVersion), 'InvalidContractVersionIncrement()')
      await assert.reverts(versionedProxied.updateContractVersion(prevVersion + 2), 'InvalidContractVersionIncrement()')
    })
  })
})
