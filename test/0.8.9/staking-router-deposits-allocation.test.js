const hre = require('hardhat')
const { assert } = require('chai')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const StakingRouter = artifacts.require('StakingRouter')
const StakingModuleMock = artifacts.require('StakingModuleMock')
const DepositContractMock = artifacts.require('DepositContractMock.sol')

contract('StakingRouter', (accounts) => {
  let evmSnapshotId
  let depositContract, stakingRouter
  let curatedStakingModuleMock, soloStakingModuleMock, dvtStakingModuleMock
  const [deployer, lido, admin] = accounts

  before(async () => {
    depositContract = await DepositContractMock.new({ from: deployer })
    stakingRouter = await StakingRouter.new(depositContract.address, { from: deployer })
    ;[curatedStakingModuleMock, soloStakingModuleMock, dvtStakingModuleMock] = await Promise.all([
      StakingModuleMock.new({ from: deployer }),
      StakingModuleMock.new({ from: deployer }),
      StakingModuleMock.new({ from: deployer })
    ])

    const wc = '0x'.padEnd(66, '1234')
    await stakingRouter.initialize(admin, wc, { from: deployer })

    // Set up the staking router permissions.
    const [MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, MODULE_PAUSE_ROLE, MODULE_MANAGE_ROLE] = await Promise.all([
      stakingRouter.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(),
      stakingRouter.MODULE_PAUSE_ROLE(),
      stakingRouter.MODULE_MANAGE_ROLE()
    ])

    await stakingRouter.grantRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, admin, { from: admin })
    await stakingRouter.grantRole(MODULE_PAUSE_ROLE, admin, { from: admin })
    await stakingRouter.grantRole(MODULE_MANAGE_ROLE, admin, { from: admin })

    evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
  })

  afterEach(async () => {
    await hre.ethers.provider.send('evm_revert', [evmSnapshotId])
    evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
  })

  describe('One staking module', () => {
    beforeEach(async () => {
      await stakingRouter.addModule(
        'Curated',
        curatedStakingModuleMock.address,
        10_000, // target share 100 %
        1_000, // module fee 10 %
        5_000, // treasury fee 5 %
        { from: admin }
      )
    })

    it('getAllocatedDepositsDistribution :: staking module without keys', async () => {
      const { allocated, allocations } = await stakingRouter.getKeysAllocation(0)

      assertBn(allocated, 0)
      assert.equal(allocations.length, 1)
      assertBn(allocations[0], 0)
    })

    it('getAllocatedDepositsDistribution :: staking module with zero used keys', async () => {
      await curatedStakingModuleMock.setTotalKeys(500)
      assertBn(await curatedStakingModuleMock.getTotalKeys(), 500)
      const { allocated, allocations } = await stakingRouter.getKeysAllocation(1000)

      assertBn(allocated, 500)
      assert.equal(allocations.length, 1)
      assertBn(allocations[0], 500)
    })

    it('getAllocatedDepositsDistribution :: staking module with non zero used keys', async () => {
      await curatedStakingModuleMock.setTotalKeys(500)
      assertBn(await curatedStakingModuleMock.getTotalKeys(), 500)

      await curatedStakingModuleMock.setTotalUsedKeys(250)
      assertBn(await curatedStakingModuleMock.getTotalUsedKeys(), 250)

      const { allocated, allocations } = await stakingRouter.getKeysAllocation(250)

      assertBn(allocated, 250)
      assert.equal(allocations.length, 1)
      assertBn(allocations[0], 500)
    })
  })

  describe('Two staking modules', () => {
    beforeEach(async () => {
      await stakingRouter.addModule(
        'Curated',
        curatedStakingModuleMock.address,
        10_000, // 100 % _targetShare
        1_000, // 10 % _moduleFee
        5_000, // 50 % _treasuryFee
        { from: admin }
      )
      await stakingRouter.addModule(
        'Solo',
        soloStakingModuleMock.address,
        200, // 2 % _targetShare
        5_000, // 50 % _moduleFee
        0, // 0 % _treasuryFee
        { from: admin }
      )
    })

    it('getAllocatedDepositsDistribution :: equal available keys', async () => {
      await curatedStakingModuleMock.setTotalKeys(5000)
      assertBn(await curatedStakingModuleMock.getTotalKeys(), 5000)

      await curatedStakingModuleMock.setTotalUsedKeys(4500)
      assertBn(await curatedStakingModuleMock.getTotalUsedKeys(), 4500)

      await soloStakingModuleMock.setTotalKeys(300)
      assertBn(await soloStakingModuleMock.getTotalKeys(), 300)

      await soloStakingModuleMock.setTotalUsedKeys(50)
      assertBn(await soloStakingModuleMock.getTotalUsedKeys(), 50)

      const { allocated, allocations } = await stakingRouter.getKeysAllocation(333)

      assertBn(allocated, 333)
      assert.equal(allocations.length, 2)

      assertBn(allocations[0], 4786)
      // newTotalKeysCount: 4883 -> 0.02 * 4883 = 97
      assertBn(allocations[1], 97)
    })
  })

  describe('Make deposit', () => {
    beforeEach(async () => {
      await stakingRouter.addModule(
        'Curated',
        curatedStakingModuleMock.address,
        10_000, // 100 % _targetShare
        1_000, // 10 % _moduleFee
        5_000, // 50 % _treasuryFee
        { from: admin }
      )
      await stakingRouter.addModule(
        'Solo',
        soloStakingModuleMock.address,
        200, // 2 % _targetShare
        5_000, // 50 % _moduleFee
        0, // 0 % _treasuryFee
        { from: admin }
      )
    })

    it('Lido.deposit() :: transfer balance', async () => {})
  })
})
