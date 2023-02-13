const hre = require('hardhat')
const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

const { assert } = require('../helpers/assert')
const { EvmSnapshot } = require('../helpers/blockchain')

const OracleDaemonConfig = hre.artifacts.require('OracleDaemonConfig.sol')

contract('OracleDaemonConfig', async ([deployer, manager, stranger]) => {
  let config, snapshot
  const defaultKey = '12345'
  const defaultValue = '0x'.padEnd(66, '0101')
  const updatedDefaultValue = '0x'.padEnd(66, '0202')

  before(async () => {
    config = await OracleDaemonConfig.new(deployer, [manager], { from: deployer })
    snapshot = new EvmSnapshot(hre.ethers.provider)

    await snapshot.make()
  })

  describe('happy path', async () => {
    before(async () => {
      await snapshot.rollback()
    })

    it('sets a value', async () => {
      await config.set(defaultKey, defaultValue, { from: manager })
    })

    it('gets a value', async () => {
      const value = await config.get(defaultKey)

      assert.equal(defaultValue, value)
    })

    it('updates a value', async () => {
      await config.update(defaultKey, updatedDefaultValue, { from: manager })

      const value = await config.get(defaultKey)

      assert.notEqual(defaultValue, value)
      assert.equal(updatedDefaultValue, value)
    })

    it('gets all values', async () => {
      const values = await config.getList([defaultKey])

      assert.equal(values.length, 1)
      assert.deepEqual(
        values,
        [updatedDefaultValue]
      )
    })

    it('removes a value', async () => {
      await config.unset(defaultKey, { from: manager })

      await assert.reverts(config.get(defaultKey))
    })

    it('reverts while gets all values', async () => {
      await assert.revertsWithCustomError(config.getList([defaultKey]), `ErrorValueDoesntExist("${defaultKey}")`)
    })
  })

  describe('edge cases', async () => {
    beforeEach(async () => {
      await snapshot.rollback()
    })

    it("reverts when defaultValue for update doesn't exist", async () => {
      await assert.revertsWithCustomError(
        config.update(defaultKey, defaultValue, { from: manager }),
        `ErrorValueDoesntExist("${defaultKey}")`
      )
    })

    it("reverts when defaultValue for unset doen't exist", async () => {
      await assert.revertsWithCustomError(
        config.unset(defaultKey, { from: manager }),
        `ErrorValueDoesntExist("${defaultKey}")`
      )
    })

    it('reverts when defaultValue for set already exists', async () => {
      await config.set(defaultKey, defaultValue, { from: manager })
      await assert.revertsWithCustomError(
        config.set(defaultKey, updatedDefaultValue, { from: manager }),
        `ErrorValueExists("${defaultKey}")`
      )
    })

    it('reverts when admin is zero address', async () => {
      await assert.revertsWithCustomError(
        OracleDaemonConfig.new(ZERO_ADDRESS, [manager], { from: deployer }),
        'ErrorZeroAddress()'
      )
    })

    it('reverts when one of managers is zero address', async () => {
      await assert.revertsWithCustomError(OracleDaemonConfig.new(deployer, [manager, ZERO_ADDRESS], { from: deployer }), 'ErrorZeroAddress()')
    })

    it('revers when empty value passed to set', async () => {
      await assert.revertsWithCustomError(
        config.set(defaultKey, '0x', { from: manager }),
        `ErrorEmptyValue("${defaultKey}")`
      )
    })

    it('revers when empty value passed to update', async () => {
      await config.set(defaultKey, defaultValue, { from: manager })
      await assert.revertsWithCustomError(
        config.update(defaultKey, '0x', { from: manager }),
        `ErrorEmptyValue("${defaultKey}")`
      )
    })
  })

  describe('access control', async () => {
    beforeEach(async () => {
      await snapshot.rollback()
    })

    it('stranger cannot set a defaultValue', async () => {
      await assert.revertsOZAccessControl(
        config.set(defaultKey, defaultValue, { from: stranger }),
        stranger,
        `CONFIG_MANAGER_ROLE`
      )
    })

    it('deployer cannot set a defaultValue', async () => {
      await assert.revertsOZAccessControl(
        config.set(defaultKey, defaultValue, { from: deployer }),
        deployer,
        `CONFIG_MANAGER_ROLE`
      )
    })

    it('stranger cannot update a defaultValue', async () => {
      await config.set(defaultKey, defaultValue, { from: manager })
      await assert.revertsOZAccessControl(
        config.update(defaultKey, updatedDefaultValue, { from: stranger }),
        stranger,
        `CONFIG_MANAGER_ROLE`
      )
    })

    it('deployer cannot update a defaultValue', async () => {
      await config.set(defaultKey, defaultValue, { from: manager })
      await assert.revertsOZAccessControl(
        config.update(defaultKey, updatedDefaultValue, { from: deployer }),
        deployer,
        `CONFIG_MANAGER_ROLE`
      )
    })

    it('deployer cannot unset a defaultValue', async () => {
      await config.set(defaultKey, defaultValue, { from: manager })
      await assert.revertsOZAccessControl(
        config.unset(defaultKey, { from: deployer }),
        deployer,
        `CONFIG_MANAGER_ROLE`
      )
    })

    it('deployer cannot unset a defaultValue', async () => {
      await config.set(defaultKey, defaultValue, { from: manager })
      assert.revertsOZAccessControl(
        config.unset(defaultKey, { from: deployer }),
        deployer,
        `CONFIG_MANAGER_ROLE`
      )
    })
  })
})
