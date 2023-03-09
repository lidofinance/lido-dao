const { artifacts, contract, ethers } = require('hardhat')
const { assert } = require('../../helpers/assert')
const { BigNumber } = require('ethers')
const StakingRouter = artifacts.require('StakingRouterMock.sol')
const StakingModuleMock = artifacts.require('StakingModuleMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')

const BASIS_POINTS_BASE = 100_00

contract('StakingRouter', (accounts) => {
  let evmSnapshotId
  let depositContract, stakingRouter
  let StakingModule1, StakingModule2, StakingModule3
  const [deployer, lido, admin] = accounts

  before(async () => {
    depositContract = await DepositContractMock.new({ from: deployer })
    stakingRouter = await StakingRouter.new(depositContract.address, { from: deployer })
    const mocks = await Promise.all([
      StakingModuleMock.new({ from: deployer }),
      StakingModuleMock.new({ from: deployer }),
      StakingModuleMock.new({ from: deployer }),
    ])

    StakingModule1 = mocks[0]
    StakingModule2 = mocks[1]
    StakingModule3 = mocks[2]

    const wc = '0x'.padEnd(66, '1234')
    await stakingRouter.initialize(admin, lido, wc, { from: deployer })

    // Set up the staking router permissions.
    const [MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, STAKING_MODULE_PAUSE_ROLE, STAKING_MODULE_MANAGE_ROLE] =
      await Promise.all([
        stakingRouter.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(),
        stakingRouter.STAKING_MODULE_PAUSE_ROLE(),
        stakingRouter.STAKING_MODULE_MANAGE_ROLE(),
      ])

    await stakingRouter.grantRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, admin, { from: admin })
    await stakingRouter.grantRole(STAKING_MODULE_PAUSE_ROLE, admin, { from: admin })
    await stakingRouter.grantRole(STAKING_MODULE_MANAGE_ROLE, admin, { from: admin })

    evmSnapshotId = await ethers.provider.send('evm_snapshot', [])
  })

  afterEach(async () => {
    await ethers.provider.send('evm_revert', [evmSnapshotId])
    evmSnapshotId = await ethers.provider.send('evm_snapshot', [])
  })

  const TWO_MODULES_TARGET_SHARES_CASES = [
    [100_00, 0],
    [50_00, 50_00],
    [99_99, 1],
  ]
  const MAX_DEPOSITABLE_KEYS_CASES = [0, 1, 10_000]
  const MODULE_AVAILABLE_KEYS_CASES = [0, 1, 10_000]
  const MODULE_ACTIVE_KEYS_CASES = [0, 1, 10_000]

  describe('Deposits allocation with paused modules', () => {
    it('allocates correctly if some staking modules are paused', async () => {
      // add staking module 1
      await stakingRouter.addStakingModule(
        'Module 1',
        StakingModule1.address,
        100_00, // target share BP
        10_00, // staking module fee BP
        50_00, // treasury fee BP
        { from: admin }
      )

      const sm1AvailableKeysCount = 100
      await StakingModule1.setAvailableKeysCount(sm1AvailableKeysCount)
      assert.equals(await StakingModule1.getAvailableValidatorsCount(), sm1AvailableKeysCount)

      const sm1ActiveKeysCount = 15000
      await StakingModule1.setActiveValidatorsCount(sm1ActiveKeysCount)
      assert.equals(await StakingModule1.getActiveValidatorsCount(), sm1ActiveKeysCount)

      // add staking module 2
      await stakingRouter.addStakingModule(
        'Module 2',
        StakingModule2.address,
        10_00, // target share BP
        10_00, // staking module fee BP
        50_00, // treasury fee BP
        { from: admin }
      )

      const sm2AvailableKeysCount = 500
      await StakingModule2.setAvailableKeysCount(sm2AvailableKeysCount)
      assert.equals(await StakingModule2.getAvailableValidatorsCount(), sm2AvailableKeysCount)

      const sm2ActiveKeysCount = 100
      await StakingModule2.setActiveValidatorsCount(sm2ActiveKeysCount)
      assert.equals(await StakingModule2.getActiveValidatorsCount(), sm2ActiveKeysCount)
      // add staking module 3
      await stakingRouter.addStakingModule(
        'Module 3',
        StakingModule3.address,
        7_00, // target share BP
        5_00, // staking module fee BP
        0, // treasury fee BP
        { from: admin }
      )

      const sm3AvailableKeysCount = 300
      await StakingModule3.setAvailableKeysCount(sm3AvailableKeysCount)
      assert.equals(await StakingModule3.getAvailableValidatorsCount(), sm3AvailableKeysCount)

      const sm3ActiveKeysCount = 150
      await StakingModule3.setActiveValidatorsCount(sm3ActiveKeysCount)
      assert.equals(await StakingModule3.getActiveValidatorsCount(), sm3ActiveKeysCount)

      const { allocated: allocated1, allocations: allocations1 } = await stakingRouter.getDepositsAllocation(100)
      assert.equals(allocated1, 100)
      assert.equals(allocations1[0], 15000)
      assert.equals(allocations1[1], 175)
      assert.equals(allocations1[2], 175)

      await stakingRouter.pauseStakingModule(1, { from: admin })
      const { allocated: allocated2, allocations: allocations2 } = await stakingRouter.getDepositsAllocation(100)

      assert.equals(allocated2, 100)
      assert.equals(allocations2[0], 15000)
      assert.equals(allocations2[1], 175)
      assert.equals(allocations2[2], 175)

      await stakingRouter.pauseStakingModule(2, { from: admin })
      const { allocated: allocated3, allocations: allocations3 } = await stakingRouter.getDepositsAllocation(100)

      assert.equals(allocated3, 100)
      assert.equals(allocations3[0], 15000)
      assert.equals(allocations3[1], 100)
      assert.equals(allocations3[2], 250)
    })
  })

  describe('Single staking module', function () {
    this.timeout(30_000, 'Test suite took too long')
    beforeEach(async () => {
      await stakingRouter.addStakingModule('Module1', StakingModule1.address, 10_000, 1_000, 5_000, { from: admin })
    })

    it('should have only one module', async () => {
      const stakingModulesCount = await stakingRouter.getStakingModulesCount()
      assert(stakingModulesCount, 1)
    })

    // covering multiple cases in a single unit test to prevent terminal output flooding
    // if this test fails, try zeroing in on the specific case by moving `it()` function inside of the deepest loop
    it('should allocate everything to the module', async () => {
      for (const depositableKeys of MAX_DEPOSITABLE_KEYS_CASES) {
        for (const availableKeys of MODULE_AVAILABLE_KEYS_CASES) {
          for (const activeKeys of MODULE_ACTIVE_KEYS_CASES) {
            await StakingModule1.setAvailableKeysCount(availableKeys)
            assert.equals(await StakingModule1.getAvailableValidatorsCount(), availableKeys)

            await StakingModule1.setActiveValidatorsCount(activeKeys)
            assert.equals(await StakingModule1.getActiveValidatorsCount(), activeKeys)

            const { allocated, allocations } = await stakingRouter.getDepositsAllocation(depositableKeys)

            const expectedAllocated = Math.min(depositableKeys, availableKeys)

            assert.equals(allocated, expectedAllocated)
            assert.equal(allocations.length, 1)
            assert.equals(allocations[0], activeKeys + expectedAllocated)
          }
        }
      }
    })
  })

  describe('Two staking modules', async function () {
    this.timeout(60_000, 'Test suite took too long')
    for (const [module1TargetShare, module2TargetShare] of TWO_MODULES_TARGET_SHARES_CASES) {
      describe(`Target shares: ${module1TargetShare} and ${module2TargetShare}`, async () => {
        beforeEach(async () => {
          await Promise.all([
            await stakingRouter.addStakingModule('Module1', StakingModule1.address, module1TargetShare, 5_000, 5_000, {
              from: admin,
            }),
            await stakingRouter.addStakingModule('Module2', StakingModule2.address, module2TargetShare, 5_000, 5_000, {
              from: admin,
            }),
          ])
        })

        const module1AvailableKeyCases = MODULE_AVAILABLE_KEYS_CASES
        const module2AvailableKeyCases = MODULE_AVAILABLE_KEYS_CASES
        const module1ActiveKeyCases = MODULE_ACTIVE_KEYS_CASES
        const module2ActiveKeyCases = MODULE_ACTIVE_KEYS_CASES

        // covering multiple cases in a single unit test to prevent terminal output flooding
        // if this test fails, try zeroing in on the specific case by moving `it()` function inside of the deepest loop
        it('should allocate keys according to the allocation algorithm', async () => {
          for (const depositableKeys of MAX_DEPOSITABLE_KEYS_CASES) {
            for (const module1AvailableKeys of module1AvailableKeyCases) {
              for (const module2AvailableKeys of module2AvailableKeyCases) {
                for (const module1ActiveKeys of module1ActiveKeyCases) {
                  for (const module2ActiveKeys of module2ActiveKeyCases) {
                    assert.equals((await stakingRouter.getStakingModuleByIndex(0)).targetShare, module1TargetShare)
                    assert.equals((await stakingRouter.getStakingModuleByIndex(1)).targetShare, module2TargetShare)

                    await StakingModule1.setAvailableKeysCount(module1AvailableKeys)
                    assert.equals(await StakingModule1.getAvailableValidatorsCount(), module1AvailableKeys)

                    await StakingModule2.setAvailableKeysCount(module2AvailableKeys)
                    assert.equals(await StakingModule2.getAvailableValidatorsCount(), module2AvailableKeys)

                    await StakingModule1.setActiveValidatorsCount(module1ActiveKeys)
                    assert.equals(await StakingModule1.getActiveValidatorsCount(), module1ActiveKeys)

                    await StakingModule2.setActiveValidatorsCount(module2ActiveKeys)
                    assert.equals(await StakingModule2.getActiveValidatorsCount(), module2ActiveKeys)

                    const { allocated, allocations } = await stakingRouter.getDepositsAllocation(depositableKeys)

                    const newTotalActiveKeys = module1ActiveKeys + module2ActiveKeys + depositableKeys

                    const module1TargetKeys = BigNumber.from(newTotalActiveKeys)
                      .mul(module1TargetShare)
                      .div(BASIS_POINTS_BASE)
                    const module2TargetKeys = BigNumber.from(newTotalActiveKeys)
                      .mul(module2TargetShare)
                      .div(BASIS_POINTS_BASE)

                    const module1DepositableKeys = Math.min(
                      module1AvailableKeys,
                      Math.max(0, module1TargetKeys - module1ActiveKeys)
                    )
                    const module2DepositableKeys = Math.min(
                      module2AvailableKeys,
                      Math.max(0, module2TargetKeys - module2ActiveKeys)
                    )

                    const expectedAllocated = Math.min(depositableKeys, module1DepositableKeys + module2DepositableKeys)
                    assert.equals(allocated, expectedAllocated)
                    assert.equal(allocations.length, 2)
                    assert.equals(
                      allocations[0],
                      module1ActiveKeys + Math.max(0, expectedAllocated - module2DepositableKeys)
                    )
                    assert.equals(
                      allocations[1],
                      module2ActiveKeys + Math.max(0, expectedAllocated - module1DepositableKeys)
                    )
                  }
                }
              }
            }
          }
        })
      })
    }
  })
})
