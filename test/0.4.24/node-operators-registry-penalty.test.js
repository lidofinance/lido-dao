const hre = require('hardhat')
const { assert } = require('../helpers/assert')
const { assertRevert } = require('../helpers/assertThrow')
const { toBN, padRight } = require('../helpers/utils')
const { AragonDAO } = require('./helpers/dao')
const { EvmSnapshot } = require('../helpers/blockchain')
const { ZERO_ADDRESS, getEventAt } = require('@aragon/contract-helpers-test')
const nodeOperators = require('../helpers/node-operators')
const signingKeys = require('../helpers/signing-keys')
const { web3 } = require('hardhat')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistryMock')
const INodeOperatorsRegistry = artifacts.require('contracts/0.4.24/interfaces/INodeOperatorsRegistry.sol:INodeOperatorsRegistry')

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'
const ADDRESS_3 = '0x0000000000000000000000000000000000000003'
const ADDRESS_4 = '0x0000000000000000000000000000000000000005'

const NODE_OPERATORS = [
  {
    name: 'fo o',
    rewardAddress: ADDRESS_1,
    totalSigningKeysCount: 10,
    depositedSigningKeysCount: 5,
    exitedSigningKeysCount: 1,
    vettedSigningKeysCount: 6,
    targetValidatorsLimitActive: false,
    targetValidatorsKeysCount: 1,
    unavaliableKeysCount: 2,
    stuckSigningKeysCount: 3,
    forgivenSigningKeysCount: 4,
  },
  {
    name: ' bar',
    rewardAddress: ADDRESS_2,
    totalSigningKeysCount: 15,
    depositedSigningKeysCount: 7,
    exitedSigningKeysCount: 0,
    vettedSigningKeysCount: 10,
    targetValidatorsLimitActive: false,
    targetValidatorsKeysCount: 1,
    unavaliableKeysCount: 2,
    stuckSigningKeysCount: 3,
    forgivenSigningKeysCount: 4,
  },
  {
    name: 'deactivated',
    isActive: false,
    rewardAddress: ADDRESS_3,
    totalSigningKeysCount: 10,
    depositedSigningKeysCount: 0,
    exitedSigningKeysCount: 0,
    vettedSigningKeysCount: 5,
    targetValidatorsLimitActive: false,
    targetValidatorsKeysCount: 1,
    unavaliableKeysCount: 2,
    stuckSigningKeysCount: 3,
    forgivenSigningKeysCount: 4,
  }
]

// bytes32 0x63757261746564
const CURATED_TYPE = padRight(web3.utils.fromAscii('curated'), 32)

const pad = (hex, bytesLength) => {
  const absentZeroes = bytesLength * 2 + 2 - hex.length
  if (absentZeroes > 0) hex = '0x' + '0'.repeat(absentZeroes) + hex.substr(2)
  return hex
}

const hexConcat = (first, ...rest) => {
  let result = first.startsWith('0x') ? first : '0x' + first
  rest.forEach((item) => {
    result += item.startsWith('0x') ? item.substr(2) : item
  })
  return result
}

const ETH = (value) => web3.utils.toWei(value + '', 'ether')
const StETH = artifacts.require('StETHMock')

contract('NodeOperatorsRegistry', ([appManager, voting, user1, user2, user3, nobody]) => {
  let appBase, app, pool, steth, dao
  const snapshot = new EvmSnapshot(hre.ethers.provider)

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    appBase = await NodeOperatorsRegistry.new()
    steth = await StETH.new()

    dao = await AragonDAO.create(appManager)
    app = await dao.newAppInstance({
      name: 'node-operators-registry',
      base: appBase,
      permissions: {
        MANAGE_SIGNING_KEYS: voting,
        ADD_NODE_OPERATOR_ROLE: voting,
        ACTIVATE_NODE_OPERATOR_ROLE: voting,
        DEACTIVATE_NODE_OPERATOR_ROLE: voting,
        SET_NODE_OPERATOR_NAME_ROLE: voting,
        SET_NODE_OPERATOR_ADDRESS_ROLE: voting,
        SET_NODE_OPERATOR_LIMIT_ROLE: voting,
        UPDATE_EXITED_VALIDATORS_KEYS_COUNT_ROLE: voting,
        UNSAFE_UPDATE_EXITED_VALIDATORS_KEYS_COUNT_ROLE: voting,
        INVALIDATE_READY_TO_DEPOSIT_KEYS_ROLE: voting,
        UPDATE_TARGET_VALIDATORS_KEYS_COUNT_ROLE: voting,
        UPDATE_STUCK_VALIDATORS_KEYS_COUNT_ROLE: voting,
        UPDATE_FORGIVEN_VALIDATORS_KEYS_COUNT_ROLE: voting,
      }
    })

    // grant role to app itself cause it uses solidity's call method to itself
    // inside the testing_requestValidatorsKeysForDeposits() method
    await dao.createPermission(app.address, app, 'REQUEST_VALIDATORS_KEYS_FOR_DEPOSITS_ROLE')

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    // const proxyAddress = await newApp(newDAO.dao, 'node-operators-registry', appBase.address, appManager)
    // app = await NodeOperatorsRegistry.at(proxyAddress)

    // Initialize the app's proxy.
    const tx = await app.initialize(steth.address, CURATED_TYPE)

    // Implementation initializer reverts because initialization block was set to max(uint256)
    // in the Autopetrified base contract
    // await assert.reverts(appBase.initialize(steth.address, CURATED_TYPE), 'INIT_ALREADY_INITIALIZED')
    await assertRevert(appBase.initialize(steth.address, CURATED_TYPE), 'INIT_ALREADY_INITIALIZED')

    const moduleType = await app.getType()
    assert.emits(tx, 'ContractVersionSet', { version: 2 })
    assert.emits(tx, 'StethContractSet', { stethAddress: steth.address })
    assert.emits(tx, 'StakingModuleTypeSet', { moduleType })
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })


  describe('distributeRewards()', () => {
    beforeEach(async () => {
      await app.testing_addNodeOperator('0', user1, 3, 3, 3, 0)
      await app.testing_addNodeOperator('1', user2, 7, 7, 7, 0)
      await app.testing_addNodeOperator('2', user3, 0, 0, 0, 0)
    })

    it("doesn't distributes rewards if no shares to distribute", async () => {
      const sharesCount = await steth.sharesOf(app.address)
      assert.equals(sharesCount, 0)
      const recipientsSharesBefore = await Promise.all([steth.sharesOf(user1), steth.sharesOf(user2), steth.sharesOf(user3)])
      await app.distributeRewards({ from: user3 })
      const recipientsSharesAfter = await Promise.all([steth.sharesOf(user1), steth.sharesOf(user2), steth.sharesOf(user3)])
      assert.equal(recipientsSharesBefore.length, recipientsSharesAfter.length)
      for (let i = 0; i < recipientsSharesBefore.length; ++i) {
        assert.equals(recipientsSharesBefore[i], recipientsSharesAfter[i])
      }
    })

    it('must distribute rewards to operators', async () => {
      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, ETH(10))

      await app.increaseTotalSigningKeysCount(10)
      await app.increaseVettedSigningKeysCount(10)
      await app.increaseDepositedSigningKeysCount(10)

      await app.distributeRewards({ from: user3 })

      assert.equals(await steth.sharesOf(user1), ETH(3))
      assert.equals(await steth.sharesOf(user2), ETH(7))
      assert.equals(await steth.sharesOf(user3), 0)
    })

    it('emits RewardsDistributed with correct params on reward distribution', async () => {
      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, ETH(10))

      await app.increaseTotalSigningKeysCount(10)
      await app.increaseVettedSigningKeysCount(10)
      await app.increaseDepositedSigningKeysCount(10)

      const receipt = await app.distributeRewards({ from: user3 })

      assert.emits(receipt, 'RewardsDistributed', { id: 0, sharesAmount: ETH(3) })
      assert.emits(receipt, 'RewardsDistributed', { id: 1, sharesAmount: ETH(7) })
      assert.emits(receipt, 'RewardsDistributed', { id: 2, sharesAmount: 0 })
    })

    it('penaltized works', async () => {
      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, ETH(10))

      await app.increaseTotalSigningKeysCount(10)
      await app.increaseVettedSigningKeysCount(10)
      await app.increaseDepositedSigningKeysCount(10)

      await app.updateStuckSigningKeysCount(0, 1, { from: voting });

      const receipt = await app.distributeRewards({ from: user3 })

      assert.emits(receipt, 'RewardsDistributed', { id: 0, sharesAmount: ETH(1.5) })
      assert.emits(receipt, 'RewardsDistributed', { id: 1, sharesAmount: ETH(7) })
      assert.emits(receipt, 'RewardsDistributed', { id: 2, sharesAmount: 0 })
      assert.emits(receipt, 'NodeOperatorPenalized', { receipientAddress: user1, sharesPenalizedAmount: ETH(1.5) })
    })

    it('penalitized and forgiven works', async () => {
      await steth.setTotalPooledEther(ETH(100))
      await steth.mintShares(app.address, ETH(10))

      await app.increaseTotalSigningKeysCount(10)
      await app.increaseVettedSigningKeysCount(10)
      await app.increaseDepositedSigningKeysCount(10)

      assert.isFalse(await app.testing_isNodeOperatorPenalized(0))

      await app.updateStuckSigningKeysCount(0, 1, { from: voting });
      assert.isTrue(await app.testing_isNodeOperatorPenalized(0))

      await app.updateForgivenSigningKeysCount(0, 1, { from: voting });
      assert.isFalse(await app.testing_isNodeOperatorPenalized(0))

      const receipt = await app.distributeRewards({ from: user3 })

      assert.emits(receipt, 'RewardsDistributed', { id: 0, sharesAmount: ETH(3) })
      assert.emits(receipt, 'RewardsDistributed', { id: 1, sharesAmount: ETH(7) })
      assert.emits(receipt, 'RewardsDistributed', { id: 2, sharesAmount: 0 })
      assert.notEmits(receipt, 'NodeOperatorPenalized')
    })

  })


})
