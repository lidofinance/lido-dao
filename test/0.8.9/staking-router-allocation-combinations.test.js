const hre = require('hardhat')
const { assert } = require('chai')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { BigNumber } = require('ethers')
const StakingRouter = artifacts.require('StakingRouterMock.sol')
const StakingModuleMock = artifacts.require('StakingModuleMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')

const BASIS_POINTS_BASE = 100_00

contract('StakingRouter', (accounts) => {
  let evmSnapshotId
  let depositContract, stakingRouter
  let StakingModule1, StakingModule2
  const [deployer, lido, admin] = accounts

  before(async () => {
    depositContract = await DepositContractMock.new({ from: deployer })
    stakingRouter = await StakingRouter.new(depositContract.address, { from: deployer })
    const mocks = await Promise.all([StakingModuleMock.new({ from: deployer }), StakingModuleMock.new({ from: deployer })])

    StakingModule1 = mocks[0]
    StakingModule2 = mocks[1]

    const wc = '0x'.padEnd(66, '1234')
    await stakingRouter.initialize(admin, lido, wc, { from: deployer })

    // Set up the staking router permissions.
    const [MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, STAKING_MODULE_PAUSE_ROLE, STAKING_MODULE_MANAGE_ROLE] = await Promise.all([
      stakingRouter.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(),
      stakingRouter.STAKING_MODULE_PAUSE_ROLE(),
      stakingRouter.STAKING_MODULE_MANAGE_ROLE()
    ])

    await stakingRouter.grantRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, admin, { from: admin })
    await stakingRouter.grantRole(STAKING_MODULE_PAUSE_ROLE, admin, { from: admin })
    await stakingRouter.grantRole(STAKING_MODULE_MANAGE_ROLE, admin, { from: admin })

    evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
  })

  afterEach(async () => {
    await hre.ethers.provider.send('evm_revert', [evmSnapshotId])
    evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
  })

  const depositableKeysCases = [0, 1, 10, 50, 100]
  const availableKeysCases = [0, 1, 10, 50]
  const activeKeysCases = [0, 1, 10, 50]

  xdescribe('Single staking module', async () => {
    beforeEach(async () => {
      await stakingRouter.addStakingModule('Module1', StakingModule1.address, 10_000, 1_000, 5_000, { from: admin })
    })

    it('should have only one module', async () => {
      const stakingModulesCount = await stakingRouter.getStakingModulesCount()
      assert(stakingModulesCount, 1)
    })

    for (const depositableKeys of depositableKeysCases) {
      for (const availableKeys of availableKeysCases) {
        for (const activeKeys of activeKeysCases) {
          it('should allocate everything to the module', async () => {
            await StakingModule1.setAvailableKeysCount(availableKeys)
            assertBn(await StakingModule1.getAvailableKeysCount(), availableKeys)

            await StakingModule1.setActiveKeysCount(activeKeys)
            assertBn(await StakingModule1.getActiveKeysCount(), activeKeys)

            const { allocated, allocations } = await stakingRouter.getKeysAllocation(depositableKeys)

            const expectedAllocated = Math.min(depositableKeys, availableKeys)
            console.log('')
            console.log('* * * * * * * * * * * * * * * * * * * * * *')
            console.log('depositableKeys:', depositableKeys)
            console.log('allocated:', +allocated)
            console.table([
              {
                name: 'Module1',
                targetShare: 100_00,
                availableKeys: availableKeys,
                activeKeys: activeKeys,
                allocation: +allocations[0]
              }
            ])

            assertBn(allocated, expectedAllocated)
            assert.equal(allocations.length, 1)
            assertBn(allocations[0], activeKeys + expectedAllocated)
          })
        }
      }
    }
  })

  xdescribe('Two staking modules', async () => {
    const targetSharesCases = [
      [100_00, 0],
      [50_00, 50_00],
      [99_99, 1]
    ]

    for (const [module1TargetShare, module2TargetShare] of targetSharesCases) {
      describe('Allocation with different target shares', async () => {
        beforeEach(async () => {
          await Promise.all([
            await stakingRouter.addStakingModule('Module1', StakingModule1.address, module1TargetShare, 5_000, 5_000, { from: admin }),
            await stakingRouter.addStakingModule('Module2', StakingModule2.address, module2TargetShare, 5_000, 5_000, {
              from: admin
            })
          ])
        })

        it('should have two modules', async () => {
          const stakingModulesCount = await stakingRouter.getStakingModulesCount()
          assert(stakingModulesCount, 2)
        })

        const module1AvailableKeyCases = availableKeysCases
        const module2AvailableKeyCases = availableKeysCases
        const module1ActiveKeyCases = activeKeysCases
        const module2ActiveKeyCases = activeKeysCases

        for (const module1AvailableKeys of module1AvailableKeyCases) {
          for (const module2AvailableKeys of module2AvailableKeyCases) {
            for (const module1ActiveKeys of module1ActiveKeyCases) {
              for (const module2ActiveKeys of module2ActiveKeyCases) {
                for (const depositableKeys of depositableKeysCases) {
                  it('should allocate keys according to the allocation algorithm', async () => {
                    assertBn((await stakingRouter.getStakingModuleByIndex(0)).targetShare, module1TargetShare)
                    assertBn((await stakingRouter.getStakingModuleByIndex(1)).targetShare, module2TargetShare)

                    await StakingModule1.setAvailableKeysCount(module1AvailableKeys)
                    assertBn(await StakingModule1.getAvailableKeysCount(), module1AvailableKeys)

                    await StakingModule2.setAvailableKeysCount(module2AvailableKeys)
                    assertBn(await StakingModule2.getAvailableKeysCount(), module2AvailableKeys)

                    await StakingModule1.setActiveKeysCount(module1ActiveKeys)
                    assertBn(await StakingModule1.getActiveKeysCount(), module1ActiveKeys)

                    await StakingModule2.setActiveKeysCount(module2ActiveKeys)
                    assertBn(await StakingModule2.getActiveKeysCount(), module2ActiveKeys)

                    const { allocated, allocations } = await stakingRouter.getKeysAllocation(depositableKeys)

                    const newTotalActiveKeys = module1ActiveKeys + module2ActiveKeys + depositableKeys

                    const module1TargetKeys = BigNumber.from(newTotalActiveKeys).mul(module1TargetShare).div(BASIS_POINTS_BASE)
                    const module2TargetKeys = BigNumber.from(newTotalActiveKeys).mul(module2TargetShare).div(BASIS_POINTS_BASE)

                    const module1DepositableKeys = Math.min(module1AvailableKeys, Math.max(0, module1TargetKeys - module1ActiveKeys))
                    const module2DepositableKeys = Math.min(module2AvailableKeys, Math.max(0, module2TargetKeys - module2ActiveKeys))

                    const expectedAllocated = Math.min(depositableKeys, module1DepositableKeys + module2DepositableKeys)
                    console.log('')
                    console.log('* * * * * * * * * * * * * * * * * * * * * *')
                    console.log('depositableKeys:', depositableKeys)
                    console.log('allocated:', +allocated)
                    console.table([
                      {
                        name: 'Module1',
                        targetShare: module1TargetShare,
                        availableKeys: module1AvailableKeys,
                        activeKeys: module1ActiveKeys,
                        allocation: +allocations[0]
                      },
                      {
                        name: 'Module2',
                        targetShare: module2TargetShare,
                        availableKeys: module2AvailableKeys,
                        activeKeys: module2ActiveKeys,
                        allocation: +allocations[1]
                      }
                    ])
                    assertBn(allocated, expectedAllocated)
                    assert.equal(allocations.length, 2)
                    assertBn(allocations[0], module1ActiveKeys + Math.max(0, expectedAllocated - module2DepositableKeys))
                    assertBn(allocations[1], module2ActiveKeys + Math.max(0, expectedAllocated - module1DepositableKeys))
                  })
                }
              }
            }
          }
        }
      })
    }
  })
})
