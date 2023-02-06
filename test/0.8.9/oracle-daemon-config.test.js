const { assert } = require('chai')
const hre = require('hardhat')
const { keccak256 } = require('js-sha3')

const { assertRevert } = require('../helpers/assertThrow')
const { EvmSnapshot } = require('../helpers/blockchain')

const OracleDaemonConfig = hre.artifacts.require('OracleDaemonConfig.sol')

contract('OracleDaemonConfig', async ([deployer, manager, stranger]) => {
  let config, snapshot
  const defaultKey = '12345'
  const defaultKeyHash = '0x' + keccak256(defaultKey)
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
      const { keyHash, value } = await config.get(defaultKey)
      
      assert.equal(defaultValue, value)
      assert.equal(defaultKeyHash, keyHash)
    })

    it('updates a value', async () => {
      await config.update(defaultKey, updatedDefaultValue, { from: manager })

      const { keyHash, value } = await config.get(defaultKey)

      assert.notEqual(defaultValue, value)
      assert.equal(updatedDefaultValue, value)
      assert.equal(defaultKeyHash, keyHash)
    })

    it('gets all values', async () => {
      const values = await config.values()

      assert.equal(values.length, 1)
      assert.deepEqual(
        values.map((i) => i.keyHash),
        [defaultKeyHash]
      )
      assert.deepEqual(
        values.map((i) => i.value),
        [updatedDefaultValue]
      )
    })

    it('removes a value', async () => {
      await config.unset(defaultKey, { from: manager })

      assertRevert(config.get(defaultKey))
    })

    it('gets all values (empty)', async () => {
      const values = await config.values()

      assert.equal(values.length, 0)
      assert.deepEqual(
        values.map((i) => i.keyHash),
        []
      )
      assert.deepEqual(
        values.map((i) => i.value),
        []
      )
    })
  })

  describe('edge cases', async () => {
    beforeEach(async () => {
      await snapshot.rollback()
    })

    it("reverts when defaultValue for update doesn't exist", async () => {
      assertRevert(config.update(defaultKeyHash, defaultValue, { from: manager }), 'VALUE_DOESNT_EXIST')
    })

    it("reverts when defaultValue for unset doen't exist", async () => {
      assertRevert(config.unset(defaultKeyHash, { from: manager }), 'VALUE_DOESNT_EXIST')
    })

    it('reverts when defaultValue for set already exists', async () => {
      await config.set(defaultKeyHash, defaultValue, { from: manager })
      assertRevert(config.set(defaultKeyHash, updatedDefaultValue, { from: manager }), 'VALUE_EXISTS')
    })
  })

  describe('access control', async () => {
    beforeEach(async () => {
      await snapshot.rollback()
    })

    it('stranger cannot set a defaultValue', async () => {
      assertRevert(config.set(defaultKeyHash, defaultValue, { from: stranger }))
    })

    it('admin cannot set a defaultValue', async () => {
      assertRevert(config.set(defaultKeyHash, defaultValue, { from: deployer }))
    })

    it('stranger cannot update a defaultValue', async () => {
      await config.set(defaultKeyHash, defaultValue, { from: manager })
      assertRevert(config.update(defaultKeyHash, updatedDefaultValue, { from: stranger }))
    })

    it('admin cannot update a defaultValue', async () => {
      await config.set(defaultKeyHash, defaultValue, { from: manager })
      assertRevert(config.update(defaultKeyHash, updatedDefaultValue, { from: deployer }))
    })

    it('stranger cannot unset a defaultValue', async () => {
      await config.set(defaultKeyHash, defaultValue, { from: manager })
      assertRevert(config.unset(defaultKeyHash, { from: stranger }))
    })

    it('stranger cannot unset a defaultValue', async () => {
      await config.set(defaultKeyHash, defaultValue, { from: manager })
      assertRevert(config.unset(defaultKeyHash, { from: deployer }))
    })
  })
})
