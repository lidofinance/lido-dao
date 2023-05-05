const { artifacts, contract, ethers } = require('hardhat')
const { MaxUint256 } = require('@ethersproject/constants')
const { assert } = require('../../helpers/assert')
const { EvmSnapshot } = require('../../helpers/blockchain')
const { toNum } = require('../../helpers/utils')

const OssifiableProxy = artifacts.require('OssifiableProxy.sol')
const DepositContractMock = artifacts.require('DepositContractMock')
const StakingRouter = artifacts.require('StakingRouter.sol')
const StakingModuleMock = artifacts.require('StakingModuleMock.sol')

let depositContract, router
let module1, module2

contract('StakingRouter', ([deployer, lido, admin, appManager, stranger]) => {
  const evmSnapshot = new EvmSnapshot(ethers.provider)

  const snapshot = () => evmSnapshot.make()
  const revert = () => evmSnapshot.revert()

  before(async () => {
    depositContract = await DepositContractMock.new({ from: deployer })

    const impl = await StakingRouter.new(depositContract.address, { from: deployer })
    const proxy = await OssifiableProxy.new(impl.address, deployer, '0x')
    router = await StakingRouter.at(proxy.address)
    ;[module1, module2] = await Promise.all([
      StakingModuleMock.new({ from: deployer }),
      StakingModuleMock.new({ from: deployer }),
    ])

    const wc = '0x'.padEnd(66, '1234')
    await router.initialize(admin, lido, wc, { from: deployer })
  })

  describe('getNodeOperatorDigests() by module id and list of nopIds', async () => {
    before(snapshot)
    after(revert)

    let module1Id, module2Id
    let module1AddedBlock, module2AddedBlock
    const nodeOperator1 = 0
    let StakingModuleDigest, StakingModuleDigest2

    it('reverts if moduleId does not exists', async () => {
      await assert.reverts(router.getNodeOperatorDigests(0, []), 'StakingModuleUnregistered()')
    })

    it('add one module', async () => {
      await router.grantRole(await router.STAKING_MODULE_MANAGE_ROLE(), admin, { from: admin })
      await router.addStakingModule(
        'module 1',
        module1.address,
        10_000, // 100 % _targetShare
        1_000, // 10 % _moduleFee
        5_000, // 50 % _treasuryFee
        { from: admin }
      )
      module1AddedBlock = await ethers.provider.getBlock()
      module1Id = +(await router.getStakingModuleIds())[0]
    })

    it('add second module', async () => {
      await router.addStakingModule(
        'module 2',
        module2.address,
        9_000, // 100 % _targetShare
        2_000, // 10 % _moduleFee
        3_000, // 50 % _treasuryFee
        { from: admin }
      )
      module2AddedBlock = await ethers.provider.getBlock()
      module2Id = +(await router.getStakingModuleIds())[1]
    })

    it('get digest with empty nodeOperators', async () => {
      const digests = await router.getNodeOperatorDigests(module1Id, [])
      assert.equal(digests.length, 0)
    })

    it('add first node operator summary', async () => {
      const summary = {
        isTargetLimitActive: true,
        targetValidatorsCount: 1,
        stuckValidatorsCount: 2,
        refundedValidatorsCount: 3,
        stuckPenaltyEndTimestamp: 4,
        totalExitedValidators: 5,
        totalDepositedValidators: 6,
        depositableValidatorsCount: 7,
      }
      await module1.setNodeOperatorSummary(nodeOperator1, summary)

      await module1.testing_setNodeOperatorsCount(1)
    })

    it('get digest with one nodeOperator', async () => {
      const digests = await router.getNodeOperatorDigests(module1Id, [nodeOperator1])
      assert.equal(digests.length, 1)

      assert.equal(digests[0].id, 0)
      assert.equal(digests[0].isActive, false)
      assert.sameOrderedMembers(toNum(digests[0].summary), [1, 1, 2, 3, 4, 5, 6, 7])
    })

    it('get digest with one nodeOperator and one non existi g', async () => {
      const digests = await router.getNodeOperatorDigests(module1Id, [nodeOperator1, 123])
      assert.equal(digests.length, 2)

      assert.equal(digests[0].id, 0)
      assert.equal(digests[0].isActive, false)
      assert.sameOrderedMembers(toNum(digests[0].summary), [1, 1, 2, 3, 4, 5, 6, 7])

      assert.equal(digests[1].id, 123)
      assert.equal(digests[1].isActive, false)
      assert.sameOrderedMembers(toNum(digests[1].summary), [0, 0, 0, 0, 0, 0, 0, 0])
    })

    it('getNodeOperatorDigests(uint256,uint256,uint256) - reverts module unregistered', async () => {
      await assert.reverts(
        router.methods[`getNodeOperatorDigests(uint256,uint256,uint256)`](0, 0, 0),
        'StakingModuleUnregistered()'
      )
    })
    it('getNodeOperatorDigests(uint256,uint256,uint256) - module2 without operators', async () => {
      let digests = await router.methods[`getNodeOperatorDigests(uint256,uint256,uint256)`](module2Id, 0, 0)
      assert.equal(digests.length, 0)

      digests = await router.methods[`getNodeOperatorDigests(uint256,uint256,uint256)`](module2Id, 0, 1)
      assert.equal(digests.length, 0)

      digests = await router.methods[`getNodeOperatorDigests(uint256,uint256,uint256)`](module2Id, 0, MaxUint256)
      assert.equal(digests.length, 0)

      digests = await router.methods[`getNodeOperatorDigests(uint256,uint256,uint256)`](
        module2Id,
        MaxUint256,
        MaxUint256
      )
      assert.equal(digests.length, 0)
    })

    it('getNodeOperatorDigests(uint256,uint256,uint256) - module1 with node operators', async () => {
      let digests = await router.methods[`getNodeOperatorDigests(uint256,uint256,uint256)`](module1Id, 0, 0)
      assert.equal(digests.length, 0)

      digests = await router.methods[`getNodeOperatorDigests(uint256,uint256,uint256)`](module1Id, 0, MaxUint256)
      assert.equal(digests.length, 1)

      assert.equal(digests[0].id, 0)
      assert.equal(digests[0].isActive, false)
      assert.sameOrderedMembers(toNum(digests[0].summary), [1, 1, 2, 3, 4, 5, 6, 7])
    })

    it('getAllNodeOperatorDigests(uint256) - module unregistered', async () => {
      await assert.reverts(router.getAllNodeOperatorDigests(999), 'StakingModuleUnregistered()')
    })
    it('getAllNodeOperatorDigests(uint256) - digests works', async () => {
      const digests = await router.getAllNodeOperatorDigests(module1Id)
      assert.equal(digests.length, 1)

      assert.equal(digests[0].id, 0)
      assert.equal(digests[0].isActive, false)
      assert.sameOrderedMembers(toNum(digests[0].summary), [1, 1, 2, 3, 4, 5, 6, 7])
    })

    it('reverts getAllNodeOperatorDigests module unregistered', async () => {
      await assert.reverts(router.getAllNodeOperatorDigests(0), 'StakingModuleUnregistered()')
    })
    it('getStakingModuleDigests([]uint256) - reverts modules unregistered', async () => {
      await assert.reverts(router.getStakingModuleDigests([0, 999]), 'StakingModuleUnregistered()')
    })
    it('getStakingModuleDigests([]uint256) - digests works', async () => {
      await module1.setTotalExitedValidatorsCount(11)
      await module1.setActiveValidatorsCount(21)
      await module1.setAvailableKeysCount(33)

      const digests = await router.getStakingModuleDigests([module1Id, module2Id])
      assert.equal(digests.length, 2)

      StakingModuleDigest = {
        nodeOperatorsCount: '1',
        activeNodeOperatorsCount: '0',
        state: Object.values({
          id: module1Id.toString(),
          stakingModuleAddress: module1.address,
          stakingModuleFee: '1000',
          treasuryFee: '5000',
          targetShare: '10000',
          status: '0',
          name: 'module 1',
          lastDepositAt: module1AddedBlock.timestamp.toString(),
          lastDepositBlock: module1AddedBlock.number.toString(),
          exitedValidatorsCount: '0',
        }),
        summary: Object.values({
          totalExitedValidators: '11',
          totalDepositedValidators: '32', // 11 exited + 21 active
          depositableValidatorsCount: '33',
        }),
      }

      assert.deepEqual(digests[0], Object.values(StakingModuleDigest))

      StakingModuleDigest2 = {
        nodeOperatorsCount: '0',
        activeNodeOperatorsCount: '0',
        state: Object.values({
          id: module2Id.toString(),
          stakingModuleAddress: module2.address,
          stakingModuleFee: '2000',
          treasuryFee: '3000',
          targetShare: '9000',
          status: '0',
          name: 'module 2',
          lastDepositAt: module2AddedBlock.timestamp.toString(),
          lastDepositBlock: module2AddedBlock.number.toString(),
          exitedValidatorsCount: '0',
        }),
        summary: Object.values({
          totalExitedValidators: '0',
          totalDepositedValidators: '0',
          depositableValidatorsCount: '0',
        }),
      }
      assert.deepEqual(digests[1], Object.values(StakingModuleDigest2))

      const digests2 = await router.getStakingModuleDigests([module1Id, module2Id])
      assert.equal(digests2.length, 2)
    })

    it('getAllStakingModuleDigests() works', async () => {
      //
      const digests2 = await router.getAllStakingModuleDigests()
      assert.equal(digests2.length, 2)

      assert.deepEqual(digests2[0], Object.values(StakingModuleDigest))
      assert.deepEqual(digests2[1], Object.values(StakingModuleDigest2))
    })
  })
})
